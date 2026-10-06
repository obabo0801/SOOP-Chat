import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import * as api from '#soop/http';
import { createVideo } from '#soop/video';
import { Transport } from '#soop/transport';
import { Package } from '#soop/package';
import { Chat } from '#soop/chat';
import { DOMAIN } from '#soop/config';

const editors = new WeakMap();

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.js', ['index.js', 'text/javascript']],
  ['/config.js', ['../config.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/chat.js', ['chat.js', 'text/javascript']],
  ['/chat.css', ['chat.css', 'text/css']],
  ['/favicon.png', ['favicon.png', 'image/png']],
  ['/favicon.ico', ['favicon.png', 'image/png']]
]);

function describe(id, data) {
  const result = {
    id,
    image: data.profile_image,
    station: {
      user_nick: data.station?.user_nick,
      description: data.station?.display?.profile_text,
      jointime: data.station?.jointime,
      broad_start: data.station?.broad_start,
      total_broad_time: data.station?.total_broad_time,
      upd: data.station?.upd
    },
    subscription: data.subscription
  };

  return result;
}

function snapshot(macro) {
  const source = macro.file
    ? fs.readFileSync(macro.file, 'utf8')
    : JSON.stringify(macro.config);
  const config = JSON.parse(source);
  const revision = crypto.createHash('sha256').update(source).digest('hex');

  return { config, revision };
}

function packs(client) {
  const result = [];

  for (const [index, item] of (client.ogq?.data || []).entries()) {
    const pack = client.findOgq(index);

    if (!pack || !Number.isSafeInteger(pack.max) || pack.max < 1) {
      continue;
    }

    const images = [];

    for (let number = 1; number <= Math.min(pack.max, 200); number++) {
      const url = client.makeOgqUrl(index, number);

      if (url.startsWith('https://')) {
        images.push(url);
      }
    }

    result.push({ id: pack.id, name: item.ogq_title || '', max: pack.max, images });
  }

  return result;
}

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function ceremonies(client) {
  const balloon = client.makeBalloonUrl({ count: 100 });
  const adcon = new URL('/images/mobile/adb.png', DOMAIN.res).href;
  const follow = client.makeGudokUrl(1);
  const result = {
    balloon,
    adcon,
    videoBalloon: new URL('/new_player/items/m_video_balloon.png', DOMAIN.res).href,
    vodBalloon: balloon,
    vodAdcon: adcon,
    stationAdcon: adcon,
    sticker: client.makeStickerUrl(),
    quickview: new URL('/ceremony/quickview.png', DOMAIN.res).href,
    subscription: new URL('/ceremony/basic_subscription.png', DOMAIN.res).href,
    follow,
    followEffect: follow,
    subCeremony: follow,
    challenge: balloon,
    battle: balloon,
    missionSettle: balloon
  };

  if (client.findOgq()) {
    result.ogqGift = client.makeOgqUrl();
  }

  return result;
}

async function body(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > 1048576) {
      throw new Error('설정 용량 초과');
    }

    chunks.push(chunk);
  }

  try {
    const source = Buffer.concat(chunks).toString('utf8');
    const result = JSON.parse(source);

    return result;
  } catch {
    throw new Error('설정 요청 오류');
  }
}

function launch(url) {
  let command;
  let args;

  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/c', 'start', '""', url];
  }
  else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  }
  else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  });

  child.on('error', () => {});
  child.unref();
}

async function reopen(url) {
  const address = new URL(url);
  const endpoint = `${address.origin}/api/editor`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${address.hash.slice(1)}` },
    signal: AbortSignal.timeout(1000)
  });
  const current = await response.json();

  if (response.ok && !current.pages) {
    launch(url);
  }
}

export function openEditor(macro, options = {}) {
  if (editors.has(macro)) {
    return editors.get(macro);
  }

  const result = createEditor(macro, options).catch(error => {
    editors.delete(macro);

    throw error;
  });

  editors.set(macro, result);

  return result;
}

async function createEditor(macro, { browser = true, account } = {}) {
  const key = crypto
    .createHash('sha256')
    .update(path.resolve(macro.file || path.join(process.cwd(), 'macros.json')))
    .digest('hex');
  const file = path.join(os.tmpdir(), `soop-editor-${key}.json`);
  let previous;

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (
      Number.isInteger(data.port)
      && data.port > 0
      && data.port < 65536
      && /^[a-f0-9]{64}$/.test(data.token)
    ) {
      previous = data;
    }
  } catch {}

  const token = previous?.token || crypto.randomBytes(32).toString('hex');
  const chat = new Chat(macro.client, { directory: macro.history?.directory });
  const sockets = new Set();
  const pages = new Set();
  let seen = 0;
  let assets = null;
  let loaded = 0;
  let profile = null;
  let cookie;
  let attempted;

  if (previous) {
    const origin = `http://127.0.0.1:${previous.port}`;

    try {
      const response = await fetch(`${origin}/api/editor`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000)
      });
      const data = await response.json();

      if (response.ok && data.key === key) {
        return {
          url: `${origin}/#${token}`,
          open: () => reopen(`${origin}/#${token}`),
          close: async () => {
            editors.delete(macro);
          }
        };
      }
    } catch {}
  }

  const video = createVideo(
    async (quality, signal) => {
      const stream = await api.getStream(macro.client.bjId, quality, {
        ...macro.client.network?.httpOptions,
        cookie: macro.client.cookie || cookie,
        password: macro.client.broadPw,
        signal
      });

      if (stream) {
        const preset = stream.qualities.find(item => item.name === quality);
        const resolution = Number.parseInt(preset?.label, 10);

        stream.native = resolution > 540;
      }

      return stream;
    },
    {
      available: (transport, source) =>
        Package.available(transport?.package, source?.center),
      connect: source =>
        new Transport(
          { ...macro.client, cookie: macro.client.cookie || cookie },
          source.quality
        )
    }
  );

  const stickers = async () => {
    const options = { ...macro.client.network?.httpOptions };
    const user = account?.() || {};
    let current = macro.client.cookie;

    if (!api.cookieString(current)) {
      current = user.cookie;
    }

    if (api.cookieString(current)) {
      options.cookie = current;
    }
    else {
      const identity = crypto
        .createHash('sha256')
        .update(JSON.stringify([user.userId, user.password, user.secondPw]))
        .digest('hex');

      if (attempted !== identity) {
        attempted = identity;
        cookie = null;

        if (user.userId && user.password) {
          let result = await api.login(user.userId, user.password, options);

          if (result?.data?.RESULT === -11 && user.secondPw) {
            result = await api.secondLogin(user.userId, user.secondPw, {
              ...options,
              cookie: result.cookie
            });
          }

          if (result?.data?.RESULT === 1) {
            cookie = result.cookie;
          }
        }
      }

      options.cookie = cookie;
    }

    return api.postOgqList(macro.client.bjId, options);
  };

  const refresh = () => {
    if (!macro.client.bjId) {
      return Promise.resolve();
    }

    if (assets) {
      return assets;
    }

    if (loaded && Date.now() - loaded < 30000) {
      return Promise.resolve();
    }

    loaded = Date.now();

    const bjId = macro.client.bjId;
    const cookie = api.cookieString(macro.client.cookie);

    const options = { ...macro.client.network?.httpOptions, cookie: macro.client.cookie };

    assets = Promise.allSettled([
      api.getStation(bjId, options),
      stickers(),
      api.getEmoticon(options),
      api.getSignature(bjId, options),
      api.getStatus(bjId, options),
      api.getDashboard(bjId, options)
    ])
      .then(([station, ogq, emoticon, signature, status, dashboard]) => {
        if (
          macro.closed
          || macro.client.bjId !== bjId
          || api.cookieString(macro.client.cookie) !== cookie
        ) {
          loaded = 0;

          return;
        }

        if (station.status === 'fulfilled' && station.value) {
          const data = station.value;

          profile = describe(bjId, data);
          macro.client.bjNick = data.station?.user_nick || macro.client.bjNick;
        }

        if (profile?.id === bjId && status.status === 'fulfilled') {
          profile.status = status.value?.DATA;
        }

        if (profile?.id === bjId && dashboard.status === 'fulfilled') {
          profile.dashboard = dashboard.value;
        }

        if (ogq.status === 'fulfilled' && Array.isArray(ogq.value?.data)) {
          macro.client.ogq = ogq.value;
        }

        if (
          emoticon.status === 'fulfilled'
          && emoticon.value
          && macro.client.mapEmoticon
        ) {
          const custom = signature.status === 'fulfilled' ? signature.value : [];

          macro.client.emoticon = macro.client.mapEmoticon(emoticon.value, custom);
        }
      })
      .finally(() => {
        assets = null;
      });

    return assets;
  };

  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' https: data:",
        "connect-src 'self'",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'none'"
      ].join('; ')
    );

    void Promise.resolve()
      .then(async () => {
        if (request.headers.host !== new URL(origin).host) {
          reply(response, 403, { error: '접속 주소 오류' });

          return;
        }

        if (request.headers.origin && request.headers.origin !== origin) {
          reply(response, 403, { error: '접속 주소 오류' });

          return;
        }

        if (request.method === 'GET' && request.url.startsWith('/media/')) {
          if (macro.closed) {
            reply(response, 410, { error: '프로그램 종료됨' });

            return;
          }

          await video.send(request, response);

          return;
        }

        if (request.method === 'GET' && request.url === '/hls.js') {
          const content = fs.readFileSync(new URL(import.meta.resolve('hls.js')));

          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          response.end(content);

          return;
        }

        const asset = files.get(request.url);

        if (request.method === 'GET' && asset) {
          const content = fs.readFileSync(
            new URL(`./editor/${asset[0]}`, import.meta.url)
          );

          response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
          response.end(content);

          return;
        }

        const address = new URL(request.url, origin);

        const routes = [
          '/api/config',
          '/api/editor',
          '/api/stream',
          '/api/chat',
          '/api/poll',
          '/api/user'
        ];

        if (!routes.includes(address.pathname)) {
          reply(response, 404, { error: '화면 없음' });

          return;
        }

        if (request.headers.authorization !== `Bearer ${token}`) {
          reply(response, 401, { error: '편집 화면을 다시 열어주세요' });

          return;
        }

        if (request.url === '/api/editor') {
          if (
            request.method === 'GET'
            && request.headers.accept === 'text/event-stream'
          ) {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write(': open\n\n');
            pages.add(response);
            seen = Date.now();

            const timer = setInterval(() => response.write(': alive\n\n'), 15000);

            timer.unref();
            response.once('close', () => {
              clearInterval(timer);
              pages.delete(response);
            });

            return;
          }

          const status = request.method === 'GET' ? 200 : 405;

          reply(response, status, { key, pages: pages.size });

          return;
        }

        if (macro.closed) {
          reply(response, 410, { error: '프로그램 종료됨' });

          return;
        }

        if (address.pathname === '/api/chat') {
          if (request.method === 'GET') {
            if (request.headers.accept === 'text/event-stream') {
              chat.listen(response);
            }
            else {
              const data = chat.history(
                address.searchParams.get('cursor') || '',
                address.searchParams.get('user') || '',
                address.searchParams.get('type') || ''
              );

              reply(response, 200, { ...data, state: chat.state() });
            }
          }
          else if (request.method === 'POST') {
            await chat.action(await body(request));
            reply(response, 200, {});
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/poll') {
          const poll = chat.poll;

          if (!poll || poll.status !== 1) {
            throw new Error('진행 중인 투표 없음');
          }

          if (request.method === 'GET') {
            const result = await macro.client.sendPollList(poll.surveyNo);

            if (result?.result !== 1 || chat.poll !== poll) {
              throw new Error('투표 조회 실패');
            }

            reply(response, 200, { survey: poll.surveyNo, ...result.data });
          }
          else if (request.method === 'POST') {
            const data = await body(request);
            const logged = macro.client.info?.IS_LOGIN === 1;

            if (!logged || data.survey !== poll.surveyNo) {
              throw new Error('투표 요청 오류');
            }

            const result = await macro.client.sendPollList(poll.surveyNo);
            const choice = result?.data?.list?.some(item => {
              return Number(item.answer_no) === data.answer;
            });

            if (!choice || chat.poll !== poll) {
              throw new Error('투표 항목 오류');
            }

            const sent = await macro.client.sendPoll(data.answer);

            if (sent?.result !== 1) {
              throw new Error(sent?.message || '투표 실패');
            }

            reply(response, 200, {});
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/user' && request.method === 'GET') {
          const id = address.searchParams.get('id') || '';

          if (!/^[a-zA-Z0-9_()-]{1,100}$/.test(id)) {
            throw new Error('사용자 아이디 오류');
          }

          const station = id.replace(/\(\d+\)$/, '');
          const data = await api.getStation(station, {
            ...macro.client.network?.httpOptions,
            signal: AbortSignal.timeout(5000)
          });

          if (address.searchParams.get('details') === '1') {
            const profile = describe(station, data);
            const options = {
              ...macro.client.network?.httpOptions,
              signal: AbortSignal.timeout(5000)
            };
            const [status, dashboard] = await Promise.allSettled([
              api.getStatus(station, options),
              api.getDashboard(station, options)
            ]);

            if (status.status === 'fulfilled') {
              profile.status = status.value?.DATA;
            }

            if (dashboard.status === 'fulfilled') {
              profile.dashboard = dashboard.value;
            }

            reply(response, 200, { image: data?.profile_image || '', profile });
          }
          else {
            reply(response, 200, { image: data?.profile_image || '' });
          }

          return;
        }

        if (address.pathname === '/api/stream') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const quality = address.searchParams.get('quality');

          if (quality && !/^[a-zA-Z0-9_-]{1,32}$/.test(quality)) {
            throw new Error('화질 오류');
          }

          const data = await video.open(quality);

          reply(response, 200, data);

          return;
        }

        if (request.method === 'PUT') {
          const data = await body(request);

          if (macro.closed) {
            reply(response, 410, { error: '프로그램 종료됨' });

            return;
          }

          const current = snapshot(macro);

          if (!data || data.revision !== current.revision) {
            reply(response, 409, { error: '설정이 변경되었습니다. 다시 불러와주세요' });

            return;
          }

          macro.save(data.config);
        }
        else if (request.method !== 'GET') {
          reply(response, 405, { error: '요청 오류' });

          return;
        }

        seen = Date.now();
        await refresh();

        const data = snapshot(macro);

        reply(response, 200, {
          ...data,
          player: macro.client.bjId || '',
          packs: packs(macro.client),
          emoticons: [...(macro.client.emoticon?.values() || [])],
          ceremonies: ceremonies(macro.client),
          sender: chat.user({
            userId: macro.client.userId,
            userNick: macro.client.info?.LOGIN_NICK || '미리보기',
            userFlag: macro.client.userFlag
          }),
          profile: profile?.id === macro.client.bjId ? profile : null,
          name:
            macro.client.bjNick || macro.client.station?.user_nick || macro.client.bjId
        });
      })
      .catch(error => {
        if (!response.headersSent && !response.destroyed) {
          reply(response, 400, { error: error.message || '설정 처리 실패' });
        }
        else {
          response.destroy();
        }
      });
  });

  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(previous?.port || 0, '127.0.0.1', resolve);
  });

  const origin = `http://127.0.0.1:${server.address().port}`;

  const url = `${origin}/#${token}`;

  void video.start();

  fs.writeFileSync(file, JSON.stringify({ port: server.address().port, token }), {
    mode: 0o600
  });

  if (browser) {
    if (previous) {
      await new Promise(resolve => setTimeout(resolve, 2500));
    }

    if (!seen) {
      launch(url);
    }
  }

  let closing;

  const close = () => {
    if (closing) {
      return closing;
    }

    const stopped = new Promise(resolve => server.close(resolve));

    closing = Promise.all([stopped, video.close()]);
    chat.close();
    editors.delete(macro);

    for (const socket of sockets) {
      socket.destroy();
    }

    return closing;
  };

  return { url, close, open: () => reopen(url) };
}
