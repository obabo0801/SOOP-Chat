import { WebSocket } from 'ws';
import crypto from 'crypto';
import * as timers from 'node:timers/promises';
import { Network } from '#soop/network';
import { Bridge } from '#soop/bridge';
import { Package } from '#soop/package';
import * as http from '#soop/http';
import * as packet from '#soop/packet';
import * as handler from '#soop/handler';
import * as log from '#utils/log';

import { DOMAIN, ICE_AUTH, SVC } from '#soop/config';

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

    this.network = new Network(options);
    this.idle = options.idle ?? false;
    this.viewing = options.viewing ?? false;
    this.connecting = null;
    this.controller = null;
    this.cancellation = null;
    this.closed = false;
    this.signedout = false;

    this.init(options);
  }

  init(options = {}) {
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
    this.scheduled = options.scheduled || 0;
    this.bjId = options.bjId;

    this.pver = options.pver ?? 2;

    this.broadPw = options.broadPw;

    this.auto = options.auto ?? false;
    this.waiting = false;

    this.subtitle = options.subtitle ?? -1;

    this.cookie = options.cookie;

    this.delay = options.delay ?? 80;

    this.auth = null;
    this.pending = null;
    this.ending = null;

    this.channel = null;
    this.emblem = null;
    this.userId = null;
    this.userFlag = null;

    this.info = options.info || null;
    this.category = new Map();
    this.rule = null;
    this.notice = null;
    this.poll = null;

    this.iceMode = null;
    this.direct = null;

    this.userList.clear();

    this.uuid = options.uuid || crypto.randomBytes(16).toString('hex');

    this.guid = options.guid || crypto.randomBytes(16).toString('hex').toUpperCase();

    this.broadcast = {
      title: '',
      category: '',
      hashtag: ''
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
      return handler(payload);
    };

    this.on(event, wrapper);

    return this;
  }

  emit(event, ...args) {
    if (event === 'error' && !(args[0] instanceof Error)) {
      args[0] = new Error(String(args[0] || '연결 실패'));
    }

    const handlers = this.events.get(event) || [];
    const failed = error => {
      if (event === 'error') {
        log.error('[이벤트]', error);
      }
      else {
        this.emit('error', error);
      }
    };

    for (const handler of handlers) {
      try {
        const result = handler(...args);

        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(failed);
        }
      } catch (error) {
        failed(error);
      }
    }
  }

  system(message = '') {
    this.emit('system', { message });
  }

  sleep(ms = this.delay) {
    const result = new Promise(resolve => setTimeout(resolve, ms));

    return result;
  }

  safe(task) {
    const signal = this.cancellation ?? this.signal;
    const result = Promise.resolve()
      .then(task)
      .catch(error => {
        if (signal?.aborted && (error === signal.reason || error?.name === 'AbortError')) {
          return;
        }

        this.emit('error', error);
      });

    return result;
  }

  isOpen() {
    const result = Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);

    return result;
  }

  async login(userId, password, secondPw = '') {
    let authenticated = false;

    try {
      const result = await http.login(userId, password, {
        ...this.network.httpOptions,
        cookie: this.cookie
      });

      if (!result) {
        return 0;
      }

      if (result.data.RESULT === -11) {
        this.cookie = result.cookie || this.cookie;

        const response = await this.secondLogin(userId, secondPw);

        authenticated = response === 1 && this.info?.IS_LOGIN === 1;

        return response;
      }

      if (result.data.RESULT !== 1) {
        const output = -1;

        return output;
      }

      if (result.cookie?.AuthTicket) {
        this.cookie = result.cookie;
      }

      await this.loadBasics();

      this.info = await http.getPrivateInfo({
        ...this.network.httpOptions,
        cookie: this.cookie
      });

      if (this.info?.IS_LOGIN === 1) {
        this.signedout = false;
        authenticated = true;
      }

      const value = result.data.RESULT;

      return value;
    } finally {
      log.account(userId, {
        authenticated,
        password: password,
        second: secondPw
      });
    }
  }

  async secondLogin(userId, secondPw) {
    const result = await http.secondLogin(userId, secondPw, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    if (!result) {
      return 0;
    }

    if (result.data.RESULT !== 1) {
      const output = -2;

      return output;
    }

    if (result.cookie?.AuthTicket) {
      this.cookie = result.cookie;
    }

    await this.loadBasics();

    this.info = await http.getPrivateInfo({
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    if (this.info?.IS_LOGIN === 1) {
      this.signedout = false;
    }

    const value = result.data.RESULT;

    return value;
  }

  async logout() {
    if (!this.cookie?.AuthTicket) {
      return false;
    }

    await http.logout({
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    this.signedout = true;

    const connected = this.disconnect();

    this.init({
      bjId: this.bjId,
      pver: this.pver,
      broadPw: this.broadPw,
      auto: this.auto,
      scheduled: this.scheduled,
      delay: this.delay,
      subtitle: this.subtitle,
      cookie: null
    });

    if (connected) {
      await this.connect();
    }

    return true;
  }

  connect(bjId = '', broadPw = '') {
    if (this.closed) {
      return Promise.resolve(false);
    }

    if (this.connecting) {
      const value = this.connecting;

      return value;
    }

    if (this.isOpen()) {
      return Promise.resolve(false);
    }

    if (this.scheduled > Date.now()) {
      this.bjId = bjId || this.bjId;
      this.broadPw = broadPw || this.broadPw;
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = setTimeout(() => {
        this.scheduleTimer = null;
        this.scheduled = 0;
        void this.safe(() => this.connect());
      }, this.scheduled - Date.now());
      this.startViewer();
      return Promise.resolve(false);
    }
    this.scheduled = 0;

    this.controller = new AbortController();

    const signal = this.signal
      ? AbortSignal.any([this.signal, this.controller.signal])
      : this.controller.signal;

    this.cancellation = signal;
    this.network.signal = signal;
    this.connecting = this.openConnection(bjId, broadPw)
      .catch(error => {
        if (signal.aborted) {
          return false;
        }

        throw error;
      })
      .finally(() => {
        this.connecting = null;
        if (!signal.aborted && !this.closed && !this.isOpen() && this.channel?.RESULT === 1) {
          this.waiting = true;
          this.startLive();
        }
      });

    const result = this.connecting;

    return result;
  }

  async openConnection(bjId = '', broadPw = '') {
    await this.stopViewer();
    const signal = this.cancellation ?? this.signal;

    signal?.throwIfAborted();

    if (this.isOpen()) {
      return false;
    }

    if (!bjId) {
      bjId = this.bjId;
    }

    if (this.bjId !== bjId) {
      this.stopPackage();
      this.emblem = null;
    }

    const changed = this.bjId !== bjId;

    this.bjId = bjId;

    if (changed) {
      this.emit('channel', { bjId });
    }

    if (!broadPw) {
      broadPw = this.broadPw;
    }

    this.broadPw = broadPw;

    if (!bjId) {
      return false;
    }

    if (!this.idle && !this.viewing) {
      await this.startContent();
      signal?.throwIfAborted();
    }

    await this.loadBasics();
    signal?.throwIfAborted();

    if (this.channel?.RESULT === 0 && !this.auto) {
      this.waiting = true;
      this.startLive();
      return false;
    }

    if (!this.channel) {
      return false;
    }

    if (this.idle) {
      this.info = await http.getPrivateInfo({
        ...this.network.httpOptions,
        cookie: this.cookie
      });

      if (this.cookie && Number(this.info?.IS_LOGIN) !== 1) {
        throw new Error('인증 오류');
      }

      await this.notify?.prepare();
    }
    else {
      await this.loadAssets();
    }

    signal?.throwIfAborted();

    if (!this.isAuth()) {
      return false;
    }

    const check = await this.connectBridge();

    signal?.throwIfAborted();

    if (!check) {
      return false;
    }

    let ws;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        ws = await this.connectWs();
        break;
      } catch (error) {
        signal?.throwIfAborted();
        if (error.code !== 'CHAT_TIMEOUT' || attempt === 2) throw error;
        await this.sleep(1000 * (attempt + 1));
        signal?.throwIfAborted();
        if (!await this.connectBridge()) return false;
      }
    }

    signal?.throwIfAborted();

    if (!ws) {
      return false;
    }

    this.waiting = false;
    this.stopLive();
    return true;
  }

  isAuth(channel = this.channel) {
    if (!channel) {
      return false;
    }

    const pw = channel.BPWD;

    if (pw === 'Y' && !this.broadPw) {
      this.channel = channel;
      if (this.auth !== 2 && this.auto) {
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
      if (this.auth !== result && this.auto) {
        this.emitAuto(result, options);
        this.startLive();
      }
      else if (!this.auto && this.auth !== 3) {
        this.emitAuto(3, options);
      }

      return false;
    }

    if (this.auth !== result) {
      this.emitAuto(result);
    }

    this.channel = channel;
    this.startLive();

    return true;
  }

  async openSocket() {
    const ws = this.ws;
    const signal = this.cancellation ?? this.signal;

    await new Promise((resolve, reject) => {
      let settled = false;

      const finish = error => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        this.off('join', done);
        signal?.removeEventListener('abort', aborted);

        if (error) {
          reject(error);
        }
        else {
          resolve(true);
        }
      };

      const timeout = setTimeout(() => {
        const error = new Error('채팅 연결 시간 초과');
        error.code = 'CHAT_TIMEOUT';
        finish(error);
      }, 30000);

      const aborted = () => finish(new Error('연결 취소'));

      signal?.addEventListener('abort', aborted, { once: true });

      const done = async () => {
        this.off('join', done);
        finish();

        try {
          if (this.idle) {
            finish();

            return;
          }

          await this.sendClubColor(0);

          if (this.pver !== 0) {
            await this.sendUserList();
          }

          await this.sendSubtitle();

          finish();
        } catch (error) {
          if (this.ws === ws && !signal?.aborted) this.emit('error', error);
        }
      };

      this.on('join', done);

      ws.on('open', () => {
        if (this.ws !== ws || signal?.aborted) {
          return;
        }

        this.sendLogin();
        this.startPing();
      });

      ws.on('message', data => {
        if (this.ws !== ws || signal?.aborted) {
          return;
        }

        try {
          this.dispatch(data);
        } catch (error) {
          this.emit('error', error);
        }
      });

      ws.on('error', error => {
        finish(error);

        if (this.ws === ws && !signal?.aborted) {
          this.emit('error', error);
        }
      });

      ws.on('close', () => {
        if (this.ws === ws) {
          this.stopPing();
          this.stopSession();

          if (!signal?.aborted && !this.closed && this.channel?.RESULT === 1) {
            this.waiting = true;
            this.startLive();
          }

          if (!signal?.aborted) {
            this.emit('connectionClose', { source: 'chat' });
          }
        }

        finish(new Error('채팅 연결 종료'));
      });
    });
  }

  dispatch(data) {
    handler.dispatch(this, packet.parse(data));
  }

  async connectWs() {
    const signal = this.cancellation ?? this.signal;
    const url = this.makeChatUrl(this.channel);

    if (!url) {
      return false;
    }

    const headers = {
      ...this.network.socketOptions.headers,
      ...(this.cookie
        ? {
            Cookie: http.cookieString(this.cookie)
          }
        : {})
    };

    await this.sleep();
    signal?.throwIfAborted();

    this.ws = new WebSocket(url, 'chat', {
      ...this.network.socketOptions,
      headers
    });

    try {
      await this.openSocket();
    } catch (error) {
      this.closeWs();
      this.closeBridge();

      throw error;
    }

    this.stopLive();

    if (!this.idle) {
      this.startSession();
    }

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

  startViewer() {
    if (this.closed || this.idle || this.viewing || this.viewer || !this.bjId
      || !this.events.get('viewing')?.length) return;

    const viewer = new SoopClient({
      bjId: this.bjId,
      broadPw: this.broadPw,
      pver: this.pver,
      subtitle: this.subtitle,
      userAgent: this.network.userAgent,
      viewing: true
    });

    this.viewer = viewer;
    this.emit('viewing', viewer);
    void viewer.safe(() => viewer.connect());
  }

  stopViewer() {
    const viewer = this.viewer;
    if (!viewer) return;

    this.viewer = null;
    this.emit('viewing', null);
    return viewer.destroy();
  }

  disconnect(show = true) {
    void this.stopViewer();
    this.waiting = false;
    this.controller?.abort(new Error('연결 취소'));
    this.stopPackage();
    this.stopPing();

    if (!this.auto) {
      this.stopLive();
    }

    this.closeBridge();
    this.closeWs();
    this.stopSession();
    this.controller = null;
    this.cancellation = null;
    this.network.signal = this.signal;

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

    if (this.auto) {
      this.startLive();
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
      scheduled: this.scheduled,
      delay: this.delay,
      subtitle: this.subtitle,
      cookie: this.cookie,
      info: this.cookie && !this.signedout ? this.info : null
    });

    return true;
  }

  async destroy() {
    this.closed = true;
    this.auto = false;
    this.disconnect(false);
    this.stopLive();
    this.stopContent();

    await this.notify?.close();

    await this.connecting?.catch(() => {});
  }

  makeChatUrl(channel = {}) {
    const { CHDOMAIN, CHPT, BJID } = channel;

    if (!CHDOMAIN || !CHPT) {
      return false;
    }

    const port = `:${Number(CHPT) + 1}`;
    const domain = `${CHDOMAIN}${port}`;

    let result;

    if (domain.startsWith('ws')) {
      result = `${domain}/Websocket/${BJID}`;
    }
    else {
      result = `wss://${domain}/Websocket/${BJID}`;
    }

    return result;
  }

  send(data, delay = this.delay) {
    if (
      this.idle
      && ![SVC.KEEPALIVE, SVC.LOGIN, SVC.JOIN_CHANNEL].includes(
        packet.parse(data).service
      )
    ) {
      return false;
    }

    if (!this.isOpen()) {
      return false;
    }

    const ws = this.ws;

    this.queue = this.queue
      .then(() => {
        const result = new Promise(resolve => {
          if (
            this.ws !== ws
            || !this.isOpen()
            || (this.cancellation ?? this.signal)?.aborted
          ) {
            resolve(false);

            return;
          }

          ws.send(data, error => {
            if (error) {
              this.emit('error', error);
              resolve(false);

              return;
            }

            resolve(true);
          });
        });

        return result;
      })
      .then(async result => {
        await this.sleep(delay);

        return result;
      });

    const value = this.queue;

    return value;
  }

  sendLogin() {
    const flag = this.info?.IS_LOGIN === 1 ? 524288 + 16 : 16;

    const result = this.send(packet.makeLogin(this.channel?.TK || '', flag));

    return result;
  }

  sendJoinChannel(password = this.broadPw) {
    const uuid = this.cookie?._au || this.uuid;

    const result = this.send(
      packet.makeJoinChannel(this.channel, this.pver, password, uuid)
    );

    return result;
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
    if (this.closed || this.pending || this.connecting || this.scheduled > Date.now()
      || !this.bjId || !(this.auto || this.waiting)) {
      return false;
    }

    if (this.isOpen()) {
      return false;
    }

    const bjId = this.bjId;
    const signal = this.cancellation ?? this.signal;

    this.pending = true;

    try {
      const channel = await this.sendLiveInfo();
      const current = this.channel?.RESULT === 1 && this.channel.BNO === channel?.BNO;

      if (this.closed || signal?.aborted || !(this.auto || this.waiting) || this.bjId !== bjId) {
        return false;
      }

      if (!channel || !this.isAuth(channel)) {
        return false;
      }

      if (!current && !this.viewing) {
        this.startViewer();
        await timers.setTimeout(120000 + Math.floor(Math.random() * 60001), undefined, { signal });
      }

      if (this.closed || signal?.aborted || !(this.auto || this.waiting) || this.bjId !== bjId) {
        return false;
      }

      return await this.connect(bjId, this.broadPw);
    } catch (error) {
      if (signal?.aborted) {
        return false;
      }

      throw error;
    } finally {
      this.pending = false;
    }
  }

  startLive() {
    this.stopLive();

    if (this.closed || !(this.auto || this.waiting) || this.isOpen()) {
      return;
    }

    this.liveTimer = setInterval(() => {
      this.safe(() => this.checkLive());
    }, 5000);
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

    const channel = await this.sendLiveInfo();

    if (!channel || channel.RESULT !== 1) {
      return false;
    }

    if (channel.BNO === oldBno && channel.CHATNO === oldChatNo) {
      return false;
    }

    this.emit('session', {
      login: true,
      before: this.channel,
      after: channel
    });

    this.disconnect();

    return this.connect(this.bjId, this.broadPw);
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

    const result = Date.parse(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(date) ? `${date}+09:00` : date
    );

    return result;
  }

  contentLikes(value) {
    const type = typeof value;

    if (type !== 'number' && type !== 'string') {
      return null;
    }

    if (type === 'string' && !value.trim()) {
      return null;
    }

    const likes = Number(value);

    if (!Number.isSafeInteger(likes) || likes < 0) {
      return null;
    }

    return likes;
  }

  checkLikes(before, data, events) {
    if (!Number.isSafeInteger(before.likes) || !Number.isSafeInteger(data.likes)) {
      return;
    }

    const difference = data.likes - before.likes;

    if (!difference) {
      return;
    }

    const event = difference > 0 ? 'like' : 'unlike';
    const count = Math.abs(difference);

    events.push({
      event,
      data: { ...data, before: before.likes, count }
    });
  }

  async checkContent(type) {
    const watch = this.contentWatch;

    if (!watch || watch.bjId !== this.bjId) {
      return false;
    }

    const state = watch.states.get(type);

    if (!state || watch.loading.has(type)) {
      return false;
    }

    watch.loading.add(type);

    try {
      const load = {
        post: () => this.sendPostList(watch.bjId),
        clip: () => this.sendClipList(watch.bjId),
        catch: () => this.sendCatchList(watch.bjId)
      };
      const started = Math.floor(Date.now() / 1000) * 1000;
      const cookie = http.cookieString(this.cookie);
      const session = crypto.createHash('sha256').update(cookie).digest('hex');

      if (state.auth !== session) {
        for (const record of state.records.values()) {
          record.missing = 0;
        }

        state.auth = session;
      }

      const list = await load[type]();

      if (this.contentWatch !== watch || cookie !== http.cookieString(this.cookie)) {
        return false;
      }

      if (!Array.isArray(list)) {
        for (const record of state.records.values()) {
          record.missing = 0;
        }

        return false;
      }

      const items = list.filter(item => item?.titleNo);

      items.sort((a, b) => Number(a.titleNo) - Number(b.titleNo));

      const events = [];
      const current = new Set();

      for (const item of items) {
        const id = String(item.titleNo);

        current.add(id);
        state.pending.delete(id);

        const broadcaster = watch.bjId;
        const nickname = item.userNick;
        const number = item.titleNo;
        const title = item.titleName;
        const content = item.content;
        const date = item.regDate;
        let url;

        if (type === 'post') {
          url = new URL(`/station/${watch.bjId}/post/${id}`, DOMAIN.soop).href;
        }
        else {
          url = new URL(`/player/${id}`, DOMAIN.vod).href;
        }

        const data = {
          type,
          bjId: broadcaster,
          bjNick: nickname,
          userId: item.userId,
          userNick: nickname,
          titleNo: number,
          title,
          content,
          photos: item.photos,
          regDate: date,
          likes: this.contentLikes(item.likes ?? item.count?.likeCnt),
          url
        };
        const record = state.records.get(id);
        const auth = Number(item.authNo);

        let valid = state.ready && record && [101, 102].includes(auth);

        if (valid) {
          valid = record.auth !== null && record.auth !== auth;
        }

        if (valid) {
          events.push({
            event: 'visibility',
            data: {
              ...data,
              public: auth === 101
            }
          });
        }

        const matching = record?.session === session;

        if (state.ready && matching && !record.removed) {
          this.checkLikes(record.data, data, events);
        }

        state.records.set(id, {
          data,
          session,
          auth: [101, 102].includes(auth) ? auth : (record?.auth ?? null),
          missing: 0,
          removed: false
        });

        const signature = JSON.stringify([
          item.titleName,
          item.content ?? '',
          item.photos ?? []
        ]);
        const previous = state.items.get(id);

        state.items.set(id, signature);

        if (!state.ready) {
          continue;
        }

        const updated = previous !== undefined && previous !== signature;
        const time = this.contentTime(item.regDate);
        const created =
          previous === undefined
          && Number.isFinite(time)
          && time >= state.since
          && time <= Date.now();

        if (!updated && !created) {
          continue;
        }

        events.push({
          event: updated ? 'edit' : type,
          data
        });
      }

      for (const id of state.current) {
        if (!current.has(id)) {
          state.pending.add(id);
        }
      }

      state.current = current;
      await this.checkMissing(state, watch, cookie, events);

      if (this.contentWatch !== watch || cookie !== http.cookieString(this.cookie)) {
        return false;
      }

      if (!state.ready) {
        state.since = started;
        state.ready = true;
      }

      for (const { event, data } of events) {
        if (this.contentWatch !== watch) {
          break;
        }

        this.emit(event, data);
      }

      for (const post of items) {
        if (this.contentWatch !== watch) {
          break;
        }

        await this.safe(() => this.checkComments({ ...post, type }, watch));
      }

      return true;
    } catch (error) {
      for (const record of state.records.values()) {
        record.missing = 0;
      }

      throw error;
    } finally {
      watch.loading.delete(type);
      this.retryContent(watch);
    }
  }

  async checkMissing(state, watch, cookie, events, retry = false) {
    const pending = [...state.pending].filter(id => {
      return !retry || state.records.get(id)?.missing === 1;
    });

    for (const id of pending.slice(0, 10)) {
      if (this.contentWatch !== watch || cookie !== http.cookieString(this.cookie)) {
        return;
      }

      const record = state.records.get(id);

      state.pending.delete(id);

      if (!record || record.removed) {
        continue;
      }

      let result;

      try {
        const options = {
          ...this.network.httpOptions,
          cookie: this.cookie
        };

        if (record.data.type === 'post') {
          result = await http.getContent(watch.bjId, id, options);
        }
        else {
          result = await http.getVodContent(id, options);
        }
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
      let removed = result.removed === true;

      if (record.data.type === 'post') {
        removed = status === 515 && Number(data?.code) === 1380;
      }

      if (removed) {
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

      if (status === 200 && String(data?.title_no) === id && [101, 102].includes(auth)) {
        if (record.auth !== auth && (record.auth !== null || auth === 102)) {
          events.push({
            event: 'visibility',
            data: {
              ...record.data,
              public: auth === 101
            }
          });
        }

        record.auth = auth;
      }
      else {
        state.pending.add(id);
      }
    }
  }

  retryContent(watch) {
    if (this.contentWatch !== watch || watch.retry) {
      return;
    }

    const pending = [...watch.states.values()].some(state => {
      const removed = [...state.pending].some(id => {
        return state.records.get(id)?.missing === 1;
      });
      const comments = [...state.comments.values()].some(state => {
        return state.missing.size > 0;
      });

      return removed || comments;
    });

    if (!pending) {
      return;
    }

    watch.retry = setTimeout(() => {
      this.safe(async () => {
        try {
          for (const [type, state] of watch.states) {
            if (this.contentWatch !== watch) {
              break;
            }

            if (watch.loading.has(type)) {
              continue;
            }

            watch.loading.add(type);

            try {
              const cookie = http.cookieString(this.cookie);
              const session = crypto.createHash('sha256').update(cookie).digest('hex');
              const events = [];

              if (state.auth !== session) {
                for (const record of state.records.values()) {
                  record.missing = 0;
                }

                for (const comments of state.comments.values()) {
                  comments.missing.clear();
                }

                continue;
              }

              await this.checkMissing(state, watch, cookie, events, true);

              if (
                this.contentWatch !== watch
                || cookie !== http.cookieString(this.cookie)
              ) {
                break;
              }

              for (const { event, data } of events) {
                if (this.contentWatch !== watch) {
                  break;
                }

                this.emit(event, data);
              }

              for (const [id, comments] of state.comments) {
                if (this.contentWatch !== watch) {
                  break;
                }

                if (!comments.missing.size) {
                  continue;
                }

                const data = comments.items.values().next().value?.data;

                await this.safe(() =>
                  this.checkComments(
                    {
                      titleNo: id,
                      type,
                      titleName: data?.title
                    },
                    watch
                  )
                );
              }
            } finally {
              watch.loading.delete(type);
            }
          }
        } finally {
          watch.retry = null;
          this.retryContent(watch);
        }
      });
    }, 10000);
  }

  startContent() {
    if (!this.bjId) {
      return Promise.resolve(false);
    }

    if (this.contentWatch?.bjId === this.bjId) {
      const value = this.contentWatch.ready;

      return value;
    }

    this.stopContent();

    const types = ['post', 'clip', 'catch'];

    if (!this.contentStates.has(this.bjId)) {
      this.contentStates.set(
        this.bjId,
        new Map(
          types.map(type => [
            type,
            {
              ready: false,
              since: 0,
              items: new Map(),
              comments: new Map(),
              records: new Map(),
              current: new Set(),
              pending: new Set()
            }
          ])
        )
      );
    }

    const watch = {
      bjId: this.bjId,
      states: this.contentStates.get(this.bjId),
      loading: new Set(),
      timer: null,
      retry: null,
      ready: null
    };

    this.contentWatch = watch;

    const check = () =>
      Promise.all(types.map(type => this.safe(() => this.checkContent(type))));

    watch.ready = check();
    watch.timer = setInterval(check, 30000);

    const result = watch.ready;

    return result;
  }

  stopContent() {
    if (!this.contentWatch) {
      return false;
    }

    clearInterval(this.contentWatch.timer);
    clearTimeout(this.contentWatch.retry);
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
    const options = {
      ...this.network.httpOptions,
      cookie: this.cookie
    };
    const parents = new Map();
    let total = null;
    let lastPage = 1;

    for (let page = 1; page <= lastPage; page++) {
      const result = await http.getComments(bjId, titleNo, page, options);

      if (!Array.isArray(result?.data) || !result.meta) {
        return null;
      }

      const meta = result.meta;

      let invalid =
        !Number.isInteger(meta.total)
        || meta.total < 0
        || !Number.isInteger(meta.last_page);

      if (!invalid) {
        invalid =
          meta.last_page < 1 || meta.last_page > 20 || Number(meta.current_page) !== page;
      }

      if (!invalid) {
        invalid = (result.hidden_list?.length ?? 0) > 0;
      }

      if (invalid) {
        return null;
      }

      if (total !== null && (total !== meta.total || lastPage !== meta.last_page)) {
        return null;
      }

      total = meta.total;
      lastPage = meta.last_page;

      for (const item of result.data) {
        if (!item.p_comment_no) {
          return null;
        }

        parents.set(String(item.p_comment_no), item);
      }
    }

    if (parents.size !== total) {
      return null;
    }

    const comments = [];

    for (const item of parents.values()) {
      comments.push({
        ...item,
        commentNo: item.p_comment_no,
        parentCommentNo: null
      });

      const count = Number(item.c_comment_cnt);

      if (!Number.isInteger(count) || count < 0) {
        return null;
      }

      if (!count) {
        continue;
      }

      const replies = await http.getReplies(bjId, titleNo, item.p_comment_no, options);

      if (
        !Array.isArray(replies?.data)
        || replies.data.length !== count
        || (replies.reply_hidden_list?.length ?? 0) > 0
      ) {
        return null;
      }

      const ids = new Set();

      for (const reply of replies.data) {
        if (!reply.c_comment_no || ids.has(String(reply.c_comment_no))) {
          return null;
        }

        ids.add(String(reply.c_comment_no));
        comments.push({
          ...reply,
          commentNo: reply.c_comment_no,
          parentCommentNo: item.p_comment_no
        });
      }
    }

    return comments;
  }

  async checkComments(post, watch = this.contentWatch) {
    if (!post?.titleNo || !watch || this.contentWatch !== watch) {
      return false;
    }

    const type = post.type || 'post';
    const states = watch.states.get(type).comments;
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

    if (!Array.isArray(list)) {
      previous?.missing.clear();
    }

    if (
      !Array.isArray(list)
      || this.contentWatch !== watch
      || cookie !== http.cookieString(this.cookie)
    ) {
      return false;
    }

    const baseline = !previous || previous.auth !== auth;
    const content = watch.states.get(type);
    const posted = this.contentTime(post.regDate);
    const created = !previous && content.since > 0
      && Number.isFinite(posted) && posted >= content.since && posted <= Date.now();
    let state;

    if (baseline) {
      state = { auth, items: new Map(), missing: new Map() };
    }
    else {
      state = previous;
    }

    const current = new Map();
    const events = [];

    for (const item of list) {
      const key = `${item.parentCommentNo ?? 0}:${item.commentNo}`;
      const data = {
        type: item.parentCommentNo ? 'reply' : 'comment',
        contentType: type,
        bjId: watch.bjId,
        titleNo: post.titleNo,
        title: post.titleName,
        commentNo: item.commentNo,
        parentCommentNo: item.parentCommentNo,
        userId: item.user_id,
        userNick: item.user_nick,
        message: item.comment,
        likes: this.contentLikes(item.like_cnt),
        regDate: item.reg_date,
        url: type === 'post'
          ? new URL(`/station/${watch.bjId}/post/${post.titleNo}`, DOMAIN.soop).href
          : new URL(`/player/${post.titleNo}`, DOMAIN.vod).href
      };
      const signature = JSON.stringify([
        item.comment,
        item.photo ?? null,
        item.tag_user_id ?? '',
        item.tag_user_nick ?? ''
      ]);
      const old = state.items.get(key);

      current.set(key, { signature, data });
      state.missing.delete(key);

      if (baseline && !created) {
        continue;
      }

      if (!old) {
        events.push({ event: 'comment', data });
      }
      else if (old.signature !== signature) {
        events.push({ event: 'update', data: { ...data, before: old.data } });
      }

      if (old) {
        this.checkLikes(old.data, data, events);
      }
    }

    for (const [key, old] of state.items) {
      if (current.has(key)) {
        continue;
      }

      const count = (state.missing.get(key) ?? 0) + 1;

      if (count < 2) {
        state.missing.set(key, count);
        current.set(key, old);
      }
      else {
        state.missing.delete(key);
        events.push({ event: 'delete', data: old.data });
      }
    }

    state.items = current;
    states.set(id, state);

    for (const { event, data } of events) {
      if (this.contentWatch !== watch) {
        break;
      }

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

    const signal = this.cancellation ?? this.signal;

    const value = new Promise(resolve => {
      let settled = false;

      const finish = result => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        this.off('error', onError);
        this.off('open', onOpen);
        signal?.removeEventListener('abort', onAbort);

        if (!result && this.bridge === bridge) {
          this.closeBridge();
        }

        resolve(result);
      };

      const onError = () => finish(false);
      const onOpen = () => finish(true);
      const onAbort = () => finish(false);
      const timeout = setTimeout(() => {
        try {
          this.emit('error', new Error('브릿지 입장 시간 초과'));
        } finally {
          finish(false);
        }
      }, 10000);

      this.on('error', onError);
      this.on('open', onOpen);
      signal?.addEventListener('abort', onAbort, { once: true });

      bridge.connect().catch(error => {
        if (this.bridge !== bridge || signal?.aborted) {
          finish(false);

          return;
        }

        try {
          this.emit('error', error);
        } finally {
          finish(false);
        }
      });
    });

    return value;
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
    if (!this.channel) {
      return null;
    }

    const category = this.category.get(Number(this.channel.CATE))?.name || '';

    const hashtag = (Array.isArray(this.channel.HASH_TAGS) ? this.channel.HASH_TAGS : [])
      .map(v => String(v))
      .map(v => (v.startsWith('#') ? v : `#${v}`))
      .join(',');

    this.broadcast = {
      title: this.channel.TITLE,
      category,
      hashtag
    };

    const result = this.broadcast;

    return result;
  }

  updateBroadcast(data = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return;
    }

    if (this.channel && data.siMinAge !== undefined) {
      const age = Number(data.siMinAge);
      const prev = Number(this.channel.GRADE);

      if (Number.isFinite(age)) {
        this.channel.GRADE = age;

        if (Number.isFinite(prev) && age !== prev) {
          this.emit('age', { age, prev });
        }
      }
    }

    const prev = this.broadcast;

    const next = {
      ...prev
    };

    const changed = {
      title: false,
      category: false,
      hashtag: false
    };

    const sTitle = data.Title ?? data.acTitle;

    if (sTitle) {
      const title = this.decode(sTitle);

      if (title !== prev.title) {
        next.title = title;
        changed.title = true;
      }
    }

    if (data.iCategory) {
      const category = this.category.get(Number(data.iCategory))?.name || '';

      if (category !== prev.category) {
        next.category = category;
        changed.category = true;
      }
    }

    if (data.HASHTAG != null) {
      const hashtag = this.parseTag(data.HASHTAG, next.category).join(',');

      if (hashtag !== prev.hashtag) {
        next.hashtag = hashtag;
        changed.hashtag = true;
      }
    }

    this.broadcast = next;

    this.emitBroad(prev, next, changed);

    const result = { ...next, changed };

    return result;
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
      const hashtags = this.parseTag(next.hashtag, next.category);

      this.emit('hashtag', {
        hashtag: next.hashtag,
        hashtags,
        prev: prev.hashtag
      });
    }
  }

  decode(text = '') {
    if (!text) {
      return '';
    }

    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  }

  parseTag(text = '', name = '') {
    const source = Array.isArray(text) ? text.join(',') : String(text ?? '');
    const value = this.decode(source);

    if (!value) {
      const response = [];

      return response;
    }

    const output = value
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
      .filter(v => {
        const result = v.replace(/^#/, '') !== name;

        return result;
      })
      .map(v => (v.startsWith('#') ? v : `#${v}`));

    return output;
  }

  async loadBasics() {
    const result = await Promise.allSettled([this.sendLiveInfo(), this.sendStation()]);

    const get = index =>
      result[index].status === 'fulfilled' ? result[index].value : null;

    const channel = get(0);
    const station = get(1);

    this.channel = channel;
    this.station = station;

    this.bjNick = station?.user_nick || '';

    return true;
  }

  async loadAssets() {
    const options = {
      ...this.network.httpOptions,
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
      http.getEmblem(this.bjId, options)
    ]);

    const get = index =>
      result[index].status === 'fulfilled' ? result[index].value : null;

    const info = get(0);
    const category = get(1);
    const rule = get(2);
    const emoticon = get(3);
    const recent = get(4);
    const signature = get(5);
    const ogq = get(6);
    const emblem = get(7);

    this.info = info;
    this.rule = rule;
    this.recent = recent;
    this.signature = signature;
    this.ogq = ogq;
    this.emblem = emblem;

    this.category = this.mapCategory(this.flatCategory(category));

    this.emoticon = this.mapEmoticon(emoticon, signature);

    this.setBroadcast();

    return true;
  }

  sendChat(message = '') {
    message = message.replace(/\\r\\n|\\n/g, '\n');

    const result = this.send(packet.makeChat(message));

    return result;
  }

  sendNickName(nickname = '') {
    const result = this.send(packet.makeNickName(nickname));

    return result;
  }

  sendManagerChat(message = '') {
    message = message.replace(/\\r\\n|\\n/g, '\n');

    const result = this.send(packet.makeManagerChat(message));

    return result;
  }

  sendDirectChat(message = '', targetId = '') {
    message = message.replace(/\\r\\n|\\n/g, '\n');

    const result = this.send(packet.makeDirectChat(message, targetId));

    return result;
  }

  sendSubBj(targetId = '', index = 0) {
    const result = this.send(packet.makeSubBj(targetId, index));

    return result;
  }

  sendUserFlag(flag = '') {
    const result = this.send(packet.makeUserFlag(flag));

    return result;
  }

  sendClubColor(color = 0) {
    const result = this.send(packet.makeClubColor(color));

    return result;
  }

  sendTranslation(message = '', mode = 1) {
    const result = this.send(packet.makeTranslation(message, mode));

    return result;
  }

  sendDumb(targetId = '', message = '') {
    const result = this.send(packet.makeDumb(targetId, message));

    return result;
  }

  sendKick(targetId = '', index = 0, message = '') {
    if (!this.channel?.BNO) {
      return false;
    }

    const user = this.userList.get(targetId);
    const name = user?.name || '';

    const result = this.send(
      packet.makeKick(targetId, name, this.userId, this.channel.BNO, index, message)
    );

    return result;
  }

  sendBlack(targetId = '', adminId = '') {
    if (!this.channel?.BNO) {
      return false;
    }

    const result = this.send(packet.makeBlack(this.channel.BNO, adminId, targetId));

    return result;
  }

  sendKickList() {
    const result = this.send(packet.makeKickList(this.channel?.BNO));

    return result;
  }

  sendSlowMode(count = 0) {
    if (!this.channel?.BNO) {
      return false;
    }

    const result = this.send(packet.makeSlowMode(this.channel.CHATNO, count));

    return result;
  }

  sendSubtitle(index = this.subtitle) {
    const result = this.send(packet.makeSubtitle(index));

    return result;
  }

  sendUserList() {
    const result = this.send(packet.makeUserList());

    return result;
  }

  async sendStation() {
    const result = await http.getStation(this.bjId, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    const value = result?.station;

    return value;
  }

  async sendLiveInfo() {
    const result = await http.postLiveInfo(this.bjId, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    if (result && !result.TK) {
      result.TK = http.cookieString(this.cookie).match(/(?:^|;\s*)AuthTicket=([^;]*)/)?.[1] || '';
    }

    return result;
  }

  async sendEmblem(userId = this.bjId) {
    const result = await http.getEmblem(userId, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    if (userId === this.bjId) {
      this.emblem = result;
    }

    return result;
  }

  async sendStream(quality = 'hd') {
    const result = http.getStream(this.bjId, quality, {
      ...this.network.httpOptions,
      cookie: this.cookie,
      password: this.broadPw
    });

    return result;
  }

  async startPackage(quality = 'original') {
    if (this.idle) {
      return false;
    }

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
      if (this.package === media) {
        this.package = null;
      }

      this.emit('packageClose', data);
    });

    try {
      const result = await media.connect();

      return result;
    } catch (error) {
      media.fail(error);

      throw error;
    }
  }

  stopPackage() {
    const media = this.package;

    if (!media) {
      return false;
    }

    this.package = null;

    return media.close();
  }

  async sendBroad() {
    const result = await http.getSection(this.bjId, 'broad', {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return result;
  }

  async sendPostList(bjId = this.bjId) {
    const result = await http.getBoard(
      bjId,
      { perPage: 20 },
      {
        ...this.network.httpOptions,
        cookie: this.cookie
      }
    );

    if (!Array.isArray(result?.data)) {
      return null;
    }

    const posts = new Map();
    const notices = Array.isArray(result.notice_data) ? result.notice_data : [];

    for (const item of [...result.data, ...notices]) {
      if (!item?.title_no || item.ucc) {
        continue;
      }

      posts.set(String(item.title_no), item);
    }

    const value = [...posts.values()].map(item => ({
      titleNo: item.title_no,
      titleName: item.title_name,
      userId: item.user_id,
      userNick: item.user_nick,
      authNo: item.auth_no,
      likes: item.count?.like_cnt,
      content: item.content?.content ?? item.content?.text_content ?? '',
      photos: (item.photos ?? []).map(photo => photo.url),
      regDate: item.reg_date
    }));

    return value;
  }

  async sendClipList(bjId = this.bjId) {
    const result = await http.getVod(bjId, 'clip', {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    const value = result?.contents;

    return value;
  }

  async sendCatchList(bjId = this.bjId) {
    const result = await http.getVod(bjId, 'catch', {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    const value = result?.contents;

    return value;
  }

  findLastPost(data = []) {
    if (!Array.isArray(data)) {
      return null;
    }

    const value = data.find(post => {
      const result = post.userId === this.bjId;

      return result;
    });

    return value;
  }

  async sendIceMode(type = 'ice_on', auth = 100001) {
    if (this.idle) {
      return false;
    }

    if (!this.channel?.BNO) {
      return false;
    }

    const result = await http.postIceMode(this.channel.BNO, this.userId, type, auth, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return result;
  }

  async sendNotice(message = '') {
    if (this.idle || !this.channel?.BNO) {
      return false;
    }

    const state = message.trim() ? 1 : 0;
    const result = await http.postChatNotice(this.channel.BNO, message, state, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return result;
  }

  async sendRule(message = '', display = 1) {
    if (this.idle || !this.channel?.BNO) {
      return false;
    }

    const result = await http.postRule(message, display, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return result;
  }

  makeIceAuth({
    streamer = true,
    fanClub = false,
    supporter = false,
    topFan = false,
    subscriber = false,
    manager = true
  } = {}) {
    let mask = 0;

    if (streamer) {
      mask |= ICE_AUTH.STREAMER;
    }

    if (fanClub) {
      mask |= ICE_AUTH.FAN_CLUB;
    }

    if (supporter) {
      mask |= ICE_AUTH.SUPPORTER;
    }

    if (topFan) {
      mask |= ICE_AUTH.TOP_FAN;
    }

    if (subscriber) {
      mask |= ICE_AUTH.SUBSCRIBER;
    }

    if (manager) {
      mask |= ICE_AUTH.MANAGER;
    }

    return mask;
  }

  async sendIceOption(count = 0, date = 1) {
    if (this.idle) {
      return false;
    }

    const result = await http.postIceOption(count, date, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return result;
  }

  async sendPoll(index) {
    if (this.idle) {
      return false;
    }

    if (!this.channel?.BNO) {
      return false;
    }

    const result = await http.postPoll(this.poll.bjId, this.poll.surveyNo, index, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return result;
  }

  async sendPollList(surveyNo) {
    const result = await http.getPoll(this.bjId, surveyNo, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return result;
  }

  async sendOgq(message, ogqId, index = 1) {
    message = String(message || '').replace(/\\r\\n|\\n/g, '\n');

    if (this.idle) {
      return false;
    }

    const result = await http.postOgqChat(
      this.channel,
      this.userId,
      message,
      ogqId,
      index,
      {
        ...this.network.httpOptions,
        cookie: this.cookie
      }
    );

    return result;
  }

  async sendChallengeList() {
    const result = await http.postChallenge(this.bjId, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return this.formatChallenge(result);
  }

  formatChallenge(result) {
    void result?.data;

    if (result?.result !== 1 || !Array.isArray(result?.data)) {
      const output = {
        ok: false,
        code: result?.result,
        message: result?.msg
      };

      return output;
    }

    const list = result.data.map(item => {
      const result = {
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
        balloon: Number(item.balloon_cnt),
        unique: Number(item.unique_user),
        time: Number(item.remain_time)
      };

      return result;
    });

    const value = {
      ok: true,
      message: result.msg,
      list
    };

    return value;
  }

  formatTime(seconds = 0) {
    seconds = Number(seconds) || 0;

    const day = Math.floor(seconds / 86400);
    const hour = Math.floor((seconds % 86400) / 3600);
    const min = Math.floor((seconds % 3600) / 60);

    const result =
      [day ? `${day}일` : '', hour ? `${hour}시간` : '', min ? `${min}분` : '']
        .filter(Boolean)
        .join(' ') || '0분';

    return result;
  }

  async sendMissionList() {
    const result = await http.postMission(this.bjId, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    return this.formatMission(result);
  }

  formatMission(result) {
    const data = result?.DATA;

    if (result?.RESULT !== 1 || !data) {
      const output = {
        ok: false,
        code: result?.RESULT,
        message: result?.MSG
      };

      return output;
    }

    const teams = data.team
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map(team => {
        const members = team.member
          .map(user => {
            const leader = user.team_leader ? '👑 ' : '';

            const result = `${leader}${user.bj_nick}(${user.bj_id})`;

            return result;
          })
          .join(', ');

        const result = `[${team.team_name}] ${members}`;

        return result;
      })
      .join('\n');

    const value = {
      ok: true,
      title: data.title,
      status: data.mission_status,
      total: data.total_escrow_count,
      teams
    };

    return value;
  }

  findAssets(data = {}) {
    if (!data) {
      return null;
    }

    const emoticons = this.findEmoticon(data.message);

    const tier = data.tier;
    const subMonth = Number(data.subMonth);

    const tierUrl = tier ? this.makeTierUrl(tier, subMonth) : '';

    const result = {
      emoticons,
      tier,
      tierName: data.tierName,
      subMonth,
      tierUrl
    };

    return result;
  }

  makeBalloonUrl(data = {}) {
    const count = Number(data.count) || 0;

    let step;

    if (count < 10) {
      step = 1;
    }
    else {
      if (count < 50) {
        step = 2;
      }
      else {
        if (count < 100) {
          step = 3;
        }
        else {
          if (count < 500) {
            step = 4;
          }
          else {
            if (count < 1000) {
              step = 5;
            }
            else {
              step = 6;
            }
          }
        }
      }
    }

    const defaultUrl = new URL(`/new_player/items/ba_step${step}.png`, DOMAIN.res);

    if (data.isDefault) {
      const output = defaultUrl.href;

      return output;
    }

    let fileName = String(data.fileName || '');

    if (!fileName) {
      const value = defaultUrl.href;

      return value;
    }

    const isSpecial =
      fileName.includes('evt')
      || fileName.includes('sig')
      || fileName.includes('signature');

    if (data.language && data.language !== 'ko_KR' && !isSpecial) {
      fileName += '_en';
    }

    let url;

    if (isSpecial) {
      url = new URL(`/starballoon/story_m/${fileName}.png`, DOMAIN.static);
    }
    else {
      url = new URL(`/new_player/items/m_balloon_${fileName}.png`, DOMAIN.res);
    }

    if (data.urlModify) {
      url.href += `?v=${data.urlModify}`;
    }

    const result = url.href;

    return result;
  }

  makeStickerUrl(type, language = 'ko_KR') {
    type = String(type || 'sticker');

    if (language && language !== 'ko_KR') {
      type += '_en';
    }

    const result = new URL(`/new_player/items/${type}.png`, DOMAIN.res).href;

    return result;
  }

  makeGudokUrl(month = 1, modify = '') {
    const url = new URL(`/subscription_ceremony/m/gudok_${month}.png`, DOMAIN.static);

    const result = modify ? `${url}?v=${modify}` : url.href;

    return result;
  }

  makeTierUrl(tier = 1, month = 0) {
    const pcon = this.channel?.PCON_OBJECT;

    if (!pcon || typeof pcon !== 'object') {
      return '';
    }

    const get = tier => pcon[`tier${tier}`];

    const list = get(tier);

    if (!Array.isArray(list)) {
      return '';
    }

    const sorted = [...list].sort((a, b) => {
      const result = Number(b.MONTH) - Number(a.MONTH);

      return result;
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

  makeEmblemUrl(emblem = this.emblem) {
    return emblem?.url || '';
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

    const result = {
      id,
      max,
      ext,
      domain: ogq.img_domain,
      item
    };

    return result;
  }

  makeOgqUrl(index = 0, subId = 1) {
    const ogq = this.findOgq(index);

    if (!ogq) {
      return '';
    }

    if (subId < 1 || subId > ogq.max) {
      return '';
    }

    const result = new URL(
      `/sticker/${ogq.id}/${subId}.${ogq.ext}`,
      http.normalize(ogq.domain)
    ).href;

    return result;
  }

  flatCategory(categories = []) {
    const result = [];
    const list = Array.isArray(categories) ? categories : [];

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

      if (!section) {
        continue;
      }

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
            smallUrl: new URL(emoticon.fileName, section.small_url).href,
            bigUrl: new URL(emoticon.fileName, section.big_url).href
          });
        }
      }
    }

    const url = new URL(`/signature_emoticon/${this.bjId}/`, DOMAIN.static);

    for (const [tierKey, list] of Object.entries(signature || {})) {
      const tier = Number(tierKey.replace('tier', ''));

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
          smallUrl: new URL(item.mobile_img, url.href).href,
          bigUrl: new URL(item.pc_img, url.href).href
        });
      }
    }

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
