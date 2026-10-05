import { WebSocket } from 'ws';
import { SoopClient } from '#soop/client';
import * as http from '#soop/http';

export class SoopManager {
    constructor({
        concurrency = Infinity,
        retries = 3,
        retryDelay = 1000,
        reconnectInterval = 10000
    } = {}) {
        if (
            (
                concurrency !== Infinity
                && (!Number.isSafeInteger(concurrency) || concurrency < 1)
            )
            || ![retries, retryDelay, reconnectInterval].every(value =>
                Number.isSafeInteger(value) && value > 0
            )
        ) {
            throw new Error('연결 설정 오류');
        }

        this.clients = new Map();
        this.tasks = [];
        this.active = 0;
        this.concurrency = concurrency;
        this.retries = retries;
        this.retryDelay = retryDelay;
        this.closed = false;
        this.stopTask = null;

        this.timer = setInterval(() => {
            for (const [id, entry] of this.clients) {
                if (
                    entry.wanted
                    && !entry.pending
                    && entry.retryAt <= Date.now()
                    && (
                        !entry.client.isOpen()
                        || !entry.client.bridge?.isOpen()
                    )
                ) {
                    void this.connect(id).catch(() => {});
                }
            }
        }, reconnectInterval);

        this.timer.unref();
    }

    add(id, options = {}) {
        if (this.closed) {
            throw new Error('관리자 종료');
        }

        if (
            !Number.isSafeInteger(id)
            || id < 1
            || this.clients.has(id)
        ) {
            throw new Error('연결 번호 오류');
        }

        const client = new SoopClient({
            ...options,
            auto: false
        });

        this.clients.set(id, {
            client,
            options,
            authenticated: false,
            pending: null,
            error: null,
            wanted: false,
            controller: null,
            failures: 0,
            retryAt: 0
        });

        return client;
    }

    get(id) {
        const entry = this.clients.get(id);

        if (!entry) {
            throw new Error('연결 번호 없음');
        }

        return entry;
    }

    connect(id) {
        if (this.closed) {
            throw new Error('관리자 종료');
        }

        const entry = this.get(id);

        if (entry.pending) {
            return entry.pending;
        }

        entry.wanted = true;

        if (entry.client.isOpen() && entry.client.bridge?.isOpen()) {
            return Promise.resolve(true);
        }

        entry.controller = new AbortController();
        entry.client.signal = entry.controller.signal;
        entry.client.network.signal = entry.controller.signal;

        entry.controller.signal.addEventListener('abort', () => {
            for (const socket of [entry.client.ws, entry.client.bridge?.ws]) {
                if (!socket) {
                    continue;
                }

                if (socket.readyState === WebSocket.CONNECTING) {
                    socket.terminate();
                }
                else {
                    socket.close(1000);
                }
            }
        }, { once: true });

        entry.pending = new Promise(resolve => {
            this.tasks.push({ id, entry, resolve });
        }).finally(() => {
            entry.pending = null;
        });

        this.drain();

        return entry.pending;
    }

    drain() {
        while (
            !this.closed
            && this.active < this.concurrency
            && this.tasks.length
        ) {
            const task = this.tasks.shift();

            if (!task.entry.wanted || task.entry.controller.signal.aborted) {
                task.resolve(false);

                continue;
            }

            this.active++;

            Promise.resolve()
                .then(() => this.open(task.id, task.entry))
                .then(task.resolve, () => task.resolve(false))
                .finally(() => {
                    this.active--;
                    this.drain();
                });
        }
    }

    async open(id, entry) {
        const { client, options } = entry;
        const signal = entry.controller.signal;
        entry.error = null;

        for (let attempt = 0; attempt < this.retries; attempt++) {
            try {
                signal.throwIfAborted();
                client.disconnect(false);

                if (!entry.authenticated) {
                    if (!client.cookie && options.userId) {
                        if (!options.password) {
                            throw new Error('비밀번호 없음');
                        }

                        const result = (
                            await client.login(
                                options.userId,
                                options.password,
                                options.secondPw
                            )
                        );

                        if (result !== 1) {
                            throw new Error('로그인 실패');
                        }
                    }

                    if (client.cookie) {
                        const info = await http.getPrivateInfo({
                            ...client.network.httpOptions,
                            cookie: client.cookie
                        });

                        if (Number(info?.IS_LOGIN) !== 1) {
                            throw new Error('인증 오류');
                        }
                    }

                    entry.authenticated = true;
                }

                signal.throwIfAborted();

                if (!await client.connect()) {
                    throw new Error('연결 실패');
                }

                signal.throwIfAborted();
                entry.error = null;
                entry.failures = 0;
                entry.retryAt = 0;

                return true;
            } catch {
                entry.error = '연결 실패';
                entry.failures++;
                entry.retryAt = Date.now() + Math.min(
                    this.retryDelay * 2 ** Math.min(entry.failures, 6),
                    60000
                );
                client.disconnect(false);

                if (signal.aborted || !entry.wanted || this.closed) {
                    return false;
                }

                if (attempt + 1 < this.retries) {
                    await new Promise(resolve => {
                        const done = () => {
                            clearTimeout(timer);
                            signal.removeEventListener('abort', done);
                            resolve();
                        };

                        const timer = setTimeout(
                            done,
                            Math.max(0, entry.retryAt - Date.now())
                            + Math.floor(Math.random() * this.retryDelay)
                        );

                        signal.addEventListener('abort', done, { once: true });
                    });
                }
            }
        }

        return false;
    }

    async disconnect(id) {
        const entry = this.get(id);
        const sockets = [entry.client.ws, entry.client.bridge?.ws]
            .filter(Boolean);

        const closed = Promise.all(sockets.map(socket => {
            return new Promise(resolve => {
                if (socket.readyState === WebSocket.CLOSED) {
                    resolve();

                    return;
                }

                const done = () => {
                    clearTimeout(timer);
                    socket.off('close', done);
                    resolve();
                };

                const timer = setTimeout(() => {
                    socket.terminate();
                    done();
                }, 3000);

                socket.once('close', done);
            });
        }));

        entry.wanted = false;
        entry.controller?.abort();
        entry.client.auto = false;
        entry.client.disconnect(false);

        this.tasks = this.tasks.filter(task => {
            if (task.entry !== entry) {
                return true;
            }

            task.resolve(false);

            return false;
        });

        if (entry.pending) {
            await entry.pending.catch(() => {});
        }

        await closed;

        entry.error = null;
    }

    async run(action, ids = [...this.clients.keys()]) {
        if (!['connect', 'disconnect'].includes(action)) {
            throw new Error('작업 오류');
        }

        const targets = [...ids];
        targets.forEach(id => this.get(id));

        return new Map(await Promise.all(
            targets.map(async id => {
                try {
                    const value = (
                        this.closed
                        ? false
                        : await this[action](id)
                    );

                    return [id, {
                        result: value !== false
                    }];
                } catch {
                    return [id, {
                        result: false
                    }];
                }
            })
        ));
    }

    status() {
        return [...this.clients].map(([id, entry]) => ({
            id,
            connected: entry.client.isOpen(),
            connecting: Boolean(entry.pending),
            authenticated: (
                entry.authenticated
                && Number(entry.client.info?.IS_LOGIN) === 1
            ),
            idle: entry.client.idle,
            error: entry.error
        }));
    }

    destroy() {
        if (this.stopTask) {
            return this.stopTask;
        }

        this.closed = true;
        clearInterval(this.timer);

        for (const task of this.tasks.splice(0)) {
            task.resolve(false);
        }

        this.stopTask = Promise.all(
            [...this.clients.keys()].map(async id => {
                await this.disconnect(id);
                await this.get(id).client.destroy();
            })
        ).then(() => {
            this.clients.clear();
        });

        return this.stopTask;
    }
}
