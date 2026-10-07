import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { isIP } from 'net';
import { spawn } from 'child_process';
import * as api from '#soop/http';
import { createVideo } from '#soop/video';
import { Transport } from '#soop/transport';
import { Package } from '#soop/package';
import { Chat } from '#soop/chat';
import * as control from '#soop/control';
import { DOMAIN } from '#soop/config';
import * as weflab from '#utils/weflab';

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
    broad: data.broad,
    favorite: data.is_favorite,
    subscribed: data.is_subscription,
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

async function createEditor(macro, options = {}) {
  const { browser = true, account, host = '127.0.0.1', port = 0, origins = [] } = options;

  if (typeof host !== 'string' || (!isIP(host) && host !== 'localhost')) {
    throw new Error('접속 IP 오류');
  }

  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Array.isArray(origins)) {
    throw new Error('접속 설정 오류');
  }

  const allowed = new Set();

  for (const value of origins) {
    let address;

    try {
      address = new URL(value);
    } catch {
      throw new Error('외부 주소 오류');
    }

    if (
      typeof value !== 'string'
      || !['http:', 'https:'].includes(address.protocol)
      || address.username
      || address.password
      || address.pathname !== '/'
      || address.search
      || address.hash
    ) {
      throw new Error('외부 주소 오류');
    }

    allowed.add(address.origin);
  }

  const hostname = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const authority = isIP(hostname) === 6 ? `[${hostname}]` : hostname;

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
  let signing = false;

  if (
    previous
    && (previous.host || '127.0.0.1') === host
    && (!port || previous.port === port)
    && JSON.stringify(previous.origins || []) === JSON.stringify([...allowed])
  ) {
    const origin = `http://${authority}:${previous.port}`;

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
    const user = macro.client.signedout ? {} : account?.() || {};
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

          if (result?.data?.RESULT === 1 && !macro.client.signedout) {
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
        const hosts = [...allowed].map(value => new URL(value).host);

        if (!hosts.includes(request.headers.host)) {
          reply(response, 403, { error: '접속 주소 오류' });

          return;
        }

        if (request.headers.origin && !allowed.has(request.headers.origin)) {
          reply(response, 403, { error: '접속 주소 오류' });

          return;
        }

        if (request.method === 'GET' && request.url.startsWith('/media/')) {
          const authenticated = request.headers.authorization === `Bearer ${token}`
            || request.headers.cookie?.split(';').some(value =>
              value.trim() === `soop-editor=${token}`
            );

          if (!authenticated) {
            reply(response, 401, { error: '사이트를 다시 열어주세요' });

            return;
          }

          if (macro.closed) {
            reply(response, 410, { error: '프로그램 종료 됨' });

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
          '/api/account',
          '/api/stream',
          '/api/chat',
          '/api/multi',
          '/api/notify',
          '/api/logs',
          '/api/kicks',
          '/api/members',
          '/api/roulette',
          '/api/poll',
          '/api/user'
        ];

        if (!routes.includes(address.pathname)) {
          reply(response, 404, { error: '화면 없음' });

          return;
        }

        if (request.headers.authorization !== `Bearer ${token}`) {
          reply(response, 401, { error: '사이트를 다시 열어주세요' });

          return;
        }

        const secure = [...allowed].some(value => {
          const address = new URL(value);

          return address.host === request.headers.host && address.protocol === 'https:';
        });
        const session = `soop-editor=${token}; Path=/; HttpOnly; SameSite=Strict`;

        response.setHeader('Set-Cookie', session + (secure ? '; Secure' : ''));

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
          reply(response, 410, { error: '프로그램 종료 됨' });

          return;
        }

        if (address.pathname === '/api/members') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const data = chat.members(
            address.searchParams.get('query') || '',
            address.searchParams.get('cursor') || ''
          );

          for (const user of data.entries) {
            if (user.role === '스트리머' && profile?.id === macro.client.bjId) {
              user.name = macro.client.bjNick || profile.station?.user_nick || user.name;
              user.image = profile.image;
            }
          }

          reply(response, 200, data);

          return;
        }

        if (address.pathname === '/api/roulette') {
          if (request.method !== 'POST') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const rule = await body(request);

          if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
            throw new Error('룰렛 설정 오류');
          }

          if (rule.default === undefined) {
            reply(response, 200, { message: '' });

            return;
          }

          const count = Number(rule.default);

          if (!Number.isSafeInteger(count) || count < 1) {
            throw new Error('룰렛 설정 오류');
          }

          const index =
            typeof rule.index === 'object'
              ? (rule.index?.[count] ?? 0)
              : (rule.index ?? 0);
          const numbers = rule.numbers || [];
          const title = rule.title || '';
          const invalid =
            !Number.isSafeInteger(index)
            || index < 0
            || !Array.isArray(numbers)
            || numbers.flat().some(value => !Number.isSafeInteger(value) || value < 1)
            || typeof title !== 'string';

          if (invalid) {
            throw new Error('룰렛 설정 오류');
          }

          let user;

          if (typeof macro.options.weflab === 'function') {
            user = macro.options.weflab();
          }
          else {
            user = macro.options.weflab;
          }

          if (!user) {
            throw new Error('WEFLAB 설정 없음');
          }

          const roulette = await weflab.roulette(user, count, index);
          const message = weflab.format(roulette, count, numbers, title);

          reply(response, 200, { message });

          return;
        }

        if (address.pathname === '/api/kicks') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const list = await chat.kicks();

          reply(response, 200, list);

          return;
        }

        if (address.pathname === '/api/logs') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const options = Object.fromEntries(address.searchParams);
          const data = chat.search(options);

          reply(response, 200, data);

          return;
        }

        if (address.pathname === '/api/notify') {
          const notify = macro.client.notify;

          if (!notify) {
            throw new Error('알림 설정을 사용할 수 없습니다.');
          }

          if (request.method === 'GET') {
            reply(response, 200, notify.settings());
          }
          else if (request.method === 'PUT') {
            reply(response, 200, notify.save(await body(request)));
          }
          else if (request.method === 'POST') {
            await notify.test(await body(request));
            reply(response, 200, {});
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/multi') {
          if (request.method === 'GET') {
            reply(response, 200, await control.multiStatus());
          }
          else if (request.method === 'POST') {
            const data = await body(request);

            if (data.action === 'start') {
              reply(response, 200, await control.startMulti(data.count));
            }
            else if (data.action === 'stop') {
              await control.stopMulti();
              reply(response, 200, { running: false, rows: [] });
            }
            else {
              throw new Error('명령 오류');
            }
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

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
            const result = await chat.action(await body(request));

            reply(response, 200, result || {});
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/poll') {
          const poll = chat.poll;

          if (!poll || ![1, 3, 4].includes(poll.status)) {
            throw new Error('진행 중인 투표 없음');
          }

          if (request.method === 'GET') {
            const result = await macro.client.sendPollList(poll.surveyNo);

            if (result?.result !== 1 || chat.poll !== poll) {
              throw new Error('투표 조회 실패');
            }

            reply(response, 200, {
              ...result.data,
              survey: poll.surveyNo,
              status: poll.status
            });
          }
          else if (request.method === 'POST') {
            const data = await body(request);
            const logged = macro.client.info?.IS_LOGIN === 1;

            if (!logged || poll.status !== 1 || data.survey !== poll.surveyNo) {
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

        if (address.pathname === '/api/account' && request.method === 'POST') {
          const data = await body(request);

          if (signing) {
            throw new Error('로그인 처리 중입니다.');
          }

          const client = macro.client;
          const previous = {
            cookie: client.cookie,
            info: client.info,
            signedout: client.signedout
          };

          signing = true;

          let authenticated = false;

          try {
            await client.connecting;

            if (!data || typeof data !== 'object') {
              throw new Error('로그인 요청 오류');
            }

            if (data.action === 'login') {
              if (client.info?.IS_LOGIN === 1) {
                throw new Error('이미 로그인되어 있습니다.');
              }

              const valid =
                typeof data.id === 'string'
                && typeof data.password === 'string'
                && (!data.second || typeof data.second === 'string');

              if (!valid || !data.id.trim() || !data.password) {
                throw new Error('아이디와 비밀번호를 입력해주세요.');
              }

              const result = await client.login(
                data.id.trim(),
                data.password,
                data.second || ''
              );

              if (result !== 1 || client.info?.IS_LOGIN !== 1) {
                client.cookie = previous.cookie;
                client.info = previous.info;

                if (result === -2) {
                  throw new Error('2차 비밀번호를 확인해주세요.');
                }

                throw new Error(
                  '로그인에 실패했습니다. 아이디와 비밀번호를 확인해주세요.'
                );
              }

              client.signedout = false;
              authenticated = true;
              cookie = null;

              const info = client.info;

              if (client.isOpen()) {
                client.disconnect();
                try {
                  await client.connect();
                } finally {
                  client.info = info;
                }
              }
            }
            else if (data.action === 'logout') {
              client.signedout = true;
              cookie = null;
              attempted = undefined;
              await client.logout();
            }
            else {
              throw new Error('로그인 요청 오류');
            }

            loaded = 0;
            chat.flag = null;
            reply(response, 200, { state: chat.state() });
          } catch (error) {
            if (data?.action === 'login' && !authenticated) {
              client.cookie = previous.cookie;
              client.info = previous.info;
            }

            if (client.cookie === previous.cookie) {
              client.signedout = previous.signedout;
            }

            throw error;
          } finally {
            signing = false;
            chat.broadcast('state', chat.state());
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

            reply(response, 200, {
              image: data?.profile_image || '',
              profile,
              user: chat.user({ userId: id })
            });
          }
          else {
            reply(response, 200, {
              image: data?.profile_image || '',
              user: chat.user({ userId: id })
            });
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
            reply(response, 410, { error: '프로그램 종료 됨' });

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
        const current = profile?.id === macro.client.bjId ? profile : null;
        const viewers = chat.state().viewers ?? current?.broad?.current_sum_viewer ?? 0;

        reply(response, 200, {
          ...data,
          origins,
          player: macro.client.bjId || '',
          packs: packs(macro.client),
          emoticons: [...(macro.client.emoticon?.values() || [])],
          ceremonies: ceremonies(macro.client),
          broadcast: {
            ...macro.client.broadcast,
            number: macro.client.channel?.BNO,
            languages: macro.client.channel?.LANG_TAGS || [],
            categories: macro.client.channel?.CATEGORY_TAGS || []
          },
          restricted: {
            password: macro.client.channel?.BPWD === 'Y',
            adult: Number(macro.client.channel?.GRADE) >= 19
          },
          viewers,
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
    server.listen(port || previous?.port || 0, host, resolve);
  });

  const origin = `http://${authority}:${server.address().port}`;

  allowed.add(origin);

  const url = `${origin}/#${token}`;

  void video.start();

  fs.writeFileSync(file, JSON.stringify({
    port: server.address().port,
    token,
    host,
    origins: [...allowed].filter(value => value !== origin)
  }), {
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
