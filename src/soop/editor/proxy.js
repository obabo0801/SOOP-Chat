import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import * as launch from './launch.js';
import * as screens from './screens.js';
import * as visit from './visit.js';

export function proxyScreen(request, response, state) {
  const address = new URL(request.url, state.origin);
  const match = /^\/(\d+)(\/.*)?$/.exec(address.pathname);

  if (!match) {
    return false;
  }

  const number = Number(match[1]);
  const range = launch.portRange(state.range);
  const port = range.start + Math.max(0, number - 1);
  const reject = (status, message) => {
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: message }));
  };

  if (!Number.isSafeInteger(number) || number < 1 || number > range.count
    || request.headers.origin && !state.allowed.has(request.headers.origin)) {
    reject(403, '화면 접속 권한이 없습니다.');

    return true;
  }

  try {
    const lock = path.join(os.tmpdir(), `soopeditor${port}.lock`);
    const lease = JSON.parse(fs.readFileSync(fs.existsSync(lock) ? lock : screens.screenFile(port), 'utf8'));

    if (lease.workspace !== process.cwd() || !Number.isInteger(lease.pid) || lease.pid <= 0) {
      throw new Error('화면 없음');
    }

    process.kill(lease.pid, 0);
  } catch {
    reject(404, '화면이 종료되었습니다.');

    return true;
  }

  if (!match[2]) {
    response.writeHead(302, { Location: `${address.pathname}/${address.search}` });
    response.end();

    return true;
  }

  const prefix = `/${number}`;
  const host = state.host && !['0.0.0.0', '::'].includes(state.host) ? state.host : '127.0.0.1';
  const authority = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
  const headers = { ...request.headers, host: authority };
  headers['x-forwarded-for'] = visit.clientAddress(request);
  headers['x-soop-visitor'] = visit.clientAddress(request, true);
  headers['x-soop-url'] = visit.visitDetails(request).address;
  delete headers['x-vercel-forwarded-for'];
  headers['x-soop-screen'] = String(number);

  if (headers.origin) {
    headers.origin = `http://${authority}`;
  }

  delete headers.connection;
  delete headers['accept-encoding'];
  const upstream = http.request({ host, port, method: request.method, path: match[2] + address.search, headers }, incoming => {
    incoming.once('error', () => reject(502, '화면 연결이 끊겼습니다.'));
    incoming.once('aborted', () => reject(502, '화면 연결이 끊겼습니다.'));
    const output = { ...incoming.headers };
    if (/^\/\d+\/(?:media\/|api\/chat$)/.test(address.pathname) && request.headers.origin
      && state.allowed.has(request.headers.origin)) {
      output['access-control-allow-origin'] = request.headers.origin;
    }
    const type = output['content-type'] || '';
    const secure = [...state.allowed].some(origin => {
      const url = new URL(origin);

      return url.host === request.headers.host && url.protocol === 'https:';
    });

    if (output['set-cookie']) {
      output['set-cookie'] = output['set-cookie'].map(cookie => {
        const value = cookie.replace(/Path=\//i, `Path=${prefix}/`);

        return secure && !/;\s*Secure/i.test(value) ? `${value}; Secure` : value;
      });
    }

    if (/text\/event-stream/.test(type)) {
      upstream.setTimeout(0);
    }

    if (!/text\/html|javascript|application\/json|mpegurl/i.test(type)) {
      response.writeHead(incoming.statusCode, output);
      incoming.pipe(response);

      return;
    }

    const chunks = [];
    let size = 0;

    incoming.on('data', chunk => {
      size += chunk.length;

      if (size > 8388608) {
        reject(502, '화면 응답을 불러오지 못했습니다.');
        incoming.destroy();
      }
      else {
        chunks.push(chunk);
      }
    });
    incoming.on('end', () => {
      if (response.destroyed || response.writableEnded) {
        return;
      }

      let content = Buffer.concat(chunks).toString('utf8');

      if (/text\/html/.test(type)) {
        content = content.replace(/((?:src|href|action)=["'])\/(?!\/)/g, `$1${prefix}/`);
      }
      else if (/javascript/.test(type)) {
        content = content.replace(/((?:from\s+|import\s*\(\s*)["'])\/(?!\/)/g, `$1${prefix}/`)
          .replace(/(["'`])\/(api|media)\//g, `$1${prefix}/$2/`);
      }
      else if (/application\/json/.test(type)) {
        try {
          const value = JSON.parse(content);
          const rewrite = data => {
            if (!data || typeof data !== 'object') {
              return;
            }

            for (const [key, item] of Object.entries(data)) {
              if (['url', 'download'].includes(key) && typeof item === 'string' && item.startsWith('/media/')) {
                data[key] = prefix + item;
              }
              else {
                rewrite(item);
              }
            }
          };

          rewrite(value);
          content = JSON.stringify(value);
        } catch {}
      }
      else {
        content = content.replace(/(^|URI=")\/media\//gm, `$1${prefix}/media/`);
      }

      delete output['transfer-encoding'];
      output['content-length'] = Buffer.byteLength(content);
      response.writeHead(incoming.statusCode, output);
      response.end(content);
    });
  });

  upstream.setTimeout(60000, () => upstream.destroy(new Error('화면 연결 시간 초과')));
  upstream.on('error', () => {
    reject(502, '화면 연결이 끊겼습니다.');
  });
  response.once('close', () => upstream.destroy());
  request.pipe(upstream);

  return true;
}
