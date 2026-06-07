import { WebSocket } from 'ws';
import crypto from 'crypto';
import { Bridge } from '#soop/bridge';
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

        this.station = null;

        this.liveTimer = null;
        this.sessionTimer = null;
        this.postTimer = null;

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
            options.bjId ?? ''
        );

        this.pver = (
            options.pver ?? 2
        );

        this.broadPw = (
            options.broadPw ?? ''
        );

        this.auto = (
            options.auto ?? false
        );

        this.subtitle = (
            options.subtitle ?? -1
        );

        this.cookie = (
            options.cookie ?? ''
        );

        this.delay = (
            options.delay ?? 80
        );

        this.auth = null;
        this.pending = null;
        this.post = null;
        this.ending = null;

        this.channel = null;
        this.userId = null;
        this.userFlag = null;

        this.info = null;
        this.category = null;
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
        this.bjId = bjId;

        if (!broadPw) {
            broadPw = this.broadPw;
        }
        this.broadPw = broadPw;

        if (!bjId) {
            this.emitLive(-1);
            return false;
        }

        await this.loadBasics();

        if (!this.channel) {
            return false;
        }

        this.startPost();

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
                this.emitLive(2);
                this.startLive();
            }
            return false;
        }

        const result = channel.RESULT;

        if (result !== 1) {
            if (this.auth !== result
                && this.auto) {
                this.emitLive(result);
                this.startLive();
            }

            else if (!this.auto) {
                this.emitLive(3);
            }
            return false;
        }

        if (!this.pending) {
            this.emitLive(result);
            this.channel = channel;
            this.startLive();
        }

        return true;
    }

    async openSocket() {
        await new Promise((resolve, reject) => {

            const timeout = setTimeout(() => {
                reject('chat timeout');
            }, 10000);

            const done = async () => {
                clearTimeout(timeout);

                await this.sendClubColor(0);

                if (this.pver !== 0) {
                    await this.sendUserList();
                }

                await this.sendSubtitle();

                resolve(true);
            };

            this.once('join', done);

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
                clearTimeout(timeout);
                this.emit('error', error);
                reject(error);
            });

            this.ws.on('close', async () => {
                clearTimeout(timeout);
                this.stopPing();
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

        await this.openSocket();
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
        this.stopPing();
        if (!this.auto) {
            this.stopLive();
        }

        this.closeBridge();
        this.closeWs();
        this.stopPost();

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

        const check = (
            await this.connectBridge()
        );

        if (!check) return false;

        this.pending = true;

        await this.sleep(this.delay);

        return this.connect(
            this.bjId,
            this.broadPw
        );
    }

    startLive() {
        this.stopLive();

        this.liveTimer = setInterval(async () => {
            await this.checkLive();
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

        this.sessionTimer = setInterval(async () => {
            await this.checkSession();
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
        if (!this.bjId) return false;

        const posts = await this.sendPostList();
        const post = this.findLastPost(posts);

        if (!post?.titleNo) return false;

        if (!this.post) {
            this.post = post.titleNo;
            return false;
        }

        if (this.post === post.titleNo) {
            return false;
        }

        this.post = post.titleNo;

        const url = new URL(
            `/station/${this.bjId}/post/${post.titleNo}`,
            DOMAIN.soop
        );

        this.emit('post', {
            bjId: this.bjId,
            bjNick: post.userNick,
            titleNo: post.titleNo,
            title: post.titleName,
            content: post.content,
            regDate: post.regDate,
            url: url.href
        });

        return post;
    }

    startPost() {
        this.stopPost();

        this.postTimer = setInterval(async () => {
            await this.checkPost();
        }, 120000);
    }

    stopPost() {
        if (!this.postTimer) {
            return false;
        }

        clearInterval(this.postTimer);
        this.postTimer = null;

        return true;
    }

    async connectBridge() {
        if (this.bridge) {
            return true;
        }

        let result;

        await new Promise(async (resolve) => {

            this.bridge = new Bridge(this);

            this.once('error', () => {
                result = false;
                resolve(true);
            });

            this.once('open', () => {
                result = true;
                resolve(true);
            });

            await this.bridge.connect();
        });

        return result;
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

    emitLive(code, options = {}) {
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

    async sendBroad() {
        const result = (
            await http.getSection(
            this.bjId,
            'broad',
            { cookie: this.cookie }
        ));

        return result;
    }

    async sendPostList() {
        const result = (
            await http.getSection(
            this.bjId,
            'post',
            { cookie: this.cookie }
        ));

        return result?.posts;
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
            
        const section = data[type];

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