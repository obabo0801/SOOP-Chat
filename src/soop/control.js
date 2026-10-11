import crypto from 'crypto';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import * as tenants from '#soop/tenants';

const connections = new WeakMap();
const starting = new Set();

function scope(client) {
  return client ? String(client.multiScope || process.pid) : process.env.MULTISCOPE || '';
}

export async function multiStatus(client) {
  try {
    const rows = await requestMulti('status', '전체', client);

    return { running: true, rows };
  } catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) {
      return { running: false, rows: [] };
    }

    throw error;
  }
}

export async function startMulti(count, client) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('연결 개수 오류');
  }

  const key = scope(client);
  if (starting.has(key)) {
    throw new Error('실행 준비 중');
  }

  starting.add(key);
  const task = (async () => {
    const current = await multiStatus(client);

    const env = client ? { ...process.env, MULTISCOPE: key, MULTIBJID: client.bjId,
      MULTIPW: client.broadPw || '' } : process.env;
    tenants.tenantOptions(client ? undefined : tenants.loadTenants(), count,
      client ? { ...env, BJID: client.bjId, BROADPW: client.broadPw || '' } : env);

    if (current.running) {
      await stopMulti(client);
    }

    const child = spawn(
      process.execPath,
      ['--no-maglev', fileURLToPath(new URL('./editor/runtime.js', import.meta.url)), 'multi', String(count)],
      {
        cwd: process.cwd(),
        env,
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore']
      }
    );

    let failed = false;

    child.once('error', () => {
      failed = true;
    });
    child.once('exit', () => {
      failed = true;
    });
    child.stdin.on('error', () => {});

    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 200));

        if (failed) {
          throw new Error('멀티 실행 실패');
        }

        const result = await multiStatus(client);

        if (result.running) {
          return { ...result, updated: current.running };
        }
      }

      throw new Error('멀티 실행 시간 초과');
    } catch (error) {
      child.stdin.end();

      throw error;
    }
  })();

  try {
    return await task;
  } finally {
    starting.delete(key);
  }
}

export function controlPath(client) {
  const root = process.platform === 'win32' ? process.cwd().toLowerCase() : process.cwd();

  const group = scope(client);
  const key = crypto.createHash('sha256').update(group ? `${root}:${group}` : root).digest('hex').slice(0, 16);

  let result;

  if (process.platform === 'win32') {
    result = `\\\\.\\pipe\\soop-chat-${key}`;
  }
  else {
    result = path.join(os.tmpdir(), `soop-chat-${key}.sock`);
  }

  return result;
}

export async function listenControl(stop, run) {
  const pending = new Set();

  const server = net.createServer(socket => {
    pending.add(socket);
    socket.once('close', () => pending.delete(socket));
    socket.setTimeout(15000, () => socket.destroy());
    socket.setEncoding('utf8');
    socket.on('error', () => {});

    let input = '';

    socket.on('data', data => {
      input += data;

      if (input.length > 256) {
        return socket.destroy();
      }

      if (!input.includes('\n')) {
        return;
      }

      pending.delete(socket);
      socket.removeAllListeners('data');

      if (input.trim() !== 'stop') {
        Promise.resolve()
          .then(() => {
            if (!run) {
              throw new Error('명령 오류');
            }

            const result = run(JSON.parse(input));

            return result;
          })
          .then(data => {
            socket.end(`${JSON.stringify({ ok: true, data })}\n`);
          })
          .catch(() => {
            socket.end(`${JSON.stringify({ ok: false })}\n`);
          });

        return;
      }

      stop().then(
        () => socket.end('stopped\n'),
        () => socket.end('failed\n')
      );
    });
  });

  connections.set(server, pending);
  server.once('close', () => connections.delete(server));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(controlPath(), resolve);
  });

  return server;
}

export function closeControl(server) {
  if (!server) {
    return;
  }

  server.close();

  for (const socket of connections.get(server) || []) {
    socket.destroy();
  }
}

export async function requestMulti(action, target = '전체', client) {
  const value = new Promise((resolve, reject) => {
    const socket = net.createConnection(controlPath(client));

    socket.setEncoding('utf8');
    socket.setTimeout(15000, () => {
      socket.destroy();
      reject(new Error('명령 시간 초과'));
    });

    let result = '';

    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ action, target })}\n`);
    });

    socket.on('data', data => {
      result += data;
    });

    socket.once('error', error => {
      let message;

      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) {
        message = '연결 없음';
      }
      else {
        message = '명령 실패';
      }

      const failure = new Error(message);

      failure.code = error.code;
      reject(failure);
    });

    socket.once('end', () => {
      try {
        const response = JSON.parse(result);

        if (!response.ok) {
          throw new Error('명령 오류');
        }

        resolve(response.data);
      } catch {
        reject(new Error('명령 오류'));
      }
    });
  });

  return value;
}

export async function stopMulti(client) {
  const value = new Promise((resolve, reject) => {
    const socket = net.createConnection(controlPath(client));

    socket.setEncoding('utf8');
    socket.setTimeout(20000, () => {
      socket.destroy();
      reject(new Error('종료 시간 초과'));
    });

    let result = '';

    socket.once('connect', () => {
      socket.write('stop\n');
    });

    socket.on('data', data => {
      result += data;
    });

    socket.once('error', reject);

    socket.once('end', () => {
      if (result.trim() === 'stopped') {
        resolve();
      }
      else {
        reject(new Error('종료 실패'));
      }
    });
  });

  return value;
}
