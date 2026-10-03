import crypto from 'crypto';
import net from 'net';
import os from 'os';
import path from 'path';

export function controlPath() {
    const root = (
        process.platform === 'win32'
        ? process.cwd().toLowerCase() : process.cwd()
    );

    const key = crypto
        .createHash('sha256')
        .update(root)
        .digest('hex')
        .slice(0, 16);

    return (process.platform === 'win32'
        ? `\\\\.\\pipe\\soop-chat-${key}`
        : path.join(os.tmpdir(), `soop-chat-${key}.sock`)
    );
}

export async function listenControl(stop, run) {
    const server = net.createServer(socket => {
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

            socket.removeAllListeners('data');

            if (input.trim() !== 'stop') {
                Promise.resolve().then(() => {
                    if (!run) {
                        throw new Error('멀티 명령 오류');
                    }

                    return run(JSON.parse(input));
                }).then(data => {
                    socket.end(`${JSON.stringify({ ok: true, data })}\n`);
                }).catch(() => {
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

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(controlPath(), resolve);
    });

    return server;
}

export async function requestMulti(action, target = '전체') {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(controlPath());
        socket.setEncoding('utf8');

        let result = '';

        socket.once('connect', () => {
            socket.write(`${JSON.stringify({ action, target })}\n`);
        });

        socket.on('data', data => {
            result += data;
        });

        socket.once('error', error => {
            const message = (
                ['ENOENT', 'ECONNREFUSED'].includes(error.code)
                ? '멀티 연결 없음' : '멀티 명령 실패'
            );

            reject(new Error(message));
        });

        socket.once('end', () => {
            try {
                const response = JSON.parse(result);

                if (!response.ok) {
                    throw new Error('멀티 명령 오류');
                }

                resolve(response.data);
            } catch {
                reject(new Error('멀티 명령 오류'));
            }
        });
    });
}

export async function stopMulti() {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(controlPath());
        socket.setEncoding('utf8');

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
            } else {
                reject(new Error('종료 실패'));
            }
        });
    });
}
