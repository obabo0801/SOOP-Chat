import crypto from 'crypto';
import net from 'net';
import os from 'os';
import path from 'path';

const connections = new WeakMap();

export function controlPath() {
  const root = process.platform === 'win32' ? process.cwd().toLowerCase() : process.cwd();

  const key = crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);

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

export async function requestMulti(action, target = '전체') {
  const value = new Promise((resolve, reject) => {
    const socket = net.createConnection(controlPath());

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

      reject(new Error(message));
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

export async function stopMulti() {
  const value = new Promise((resolve, reject) => {
    const socket = net.createConnection(controlPath());

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
