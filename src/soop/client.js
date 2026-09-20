import { WebSocket } from 'ws';
import crypto from 'crypto';
import { Bridge } from '#soop/bridge';
import { Package } from '#soop/package';
import * as http from '#soop/http';
import * as packet from '#soop/packet';
import * as handler from '#soop/handler';

import {
    DOMAIN,
    ICE_AUTH
} from '#soop/config';

export class SoopClient {
    constructor(options = {}) {
        this.ws = null;
        this.bridge = null;
        this.package = null;

        this.station = null;

        this.liveTimer = null;
        this.sessionTimer = null;
        this.contentWatch = null;
        this.contentStates = new Map();

        this.bjNick = null;

        this.userList = new Map();
        this.events = new Map();

        this.ping = null;

        this.emoticon = null;
        this.recent = null;
        this.signature = null;
        this.ogq = null;

        this.init(options);
    }

    init(options = {}) {
        this.bjId = (
            options.bjId
        );

        this.pver = (
            options.pver ?? 2
        );

        this.broadPw = (
            options.broadPw
        );

        this.auto = (
            options.auto ?? false
        );

        this.subtitle = (
            options.subtitle ?? -1
        );

        this.cookie = (
            options.cookie
        );

        this.delay = (
            options.delay ?? 80
        );

        this.auth = null;
        this.pending = null;
        this.ending = null;

        this.channel = null;
        this.userId = null;
        this.userFlag = null;

        this.info = null;
        this.category = new Map();
        this.rule = null;
        this.poll = null;

        this.iceMode = null;
        this.direct = null;

        this.userList.clear();

        this.uuid = (
            options.uuid
            ||  crypto
            .randomBytes(16)
            .toString('hex')
        );
        
        this.guid = (
            options.guid
            ||  crypto
            .randomBytes(16)
            .toString('hex')
            .toUpperCase()
        );

        this.broadcast = {
            title: '',
            category: '',
            hashtag: '',
        };

        this.queue = Promise.resolve();
    }

    on(event, handler) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }

        this.events.get(event).push(handler);
        return this;
    }

    off(event, handler) {
        const handlers = this.events.get(event) || [];

        this.events.set(
            event,
            handlers.filter(fn => fn !== handler)
        );

        return this;
    }

    once(event, handler) {
        const wrapper = payload => {
            this.off(event, wrapper);
            handler(payload);
        };

        this.on(event, wrapper);
        return this;
    }

    emit(event, ...args) {
        const handlers = this.events.get(event) || [];

        for (const handler of handlers) {
            handler(...args);
        }
    }

    sleep(ms = this.delay) {
        return new Promise(resolve =>
            setTimeout(resolve, ms)
        );
    }

    safe(task) {
        return Promise.resolve()
            .then(task)
            .catch(error => {
                this.emit('error', error);
            });
    }
    
    isOpen() {
        return (this.ws
            && this.ws.readyState === WebSocket.OPEN
        );
    }

    async login(userId, password, secondPw = '') {
        const result = (
            await http.login(
            userId, password,
            { cookie: this.cookie }
        ));

        if (!result) return 0;

        if (result.data.RESULT === -11) {
            return await this.secondLogin(
                userId, secondPw
            );
        }

        if (result.data.RESULT !== 1) {
            return -1;
        }

        if (result.cookie?.AuthTicket) {
            this.cookie = result.cookie;
        }

        await this.loadBasics();

        this.info = await http.getPrivateInfo({
            cookie: this.cookie
        });

        return result.data.RESULT;
    }

    async secondLogin(userId, secondPw) {
        const result = (
            await http.secondLogin(
            userId, secondPw,
            { cookie: this.cookie }
        ));

        if (!result) return 0;

        if (result.data.RESULT !== 1) {
            return -2;
        }

        if (result.cookie?.AuthTicket) {
            this.cookie = result.cookie;
        }

        await this.loadBasics();

        this.info = await http.getPrivateInfo({
            cookie: this.cookie
        });

        return result.data.RESULT;
    }

    async logout() {
        if (!this.cookie?.AuthTicket) {
            return false;
        }

        const result = await http.logout(
            { cookie: this.cookie }
        );

        const re = this.disconnect();

        this.init({
            bjId: this.bjId,
            pver: this.pver,
            broadPw: this.broadPw,
            auto: this.auto,
            delay: this.delay,
            subtitle: this.subtitle,
            cookie: null
        });

        if (re) {
            await this.connect();
        }

        return true;
    }

    async connect(bjId = '', broadPw = '') {
        if (this.isOpen()) {
            return false;
        }

        if (!bjId) {
            bjId = this.bjId;
        }
        if (this.bjId !== bjId) {
            this.stopPackage();
        }
        this.bjId = bjId;

        if (!broadPw) {
            broadPw = this.broadPw;
        }
        this.broadPw = broadPw;

        if (!bjId) return false;

        await this.startContent();

        await this.loadBasics();

        if (!this.channel) {
            return false;
        }

        await this.loadAssets();

        if (!this.isAuth()) {
            return false;
        }

        const check = (
            await this.connectBridge()
        );

        if (!check) return false;

        const ws = (
            await this.connectWs()
        );

        if (!ws) return false;

        return true;
    }

    isAuth(channel = this.channel) {
        if (!channel) {
            return false;
        }

        const pw = channel.BPWD;

        if (pw === 'Y' && !this.broadPw) {
            if (this.auth !== 2
                && this.auto) {
                this.emitAuto(2);
                this.startLive();
            }
            return false;
        }

        const result = channel.RESULT;
        const options = {
            result,
            message: channel.MSG
        };

        if (result !== 1) {
            if (this.auth !== result
                && this.auto) {
                this.emitAuto(result, options);
                this.startLive();
            }

            else if (!this.auto) {
                this.emitAuto(3, options);
            }
            return false;
        }

        if (!this.pending) {
            this.emitAuto(result);
            this.channel = channel;
            this.startLive();
        }

        return true;
    }

    async openSocket() {
        await new Promise((resolve, reject) => {
            let settled = false;

            const finish = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                this.off('join', done);

                if (error) reject(error);
                else resolve(true);
            };

            const timeout = setTimeout(() => {
                finish(new Error(
                    '채팅 연결 시간이 초과되었습니다.'
                ));
            }, 10000);

            const done = async () => {
                this.off('join', done);

                try {
                    await this.sendClubColor(0);

                    if (this.pver !== 0) {
                        await this.sendUserList();
                    }

                    await this.sendSubtitle();

                    finish();
                } catch (error) {
                    finish(error);
                }
            };

            this.on('join', done);

            this.ws.on('open', () => {
                this.sendLogin();
                this.startPing();
            });

            this.ws.on('message', data => {
                handler.dispatch(
                    this, 
                    packet.parse(data)
                );
            });

            this.ws.on('error', error => {
                finish(error);
                this.emit('error', error);
            });

            this.ws.on('close', () => {
                this.stopPing();
                finish(new Error(
                    '채팅 연결이 완료되기 전에 연결이 종료되었습니다.'
                ));
            });
        });
    }

    async connectWs() {
        const url = this.makeChatUrl(
            this.channel
        );

        if (!url) return false;
        
        const headers = {
            ...(this.cookie ? {
                Cookie: http.cookieString(this.cookie)
            } : {})
        };

        await this.sleep();

        this.ws = new WebSocket(url, 'chat', {
            headers
        });

        try {
            await this.openSocket();
        } catch (error) {
            this.closeWs();
            this.closeBridge();
            throw error;
        }
        this.startSession();

        return true;
    }

    closeWs() {
        if (!this.ws) {
            return false;
        }

        this.stopSession();

        this.ws.close();
        this.ws = null;

        return true;
    }

    disconnect(show = true) {
        this.stopPackage();
        this.stopPing();
        if (!this.auto) {
            this.stopLive();
        }

        this.closeBridge();
        this.closeWs();
        if (!this.auto) {
            this.stopContent();
        }

        const data = {
            bjId: this.bjId,
            bjNick: this.bjNick
        };

        if (this.ending) {
            data.message = this.ending;
        }

        if (show) {
            this.emit('close', {
                message: this.ending,
                bjId: this.bjId,
                bjNick: this.bjNick
            });
        }

        this.init({
            bjId: this.bjId,
            pver: this.pver,
            broadPw: this.broadPw,
            auto: this.auto,
            delay: this.delay,
            subtitle: this.subtitle,
            cookie: this.cookie
        });

        return true;
    }

    makeChatUrl(channel = {}) {
        const { CHDOMAIN, CHPT, BJID } = channel;

        if (!CHDOMAIN || !CHPT) return false;

        const port = `:${Number(CHPT) + 1}`;
        const domain = `${CHDOMAIN}${port}`;

        return (domain.startsWith('ws')
            ? `${domain}/Websocket/${BJID}`
            : `wss://${domain}/Websocket/${BJID}`
        );
    }

    send(data, delay = this.delay) {
        if (!this.isOpen()) {
            return false;
        }

        this.queue = this.queue.then(() => {
        return new Promise((resolve) => {

            if (!this.isOpen()) {
                resolve(false);
                return;
            }

            this.ws.send(data, error => {
                if (error) {
                    this.emit('error', error);
                    resolve(false);
                    return;
                }
                resolve(true);
            });

        })}).then(async (result) => {
            await this.sleep(delay);
            return result;
        });

        return this.queue;
    }

    sendLogin() {
        const flag = (
            this.info?.IS_LOGIN === 1
            ? 524288 + 16
            : 16
        );

        return this.send(packet.makeLogin(
            this.channel?.TK || '',
            flag
        ));
    }

    sendJoinChannel(password = this.broadPw) {
        const uuid = (
            this.cookie?._au
            || this.uuid
        );

        return this.send(
            packet.makeJoinChannel(
            this.channel, this.pver,
            password, uuid
        ));
    }

    sendPing() {
        this.send(packet.makeKeepAlive());
    }

    startPing() {
        this.stopPing();

        this.ping = setInterval(() => {
            this.sendPing();
        }, 60000);
    }

    stopPing() {
        if (!this.ping) {
            return false;
        }

        clearInterval(this.ping);
        this.ping = null;
    }

    async checkLive() {
        if (this.pending) return false;

        if (!this.bjId && !this.auto) {
            return false;
        }
        
        if (this.isOpen()) {
            return false;
        }

        const channel = (
            await this.sendLiveInfo()
        );

        if (!channel) return false;

        if (!this.isAuth(channel)) {
            return false;
        }

        this.pending = true;

        try {
            await this.sleep(this.delay);

            return await this.connect(
                this.bjId,
                this.broadPw
            );
        } finally {
            this.pending = false;
        }
    }

    startLive() {
        this.stopLive();

        this.liveTimer = setInterval(() => {
            this.safe(() => this.checkLive());
        }, 60000);
    }

    stopLive() {
        if (!this.liveTimer) {
            return false;
        }

        clearInterval(this.liveTimer);
        this.liveTimer = null;

        return true;
    }

    async checkSession() {
        if (!this.bjId || !this.channel) {
            return false;
        }

        const oldBno = this.channel.BNO;
        const oldChatNo = this.channel.CHATNO;

        const channel = (
            await this.sendLiveInfo()
        );

        if (!channel) return false;

        if (channel.BNO === oldBno
            && channel.CHATNO === oldChatNo
        ) {
            return false;
        }

        let login = true;

        if (channel.RESULT === -8) {
            login = false;
        }

        this.emit('session', {
            login,
            before: this.channel,
            after: channel
        });

        this.disconnect();

        return this.connect(
            this.bjId,
            this.broadPw
        );
    }

    startSession() {
        this.stopSession();

        this.sessionTimer = setInterval(() => {
            this.safe(() => this.checkSession());
        }, 30000);
    }

    stopSession() {
        if (!this.sessionTimer) {
            return false;
        }

        clearInterval(this.sessionTimer);
        this.sessionTimer = null;

        return true;
    }

    async checkPost() {
        return this.checkContent('post');
    }

    async checkClip() {
        return this.checkContent('clip');
    }

    async checkCatch() {
        return this.checkContent('catch');
    }

    contentTime(value = '') {
        const date = String(value).trim().replace(' ', 'T');
        return Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(date)
            ? `${date}+09:00` : date);
    }

    async checkContent(type) {
        const watch = this.contentWatch;
        if (!watch || watch.bjId !== this.bjId) return false;
        const state = watch.states.get(type);
        if (!state || watch.loading.has(type)) return false;
        watch.loading.add(type);

        try {
            const load = {
                post: () => this.sendPostList(watch.bjId),
                clip: () => this.sendClipList(watch.bjId),
                catch: () => this.sendCatchList(watch.bjId)
            };
            const started = Math.floor(Date.now() / 1000) * 1000;
            const cookie = http.cookieString(this.cookie);
            const auth = crypto.createHash('sha256').update(cookie).digest('hex');
            if (state.auth !== auth) {
                for (const record of state.records.values()) record.missing = 0;
                state.auth = auth;
            }
            const list = await load[type]();
            if (this.contentWatch !== watch || cookie !== http.cookieString(this.cookie)) return false;
            if (!Array.isArray(list)) {
                for (const record of state.records.values()) record.missing = 0;
                return false;
            }

            const items = list.filter(item => item?.titleNo
                && (type !== 'post' || item.userId === watch.bjId));
            items.sort((a, b) => Number(a.titleNo) - Number(b.titleNo));

            const events = [];
            const current = new Set();
            for (const item of items) {
                const id = String(item.titleNo);
                current.add(id);
                state.pending.delete(id);
                const data = {
                    type, bjId: watch.bjId, bjNick: item.userNick,
                    titleNo: item.titleNo, title: item.titleName,
                    content: item.content, regDate: item.regDate,
                    url: type === 'post'
                        ? new URL(`/station/${watch.bjId}/post/${id}`, DOMAIN.soop).href
                        : new URL(`/player/${id}`, DOMAIN.vod).href
                };
                const record = state.records.get(id);
                const auth = Number(item.authNo);
                if (state.ready && record && [101, 102].includes(auth)
                    && record.auth !== null && record.auth !== auth) {
                    events.push({ event: 'visibility', data: {
                        ...data, public: auth === 101
                    }});
                }
                state.records.set(id, {
                    data, auth: [101, 102].includes(auth) ? auth : record?.auth ?? null,
                    missing: 0, removed: false
                });
                const signature = JSON.stringify([
                    item.titleName, item.content ?? '', item.photos ?? []
                ]);
                const previous = state.items.get(id);
                state.items.set(id, signature);

                if (!state.ready) continue;
                const updated = type === 'post' && previous !== undefined
                    && previous !== signature;
                const time = this.contentTime(item.regDate);
                const created = previous === undefined && Number.isFinite(time)
                    && time >= state.since && time <= Date.now();
                if (!updated && !created) continue;

                events.push({
                    event: updated ? 'edit' : type,
                    data
                });
            }

            for (const id of state.current) {
                if (!current.has(id)) state.pending.add(id);
            }
            state.current = current;
            await this.checkMissing(state, watch, cookie, events);
            if (this.contentWatch !== watch || cookie !== http.cookieString(this.cookie)) return false;

            if (!state.ready) {
                state.since = started;
                state.ready = true;
            }
            for (const { event, data } of events) {
                if (this.contentWatch !== watch) break;
                this.emit(event, data);
            }
            if (type === 'post') {
                for (const post of list) {
                    if (this.contentWatch !== watch) break;
                    await this.safe(() => this.checkComments(post, watch));
                }
            }
            return true;
        } catch (error) {
            for (const record of state.records.values()) record.missing = 0;
            throw error;
        } finally {
            watch.loading.delete(type);
        }
    }

    async checkMissing(state, watch, cookie, events) {
        for (const id of [...state.pending].slice(0, 10)) {
            if (this.contentWatch !== watch || cookie !== http.cookieString(this.cookie)) return;
            const record = state.records.get(id);
            state.pending.delete(id);
            if (!record || record.removed) continue;
            let result;
            try {
                result = await http.getContent(watch.bjId, id, { cookie: this.cookie });
            } catch (error) {
                record.missing = 0;
                state.pending.add(id);
                this.emit('error', error);
                continue;
            }
            if (this.contentWatch !== watch || cookie !== http.cookieString(this.cookie)) {
                record.missing = 0;
                state.pending.add(id);
                return;
            }
            const { status, data } = result;
            if (status === 515 && Number(data?.code) === 1380) {
                record.missing++;
                if (record.missing < 2) {
                    state.pending.add(id);
                    continue;
                }
                record.removed = true;
                state.comments.delete(id);
                events.push({ event: 'remove', data: record.data });
                continue;
            }
            record.missing = 0;
            const auth = Number(data?.auth_no);
            if (status === 200 && String(data?.title_no) === id
                && [101, 102].includes(auth)) {
                if (record.auth !== auth && (record.auth !== null || auth === 102)) {
                    events.push({ event: 'visibility', data: {
                        ...record.data, public: auth === 101
                    }});
                }
                record.auth = auth;
            } else {
                state.pending.add(id);
            }
        }
    }

    startContent() {
        if (!this.bjId) return Promise.resolve(false);
        if (this.contentWatch?.bjId === this.bjId) {
            return this.contentWatch.ready;
        }
        this.stopContent();

        const types = ['post', 'clip', 'catch'];
        if (!this.contentStates.has(this.bjId)) {
            this.contentStates.set(this.bjId, new Map(types.map(type => [type, {
                ready: false, since: 0, items: new Map(), comments: new Map(),
                records: new Map(), current: new Set(), pending: new Set()
            }])));
        }
        const watch = {
            bjId: this.bjId,
            states: this.contentStates.get(this.bjId),
            loading: new Set(),
            timer: null,
            ready: null
        };
        this.contentWatch = watch;
        const check = () => Promise.all(types.map(type =>
            this.safe(() => this.checkContent(type))
        ));
        watch.ready = check();
        watch.timer = setInterval(check, 120000);
        return watch.ready;
    }

    stopContent() {
        if (!this.contentWatch) return false;
        clearInterval(this.contentWatch.timer);
        this.contentWatch = null;
        return true;
    }

    startPost() {
        return this.startContent();
    }

    stopPost() {
        return this.stopContent();
    }

    async sendCommentList(titleNo, bjId = this.bjId) {
        const options = { cookie: this.cookie };
        const parents = new Map();
        let total = null;
        let lastPage = 1;

        for (let page = 1; page <= lastPage; page++) {
            const result = await http.getComments(bjId, titleNo, page, options);
            if (!Array.isArray(result?.data) || !result.meta) return null;
            const meta = result.meta;
            if (!Number.isInteger(meta.total) || meta.total < 0
                || !Number.isInteger(meta.last_page) || meta.last_page < 1
                || meta.last_page > 20 || Number(meta.current_page) !== page
                || (result.hidden_list?.length ?? 0) > 0) return null;
            if (total !== null && (total !== meta.total || lastPage !== meta.last_page)) {
                return null;
            }
            total = meta.total;
            lastPage = meta.last_page;
            for (const item of result.data) {
                if (!item.p_comment_no) return null;
                parents.set(String(item.p_comment_no), item);
            }
        }
        if (parents.size !== total) return null;

        const comments = [];
        for (const item of parents.values()) {
            comments.push({ ...item, commentNo: item.p_comment_no, parentCommentNo: null });
            const count = Number(item.c_comment_cnt);
            if (!Number.isInteger(count) || count < 0) return null;
            if (!count) continue;
            const replies = await http.getReplies(bjId, titleNo, item.p_comment_no, options);
            if (!Array.isArray(replies?.data) || replies.data.length !== count
                || (replies.reply_hidden_list?.length ?? 0) > 0) return null;
            const ids = new Set();
            for (const reply of replies.data) {
                if (!reply.c_comment_no || ids.has(String(reply.c_comment_no))) return null;
                ids.add(String(reply.c_comment_no));
                comments.push({ ...reply, commentNo: reply.c_comment_no,
                    parentCommentNo: item.p_comment_no });
            }
        }
        return comments;
    }

    async checkComments(post, watch = this.contentWatch) {
        if (!post?.titleNo || !watch || this.contentWatch !== watch) return false;
        const states = watch.states.get('post').comments;
        const id = String(post.titleNo);
        const previous = states.get(id);
        const cookie = http.cookieString(this.cookie);
        const auth = crypto.createHash('sha256').update(cookie).digest('hex');
        let list;
        try {
            list = await this.sendCommentList(post.titleNo, watch.bjId);
        } catch (error) {
            previous?.missing.clear();
            throw error;
        }
        if (!Array.isArray(list)) previous?.missing.clear();
        if (!Array.isArray(list) || this.contentWatch !== watch
            || cookie !== http.cookieString(this.cookie)) return false;

        const baseline = !previous || previous.auth !== auth;
        const state = baseline ? { auth, items: new Map(), missing: new Map() } : previous;
        const current = new Map();
        const events = [];
        for (const item of list) {
            const key = `${item.parentCommentNo ?? 0}:${item.commentNo}`;
            const data = {
                bjId: watch.bjId, titleNo: post.titleNo, title: post.titleName,
                commentNo: item.commentNo, parentCommentNo: item.parentCommentNo,
                userId: item.user_id, userNick: item.user_nick,
                message: item.comment, regDate: item.reg_date,
                url: new URL(`/station/${watch.bjId}/post/${post.titleNo}`, DOMAIN.soop).href
            };
            const signature = JSON.stringify([item.comment, item.photo ?? null,
                item.tag_user_id ?? '', item.tag_user_nick ?? '']);
            const old = state.items.get(key);
            current.set(key, { signature, data });
            state.missing.delete(key);
            if (baseline) continue;
            if (!old) events.push({ event: 'comment', data });
            else if (old.signature !== signature) {
                events.push({ event: 'update', data: { ...data, before: old.data } });
            }
        }
        for (const [key, old] of state.items) {
            if (current.has(key)) continue;
            const count = (state.missing.get(key) ?? 0) + 1;
            if (count < 2) {
                state.missing.set(key, count);
                current.set(key, old);
            } else {
                state.missing.delete(key);
                events.push({ event: 'delete', data: old.data });
            }
        }
        state.items = current;
        states.set(id, state);
        for (const { event, data } of events) {
            if (this.contentWatch !== watch) break;
            this.emit(event, data);
        }
        return true;
    }

    async connectBridge() {
        if (this.bridge) {
            return true;
        }

        const bridge = new Bridge(this);
        this.bridge = bridge;

        return new Promise(resolve => {
            let settled = false;

            const finish = result => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);

                this.off('error', onError);
                this.off('open', onOpen);

                if (!result && this.bridge === bridge) {
                    this.closeBridge();
                }

                resolve(result);
            };

            const onError = () => finish(false);
            const onOpen = () => finish(true);
            const timeout = setTimeout(() => {
                try {
                    this.emit('error', new Error(
                        '브릿지 입장 시간이 초과되었습니다.'
                    ));
                } finally {
                    finish(false);
                }
            }, 10000);

            this.on('error', onError);
            this.on('open', onOpen);

            bridge.connect().catch(error => {
                try {
                    this.emit('error', error);
                } finally {
                    finish(false);
                }
            });
        });
    }

    closeBridge() {
        if (!this.bridge) {
            return false;
        }

        this.bridge.close();
        this.bridge = null;

        return true;
    }

    setBroadcast() {
        if (!this.channel) return null;

        const category = (
            this.category.get(
            Number(this.channel.CATE)
        )?.name || '');

        const hashtag = (
            Array.isArray(
            this.channel.HASH_TAGS
        ) ? this.channel.HASH_TAGS : []
        ).map(v => String(v))
        .map(v =>
            v.startsWith('#') ? v : `#${v}`)
        .join(',');

        this.broadcast = {
            title: this.channel.TITLE,
            category,
            hashtag
        };

        return this.broadcast;
    }

    updateBroadcast(data = {}) {
        const sMinAge = (
            data.siMinAge ?? data.siMinAge
        );

        const prev = this.broadcast;

        const next = {
            ...prev
        };

        const changed = {
            title: false,
            category: false,
            hashtag: false,
        };

        const sTitle = (
            data.Title ?? data.acTitle
        );

        if (sTitle) {
            const title = this.decode(
                sTitle
            );

            if (title !== prev.title) {
                next.title = title;
                changed.title = true;
            }
        }

        if (data.iCategory) {
            const category = (
                this.category.get(
                Number(data.iCategory)
            )?.name || '');

            if (category !== prev.category) {
                next.category = category;
                changed.category = true;
            }
        }

        if (data.HASHTAG) {
            const hashtag = this.parseTag(
                data.HASHTAG,
                next.category
            ).join(',');

            if (hashtag !== prev.hashtag) {
                next.hashtag = hashtag;
                changed.hashtag = true;
            }
        }

        this.broadcast = next;

        this.emitBroad(prev, next, changed);

        return { ...next, changed };
    }

    endingMsg(text) {
        this.ending = this.decode(text);
    }

    emitAuto(code, options = {}) {
        this.emit('live', {
            code: code,
            bjId: this.bjId,
            bjNick: this.station?.user_nick,
            ...options
        });

        this.auth = code;
    }

    emitBroad(prev, next, changed) {
        if (changed.title) {
            this.emit('title', {
                title: next.title,
                prev: prev.title
            });
        }

        if (changed.category) {
            this.emit('category', {
                category: next.category,
                prev: prev.category
            });
        }

        if (changed.hashtag) {
            const hashtags = this.parseTag(
                next.hashtag,
                next.category
            );

            this.emit('hashtag', {
                hashtag: next.hashtag,
                hashtags,
                prev: prev.hashtag
            });
        }
    }

    decode(text = '') {
        if (!text) return '';

        try {
            return decodeURIComponent(text);
        } catch {
            return text;
        }
    }

    parseTag(text = '', name = '') {
        const value = this.decode(text);

        if (!value) return [];

        return value.split(',')
            .map(v => v.trim())
            .filter(Boolean)
            .filter(v => {
                return (v.replace(
                    /^#/, ''
                ) !== name);
            }).map(v =>
                v.startsWith('#')
                ? v : `#${v}`
            );
    }

    async loadBasics() {
        const result = await Promise.allSettled([
            this.sendLiveInfo(),
            this.sendStation()
        ]);

        const get = index => (
            result[index].status === 'fulfilled'
                ? result[index].value
                : null
        );

        const channel = get(0);
        const station = get(1);

        this.channel = channel;
        this.station = station;

        this.bjNick = (
            station?.user_nick || ''
        );

        return true;
    }

    async loadAssets() {
        const options = {
            cookie: this.cookie
        };

        const lang = this.channel.svc_lang;

        const result = await Promise.allSettled([
            http.getPrivateInfo(options),
            http.getCategory(lang, options),
            http.postChatRule(this.bjId, options),
            http.getEmoticon(options),
            http.getRecent(options),
            http.getSignature(this.bjId, options),
            http.postOgqList(this.bjId, options),
        ]);

        const get = index => (
            result[index].status === 'fulfilled'
                ? result[index].value
                : null
        );

        const info = get(0);
        const category = get(1);
        const rule = get(2);
        const emoticon = get(3);
        const recent = get(4);
        const signature = get(5);
        const ogq = get(6);

        this.info = info;
        this.rule = rule;
        this.recent = recent;
        this.signature = signature;
        this.ogq = ogq;

        this.category = this.mapCategory(
            this.flatCategory(category)
        );

        this.emoticon = this.mapEmoticon(
            emoticon,
            signature
        );

        this.setBroadcast();

        return true;
    }

    sendChat(message = '') {
        return this.send(
            packet.makeChat(message)
        );
    }

    sendManagerChat(message = '') {
        return this.send(packet.makeManagerChat(
            message
        ));
    }

    sendDirectChat(message = '', targetId = '') {
        return this.send(packet.makeDirectChat(
            message, targetId
        ));
    }

    sendSubBj(targetId = '', index = 0) {
        return this.send(packet.makeSubBj(
            targetId, index
        ));
    }

    sendUserFlag(flag = '') {
        return this.send(packet.makeUserFlag(
            flag
        ));
    }

    sendClubColor(color = 0) {
        return this.send(packet.makeClubColor(
            color
        ));
    }

    sendTranslation(message = '', mode = 1) {
        return this.send(packet.makeTranslation(
            message, mode
        ));
    }

    sendDumb(targetId = '', message = '') {
        return this.send(packet.makeDumb(
            targetId, message
        ));
    }

    sendKick(targetId = '', index = 0, message = '') {
        if (!this.channel?.BNO) {
            return false;
        }

        const user = this.userList.get(targetId);
        const name = user?.name || '';

        return this.send(packet.makeKick(
            targetId, name, this.userId,
            this.channel.BNO, index, message
        ));
    }

    sendBlack(targetId = '', adminId = '') {
        if (!this.channel?.BNO) {
            return false;
        }

        return this.send(packet.makeBlack(
            this.channel.BNO, adminId, targetId
        ));
    }

    sendKickList() {
        return this.send(packet.makeKickList(
            this.channel?.BNO
        ));
    }

    sendSlowMode(count = 0) {
        if (!this.channel?.BNO) {
            return false;
        }

        return this.send(packet.makeSlowMode(
            this.channel.CHATNO,
            count
        ));
    }

    sendSubtitle(index = this.subtitle) {
        return this.send(packet.makeSubtitle(
            index
        ));
    }

    sendUserList() {
        return this.send(packet.makeUserList());
    }

    async sendStation() {
        const result = (
            await http.getStation(
            this.bjId,
            { cookie: this.cookie }
        ));

        return result?.station;
    }

    async sendLiveInfo() {
        const result = (
            await http.postLiveInfo(
            this.bjId,
            { cookie: this.cookie }
        ));

        return result;
    }

    async sendStream(quality = 'hd') {
        return http.getStream(this.bjId, quality, {
            cookie: this.cookie,
            password: this.broadPw,
        });
    }

    async startPackage(quality = 'original') {
        if (this.package) {
            return this.package.change(quality);
        }

        const media = new Package(this, quality);
        this.package = media;
        media.on('open', data => this.emit('packageOpen', data));
        media.on('quality', data => this.emit('packageQuality', data));
        media.on('media', data => this.emit('media', data));
        media.on('error', error => this.emit('packageError', error));
        media.on('close', data => {
            if (this.package === media) this.package = null;
            this.emit('packageClose', data);
        });

        try {
            return await media.connect();
        } catch (error) {
            media.fail(error);
            throw error;
        }
    }

    stopPackage() {
        const media = this.package;
        if (!media) return false;
        this.package = null;
        return media.close();
    }

    async sendBroad() {
        const result = (
            await http.getSection(
            this.bjId,
            'broad',
            { cookie: this.cookie }
        ));

        return result;
    }

    async sendPostList(bjId = this.bjId) {
        const result = (
            await http.getBoard(
            bjId,
            { perPage: 20 },
            { cookie: this.cookie }
        ));

        if (!Array.isArray(result?.data)) return null;
        const posts = new Map();
        const notices = Array.isArray(result.notice_data) ? result.notice_data : [];

        for (const item of [...result.data, ...notices]) {
            if (!item?.title_no || item.ucc) continue;
            posts.set(String(item.title_no), item);
        }

        return [...posts.values()].map(item => ({
            titleNo: item.title_no,
            titleName: item.title_name,
            userId: item.user_id,
            userNick: item.user_nick,
            authNo: item.auth_no,
            content: item.content?.content ?? item.content?.text_content ?? '',
            photos: (item.photos ?? []).map(photo => photo.url),
            regDate: item.reg_date
        }));
    }

    async sendClipList(bjId = this.bjId) {
        const result = await http.getVod(bjId, 'clip', {
            cookie: this.cookie
        });
        return result?.contents;
    }

    async sendCatchList(bjId = this.bjId) {
        const result = await http.getVod(bjId, 'catch', {
            cookie: this.cookie
        });
        return result?.contents;
    }

    findLastPost(data = []) {
        if (!Array.isArray(data)) {
            return null;
        }

        return data.find(post => {
            return post.userId === this.bjId
        });
    }

    async sendIceMode(type = 'ice_on', auth = 100001) { 
        if (!this.channel?.BNO) {
            return false;
        }

        const result = (
            await http.postIceMode(
            this.channel.BNO,
            this.userId,
            type,
            auth,
            { cookie: this.cookie }
        ));

        return result;
    }

    makeIceAuth({
        streamer = true,
        fanClub = false,
        supporter = false,
        topFan = false,
        subscriber = false,
        manager = true,
    } = {}) {
        let mask = 0;

        if (streamer) mask |= ICE_AUTH.STREAMER;
        if (fanClub) mask |= ICE_AUTH.FAN_CLUB;
        if (supporter) mask |= ICE_AUTH.SUPPORTER;
        if (topFan) mask |= ICE_AUTH.TOP_FAN;
        if (subscriber) mask |= ICE_AUTH.SUBSCRIBER;
        if (manager) mask |= ICE_AUTH.MANAGER;

        return mask;
    }

    async sendIceOption(count = 0, date = 1) {
        const result = await http.postIceOption(
            count,
            date,
            {
                cookie: this.cookie
            }
        );

        return result;
    }

    async sendPoll(index) { 
        if (!this.channel?.BNO) {
            return false;
        }

        const result = (
            await http.postPoll(
            this.poll.bjId,
            this.poll.surveyNo,
            index,
            { cookie: this.cookie }
        ));

        return result;
    }

    async sendPollList(surveyNo) { 
        const result = (
            await http.getPoll(
            this.bjId,
            surveyNo,
            { cookie: this.cookie }
        ));

        return result;
    }

    async sendOgq(message, ogqId, index = 1) {
        const result = (
            await http.postOgqChat(
            this.channel,
            this.userId,
            message,
            ogqId,
            index,
            { cookie: this.cookie }
        ));

        return result;
    }

    async sendChallengeList() {
        const result = (
            await http.postChallenge(
            this.bjId,
            { cookie: this.cookie }
        ));

        return this.formatChallenge(
            result
        );
    }

    formatChallenge(result) {
        const data = result?.data;

        if (result?.result !== 1 || !Array.isArray(result?.data)) {
            return {
                ok: false,
                code: result?.result,
                message: result?.msg
            };
        }

        const list = result.data.map(item => {
            return {
                idx: item.idx,
                userId: item.user_id,
                userNick: item.user_nick,
                bjId: item.bj_id,
                bjNick: item.bj_nick,
                status: item.status,
                title: item.title,
                regDate: item.reg_date,
                startDate: item.start_date,
                expireDate: item.expire_date,
                endDate: item.end_date,
                balloon: Number(
                    item.balloon_cnt
                ),
                unique: Number(
                    item.unique_user
                ),
                time: Number(
                    item.remain_time
                ),
            };
        });

        return {
            ok: true,
            message: result.msg,
            list
        };
    }

    formatTime(seconds = 0) {
        seconds = Number(seconds) || 0;

        const day = Math.floor(seconds / 86400);
        const hour = Math.floor((seconds % 86400) / 3600);
        const min = Math.floor((seconds % 3600) / 60);

        return [
            day ? `${day}일` : '',
            hour ? `${hour}시간` : '',
            min ? `${min}분` : ''
        ].filter(Boolean).join(' ') || '0분';
    }

    async sendMissionList() {
        const result = (
            await http.postMission(
            this.bjId,
            { cookie: this.cookie }
        ));

        return this.formatMission(
            result
        );
    }

    formatMission(result) {
        const data = result?.DATA;

        if (result?.RESULT !== 1 || !data) {
            return {
                ok: false,
                code: result?.RESULT,
                message: result?.MSG
            };
        }

        const teams = data.team
            .sort((a, b) => Number(a.order) - Number(b.order))
            .map(team => {

        const members = team.member.map(user => {
            const leader = user.team_leader ? '👑 ' : '';
            return `${leader}${user.bj_nick}(${user.bj_id})`;
        }).join(', ');

        return `[${team.team_name}] ${members}`;

        }).join('\n');

        return {
            ok: true,
            title: data.title,
            status: data.mission_status,
            total: data.total_escrow_count,
            teams
        };
    }

    findAssets(data = {}) {
        if (!data) return null;
        
        const emoticons = this.findEmoticon(
            data.message
        );

        const tier = data.tier;
        const subMonth = Number(data.subMonth);

        const tierUrl = tier
            ? this.makeTierUrl(tier, subMonth)
            : '';

        return {
            emoticons,
            tier,
            tierName: data.tierName,
            subMonth,
            tierUrl
        };
    }

    makeBalloonUrl(data = {}) {
        const count = Number(data.count) || 0;

        const step = (
            count < 10 ? 1 :
            count < 50 ? 2 :
            count < 100 ? 3 :
            count < 500 ? 4 :
            count < 1000 ? 5 : 6
        );

        const defaultUrl = new URL(
            `/new_player/items/ba_step${step}.png`,
            DOMAIN.res
        );

        if (data.isDefault) {
            return defaultUrl.href;
        }

        let fileName = String(data.fileName || '');

        if (!fileName) {
            return defaultUrl.href;
        }

        const isSpecial = (
            fileName.includes('evt') ||
            fileName.includes('sig') ||
            fileName.includes('signature')
        );

        if (
            data.language &&
            data.language !== 'ko_KR' &&
            !isSpecial
        ) {
            fileName += '_en';
        }

        let url = isSpecial
            ? new URL(
                `/starballoon/story_m/${fileName}.png`,
                DOMAIN.static
            )
            : new URL(
                `/new_player/items/m_balloon_${fileName}.png`,
                DOMAIN.res
            );

        if (data.urlModify) {
            url.href += `?v=${data.urlModify}`;
        }

        return url.href;
    }

    makeStickerUrl(type, language = 'ko_KR') {
        type = String(type || 'sticker');

        if (language && language !== 'ko_KR') {
            type += '_en';
        }

        return new URL(
            `/new_player/items/${type}.png`,
            DOMAIN.res
        ).href;
    }

    makeGudokUrl(month = 1, modify = '') {
        let url = new URL(
            `/subscription_ceremony/m/gudok_${month}.png`,
            DOMAIN.static
        );

        return (modify
            ? `${url}?v=${modify}`
            : url.href
        );
    }

    makeTierUrl(tier = 1, month = 0) {
        const pcon = this.channel?.PCON_OBJECT;

        if (!pcon || typeof pcon !== 'object') {
            return '';
        }

        const get = (tier) => pcon[`tier${tier}`];

        const list = get(tier);

        if (!Array.isArray(list)) {
            return '';
        }

        const sorted = [...list].sort((a, b) => {
            return Number(b.MONTH) - Number(a.MONTH);
        });

        for (const item of sorted) {
            const itemMonth = Number(item.MONTH);
            const fileName = item.FILENAME;

            if (month >= itemMonth && fileName) {
                return fileName;
            }
        }

        return '';
    }

    findOgq(index = 0) {
        const ogq = this.ogq;
        const item = ogq?.data?.[index];

        if (!ogq?.img_domain || !item) {
            return null;
        }

        const id = item.ogq_id;
        const max = Number(item.ogq_numbering);
        const ext = item.extension;

        if (!id || !max || !ext) {
            return null;
        }

        return {
            id,
            max,
            ext,
            domain: ogq.img_domain,
            item
        };
    }

    makeOgqUrl(index = 0, subId = 1) {
        const ogq = this.findOgq(index);

        if (!ogq) {
            return '';
        }

        if (subId < 1 || subId > ogq.max) {
            return '';
        }

        return new URL(
            `/sticker/${ogq.id}/${subId}.${ogq.ext}`,
            http.normalize(ogq.domain)
        ).href;
    }

    flatCategory(categories = []) {
        const result = [];
        const list = (
            Array.isArray(categories)
            ? categories : []
        );

        const walk = (items = []) => {
            for (const item of items) {
                result.push({
                    name: item.cate_name,
                    code: item.cate_no,
                    tags: item.category_tags
                });

                if (Array.isArray(item.child)) {
                    walk(item.child);
                }
            }
        };

        walk(list);

        return result;
    }

    mapCategory(categories = []) {
        const map = new Map();

        for (const item of categories) {
            map.set(Number(item.code), item);
        }

        return map;
    }

    mapEmoticon(data = {}, signature = []) {
        const map = new Map();

        for (const type of ['default', 'subscribe']) {
            
        const section = data?.[type];

        if (!section) continue;

        for (const group of section.groups || []) {
        for (const emoticon of group.emoticons || []) {

        if (emoticon.isDeprecated) {
            continue;
        }

        map.set(emoticon.keyword, {
            type,
            group: group.title,
            keyword: emoticon.keyword,
            fileName: emoticon.fileName,
            smallUrl: new URL(
                emoticon.fileName, section.small_url
            ).href,
            bigUrl: new URL(
                emoticon.fileName, section.big_url
            ).href
        });

        }}}

        const url = new URL(
            `/signature_emoticon/${this.bjId}/`,
            DOMAIN.static
        );

        for (const [tierKey, list] of 
            Object.entries(signature || {})
        ) {

        const tier = Number(
            tierKey.replace('tier', '')
        );

        for (const item of list || []) {
        
        const title = item.title;
        const keyword = `/${title}/`;

        map.set(keyword, {
            type: 'signature',
            group: tierKey,
            title,
            keyword,
            tier,
            order: Number(item.order_no),
            fileName: item.pc_img,
            smallUrl: new URL(
                item.mobile_img, url.href
            ).href,
            bigUrl: new URL(
                item.pc_img, url.href
            ).href
        });

        }}

        return map;
    }

    findEmoticon(message = '') {
        const result = [];

        if (!message || !(this.emoticon instanceof Map)) {
            return result;
        }

        for (const [keyword, emoticon] of this.emoticon) {
            if (message.includes(keyword)) {
                result.push(emoticon);
            }
        }

        return result;
    }
}
