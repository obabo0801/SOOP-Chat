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

import { watchHandler, watchStyles } from './editor/reload.js';
import { listenEditor, launchSession } from './editor/launch.js';
import { createScreens, screenSession } from './editor/screens.js';
import { storedScreens } from './editor/storage.js';

const editors = new WeakMap();

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
  const { browser = true, account, host = '127.0.0.1', port = 0, origins = [], password = '', accessPassword = '' } = options;

  if (typeof password !== 'string' || typeof accessPassword !== 'string') {
    throw new Error('비밀번호 오류');
  }

  const passwordHash = crypto.createHash('sha256').update(password).digest();
  const attempts = new Map();
  const accessHash = crypto.createHash('sha256').update(accessPassword).digest();
  const accessAttempts = new Map();

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
    .update(String(port))
    .update(String(options.count ?? 10))
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

  const token = options.token || previous?.token || crypto.randomBytes(32).toString('hex');
  const accessToken = options.accessToken || (/^[a-f0-9]{64}$/.test(previous?.accessToken || '')
    ? previous.accessToken : crypto.randomBytes(32).toString('hex'));
  const chat = new Chat(macro.client, { directory: macro.history?.directory });
  const sockets = new Set();
  const pages = new Map();

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
        cookie: macro.client.cookie || context.cookie,
        password: macro.client.broadPw,
        signal
      });

      if (stream) {
        const preset = stream.qualities.find(item => item.name === stream.quality);
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
          { ...macro.client, cookie: macro.client.cookie || context.cookie },
          source.quality
        )
    }
  );

  const context = {
    macro, account, password, passwordHash, attempts, allowed, token, chat, video, pages, key, origins,
    videoEnabled: options.videoEnabled !== false,
    accessPassword, accessHash, accessAttempts, accessToken,
    stop: options.stop,
    fixed: Boolean(options.fixed),
    basicAccount: options.basicAccount || options.recovery?.basicAccount || '',
    root: Boolean(options.root),
    accounts: Array.isArray(options.accounts) ? new Map(options.accounts.map(item =>
      [item.id, { ...item, info: null }])) : undefined,
    host, count: options.count ?? 10, range: options.range, sessionReady: Boolean(options.sessionReady),
    seen: 0, assets: null, loaded: 0, profile: null, cookie: null, attempted: undefined, signing: false,
    get origin() {
      return origin;
    }
  };
  const router = await watchHandler(new URL('./editor/server.js', import.meta.url), context);
  const unwatch = watchStyles(context);
  const server = http.createServer((request, response) => router.handle(request, response));

  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  try {
    context.range = await listenEditor(server, {
      port: options.recovery?.port || port || previous?.port || 0,
      count: context.count, host, range: options.recovery?.range || options.range
    });
  } catch (error) {
    router.close();
    unwatch();
    chat.close();
    await video.close();

    throw error;
  }

  const origin = `http://${authority}:${server.address().port}`;
  macro.client.multiScope = String(server.address().port);

  allowed.add(origin);
  context.screens = createScreens(context);
  if (context.root) {
    void (async () => {
      for (const { number, value } of storedScreens(context.range.count)) {
        const next = context.range.start + number - 1;
        if (next === server.address().port) continue;
        try { screenSession(context, number); continue; } catch {}
        try {
          await launchSession({ ...value.settings, restore: true, token: value.editor.token,
            basicAccount: value.editor.basicAccount },
            server.address().port, context.range, host, next);
        } catch (error) {
          console.error('[접속 복원]', error.message);
        }
      }
    })();
  }

  const url = `${origin}/#${token}`;

  void video.start();

  fs.writeFileSync(file, JSON.stringify({
    port: server.address().port,
    token,
    accessToken,
    host,
    origins: [...allowed].filter(value => value !== origin)
  }), {
    mode: 0o600
  });

  if (browser) {
    if (previous) {
      await new Promise(resolve => setTimeout(resolve, 2500));
    }

    if (!context.seen) {
      launch(url);
    }
  }

  let closing;

  const close = (options = {}) => {
    if (closing) {
      return closing;
    }

    router.close();
    unwatch();
    context.stopRequested = Boolean(options.forget);
    context.screens.close();
    context.previews?.close();
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
