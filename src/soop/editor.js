import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import * as api from '#soop/http';

const editors = new WeakMap();

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.js', ['index.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']]
]);

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

    result.push({ name: item.ogq_title || '', max: pack.max, images });
  }

  return result;
}

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
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
  const sockets = new Set();
  const pages = new Set();
  let seen = 0;
  let assets = null;
  let loaded = 0;
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
      macro.client.sendStation?.(),
      stickers(),
      api.getEmoticon(options),
      api.getSignature(bjId, options)
    ])
      .then(([station, ogq, emoticon, signature]) => {
        if (
          macro.closed
          || macro.client.bjId !== bjId
          || api.cookieString(macro.client.cookie) !== cookie
        ) {
          loaded = 0;

          return;
        }

        if (station.status === 'fulfilled' && station.value) {
          macro.client.bjNick = station.value.user_nick || macro.client.bjNick;
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

        const asset = files.get(request.url);

        if (request.method === 'GET' && asset) {
          const content = fs.readFileSync(
            new URL(`./editor/${asset[0]}`, import.meta.url)
          );

          response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
          response.end(content);

          return;
        }

        if (!['/api/config', '/api/editor'].includes(request.url)) {
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
          packs: packs(macro.client),
          emoticons: [...(macro.client.emoticon?.values() || [])],
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

    closing = new Promise(resolve => server.close(resolve));
    editors.delete(macro);

    for (const socket of sockets) {
      socket.destroy();
    }

    return closing;
  };

  return { url, close, open: () => reopen(url) };
}
