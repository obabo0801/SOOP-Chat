import fs from 'fs';
import path from 'path';
import { SVC } from '#soop/config';
import * as http from '#soop/http';
import * as ntfy from '#utils/ntfy';
import * as log from '#utils/log';

const PACKETS = new Set([
  SVC.CHAT,
  SVC.CHUSER,
  SVC.MANAGER_CHAT,
  SVC.SET_NICKNAME,
  SVC.ICE_MODE_EX,
  SVC.SLOW_MODE,
  SVC.BJ_NOTICE,
  SVC.SEND_BALLOON,
  SVC.SEND_BALLOON_SUB,
  SVC.SEND_FAN_LETTER,
  SVC.SEND_FAN_LETTER_SUB,
  SVC.SEND_QUICKVIEW,
  SVC.ADCON_EFFECT,
  SVC.VIDEO_BALLOON,
  SVC.VOD_BALLOON,
  SVC.VOD_ADCON,
  SVC.STATION_ADCON,
  SVC.SEND_SUBSCRIPTION,
  SVC.FOLLOW_ITEM,
  SVC.FOLLOW_ITEM_EFFECT,
  SVC.SUB_CEREMONY_BUTTON,
  SVC.OGQ_EMOTICON_GIFT,
  SVC.MISSION_SETTLE
]);

const EVENTS = {
  start: ['방송', '방송 시작'],
  end: ['방송', '방송 종료'],
  title: ['방송', '제목'],
  category: ['방송', '카테고리'],
  hashtag: ['방송', '태그'],
  age: ['방송', '연령 제한'],
  streamer: ['채팅', '스트리머 채팅'],
  manager: ['채팅', '매니저 채팅'],
  call: ['채팅', '호출'],
  keyword: ['채팅', '키워드'],
  mention: ['채팅', '닉네임 언급'],
  post: ['콘텐츠', '게시글'],
  clip: ['콘텐츠', '클립'],
  catch: ['콘텐츠', '캐치'],
  support: ['후원', '후원'],
  quit: ['운영', '강퇴'],
  ice: ['운영', '얼음'],
  slow: ['운영', '저속 모드'],
  notice: ['운영', '스트리머 공지'],
  rule: ['운영', '채팅 규칙'],
  disconnect: ['연결', '연결 끊김'],
  error: ['연결', '오류'],
  multi: ['연결', '멀티 모드']
};

const SUPPORT = {
  balloon: '별풍선',
  adcon: '애드벌룬',
  videoBalloon: '영상 풍선',
  vodBalloon: 'VOD 별풍선',
  vodAdcon: 'VOD 애드벌룬',
  stationAdcon: '방송국 애드벌룬',
  sticker: '스티커',
  quickview: '퀵뷰',
  subscription: '구독권',
  follow: '구독',
  followEffect: '연속 구독',
  subCeremony: '구독 갱신',
  ogqGift: 'OGQ 선물',
  missionSettle: '미션 정산'
};

const settings = new Map();

function defaults() {
  const result = {
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '$NTFY_TOPIC',
    token: '$NTFY_TOKEN',
    keywords: [],
    nicknames: [],
    events: Object.fromEntries(Object.keys(EVENTS).map(key => [key, true]))
  };

  return result;
}

function read(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));

  return validate(value);
}

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('알림 설정 오류');
  }

  const config = {
    ...defaults(),
    ...value,
    events: {
      ...defaults().events,
      ...value.events
    }
  };

  if (
    typeof config.enabled !== 'boolean'
    || !['server', 'topic', 'token'].every(key => typeof config[key] === 'string')
    || !['keywords', 'nicknames'].every(key =>
      Array.isArray(config[key]) && config[key].every(item => typeof item === 'string')
    )
    || !Object.entries(config.events).every(([key, enabled]) =>
      Object.hasOwn(EVENTS, key) && typeof enabled === 'boolean'
    )
  ) {
    throw new Error('알림 설정 오류');
  }

  return config;
}

function resolve(value) {
  const result = value.startsWith('$') ? process.env[value.slice(1)] || '' : value;

  return result;
}

function state(file) {
  if (!settings.has(file)) {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(defaults(), null, 4)}\n`, { flag: 'wx' });
    }

    settings.set(file, {
      config: read(file),
      clients: new Set(),
      queue: [],
      pending: null,
      controller: null,
      recent: new Map(),
      streams: new Map()
    });
  }

  const result = settings.get(file);

  return result;
}

export class SoopNotify {
  settings() {
    const config = this.state.config;
    const result = {
      config: { ...config, token: '', events: { ...config.events } },
      authenticated: Boolean(resolve(config.token)),
      connected: Boolean(resolve(config.topic)),
      events: EVENTS
    };

    return result;
  }

  save(value) {
    const config = validate({ ...this.state.config, ...value });

    fs.writeFileSync(this.file, `${JSON.stringify(config, null, 4)}\n`);
    this.apply(config);

    return this.settings();
  }

  async test(value) {
    const config = validate({ ...this.state.config, ...value });

    await ntfy.publish({
      server: resolve(config.server),
      topic: resolve(config.topic),
      token: resolve(config.token)
    }, { title: 'SOOP Chat 알림 테스트', message: '알림 연결이 확인되었습니다.' });
  }

  apply(config) {
    this.state.config = config;

    for (const item of this.state.queue) {
      item.complete?.(false);
    }

    this.state.queue = [];
    this.state.controller?.abort();

    for (const notify of this.state.clients) {
      if (notify.client.idle && notify.client.isOpen()) {
        void notify.prepare().catch(() => {});
      }
    }
  }

  constructor(client, options = {}) {
    if (client.notify) {
      throw new Error('알림이 이미 연결되어 있습니다.');
    }

    this.client = client;
    this.id = options.id;
    this.file = path.resolve(options.file || 'notifications.json');
    this.state = state(this.file);
    this.state.clients.add(this);
    this.events = new Map();
    this.closed = false;
    this.rule = null;
    this.nickname = '';
    this.polling = null;
    this.pollController = null;
    client.notify = this;

    this.timer = setInterval(() => {
      void this.refreshRule();
    }, 30000);
    this.timer.unref();

    this.on('join', () => {
      const key = client.bjId;
      const number = client.channel?.BNO;
      const before = this.state.streams.get(key);

      if (!number) {
        return;
      }

      const stream = before?.number === number && before.live
        ? before : { number, live: true, started: false, ended: false };
      this.state.streams.set(key, stream);

      if (!stream.started && this.selected('start')) {
        stream.started = true;
        this.send('start', `방송이 감지되었습니다.\n${client.broadcast.title}`);
      }
    });

    this.on('broadcastEnd', data => {
      const key = data.bjId || client.bjId;
      const before = this.state.streams.get(key);

      if (before && data.broadNo && before.number !== data.broadNo) {
        return;
      }

      const stream = before || { number: data.broadNo, ended: false };
      stream.live = false;
      this.state.streams.set(key, stream);

      if (!stream.ended && this.selected('end')) {
        stream.ended = true;
        this.send('end', data.message || '방송이 종료되었습니다.');
      }
    });

    for (const key of ['title', 'category', 'hashtag']) {
      this.on(key, data => this.send(key, `${data.prev || '없음'} → ${data[key] || '없음'}`));
    }

    this.on('age', data => {
      this.send('age', `${data.prev || '전체'} → ${data.age || '전체'}`);
    });
    this.on('live', data => {
      if ([-6, -8].includes(data.result ?? data.code)) {
        this.send('age', '성인 인증이 필요한 방송입니다.');
      }
    });
    this.on('chat', data => this.chat(data));
    this.on('managerChat', data => this.chat(data, true));

    const contents = {
      post: '등록',
      edit: '수정',
      clip: '등록',
      catch: '등록',
      remove: '삭제',
      visibility: '공개 설정'
    };

    for (const [event, label] of Object.entries(contents)) {
      this.on(event, data => {
        const type = event === 'edit' ? 'post' : data.type || event;

        if (!['post', 'clip', 'catch'].includes(type)) {
          return;
        }

        let action = label;

        if (event === 'visibility') {
          action = data.public ? '공개 전환' : '비공개 전환';
        }

        this.send(
          type,
          data.title || '제목 없음',
          1000,
          `${EVENTS[type][1]} ${action}`,
          data.url
        );
      });
    }

    this.on('quit', data => {
      this.send('quit', `${data.adminNick || '운영자'}에 의해 강제퇴장 되었습니다.`);
    });
    this.on('chuser', data => {
      if (data.type === -1 && data.user.exit !== 1) {
        this.send('quit', `${data.user.name || data.user.id}님이 강제퇴장 되었습니다.`);
      }
    });
    this.on('iceMode', data => {
      const message = data.index ? '채팅이 얼었습니다.' : '채팅이 녹았습니다.';

      this.send('ice', message);
    });
    this.on('slowMode', data => {
      const message = data.count
        ? `${data.count}초 간격으로 채팅할 수 있습니다.`
        : '저속 모드가 해제되었습니다.';

      this.send('slow', message);
    });
    this.on('notice', data => {
      const message = Number(data.state) > 0 ? data.message : '공지가 해제되었습니다.';

      this.send('notice', message);
    });
    this.on('rule', data => {
      const signature = JSON.stringify([
        client.channel?.BNO,
        data.chat_rule_display,
        data.chat_rule
      ]);

      if (this.rule !== signature) {
        this.rule = signature;
        const message = Number(data.chat_rule_display) > 0
          ? data.chat_rule : '채팅 규칙이 숨겨졌습니다.';

        this.send('rule', message);
      }
    });
    this.on('nickName', data => {
      if (data.userId === client.userId) {
        this.nickname = data.newNick;
      }
    });
    this.on('connectionClose', data => {
      if (this.state.streams.get(client.bjId)?.live === false) {
        return;
      }

      const name = data.source === 'bridge' ? '브릿지' : '채팅';

      this.send('disconnect', `${name} 연결이 끊겼습니다.`, 10000);
    });
    this.on('error', () => {
      const message =
        '연결 또는 요청 처리 오류가 발생했습니다. 자세한 내용은 콘솔을 확인하세요.';

      this.send('error', message, 30000);
    });
    this.on('packageError', () => {
      this.send('error', '방송 영상 연결 오류가 발생했습니다.', 30000);
    });

    for (const [event, name] of Object.entries(SUPPORT)) {
      this.on(event, data => {
        const user = data.userNick || data.fromNick || data.userId || data.fromId || '사용자';
        const count = data.count ?? data.item?.days;
        const amount = count == null ? '' : ` ${count}`;
        const title = data.title ? ` (${data.title})` : '';

        this.send('support', `${user}: ${name}${amount}${title}`);
      });
    }
  }

  on(event, handler) {
    this.events.set(event, handler);
    this.client.on(event, handler);
  }

  selected(key) {
    const { config } = this.state;

    const result = !this.closed && config.enabled && config.events[key]
      && (this.id === undefined || config.events.multi);

    return result;
  }

  accepts(service) {
    const result = this.state.config.enabled && !this.closed
      && (this.id === undefined || this.state.config.events.multi)
      && Boolean(resolve(this.state.config.topic)) && PACKETS.has(service);

    return result;
  }

  async prepare() {
    const client = this.client;

    if (!this.accepts(SVC.CHAT) || !client.channel) {
      return;
    }

    const options = { ...client.network.httpOptions, cookie: client.cookie };
    const bjId = client.bjId;
    const broadNo = client.channel.BNO;
    const results = await Promise.allSettled([
      http.getCategory(client.channel.svc_lang, options),
      http.postChatRule(client.bjId, options)
    ]);

    if (
      this.closed || options.signal?.aborted || client.bjId !== bjId
      || client.channel?.BNO !== broadNo
    ) {
      return;
    }

    if (results[0].status === 'fulfilled' && results[0].value) {
      client.category = client.mapCategory(client.flatCategory(results[0].value));
    }

    if (results[1].status === 'fulfilled' && results[1].value) {
      client.rule = results[1].value;
    }

    client.setBroadcast();
  }

  refreshRule() {
    if (this.polling || !this.selected('rule') || !this.client.isOpen()) {
      return this.polling;
    }

    const bjId = this.client.bjId;
    const broadNo = this.client.channel?.BNO;
    this.pollController = new AbortController();

    this.polling = http.postChatRule(bjId, {
      ...this.client.network.httpOptions,
      cookie: this.client.cookie,
      signal: AbortSignal.any([
        this.pollController.signal,
        ...(this.client.network.signal ? [this.client.network.signal] : [])
      ])
    }).then(data => {
      if (data && !this.closed && this.client.isOpen()
        && this.client.bjId === bjId && this.client.channel?.BNO === broadNo) {
        const previous = this.client.rule;
        const changed = previous?.chat_rule !== data.chat_rule
          || Number(previous?.chat_rule_display) !== Number(data.chat_rule_display);

        this.client.rule = data;

        if (changed) {
          this.client.emit('rule', data);
        }
      }
    }).catch(() => {}).finally(() => {
      this.polling = null;
      this.pollController = null;
    });

    return this.polling;
  }

  chat(data, manager = false) {
    const message = String(data.message || '');

    const lower = message.toLocaleLowerCase();
    const config = this.state.config;
    const matches = values => {
      const result = values.some(value =>
        value.trim() && lower.includes(value.trim().toLocaleLowerCase())
      );

      return result;
    };
    const names = [
      ...config.nicknames,
      this.nickname,
      this.client.info?.LOGIN_NICK,
      this.client.channel?.UNICK
    ].filter(Boolean);
    const own = data.userId && data.userId === this.client.userId;
    const labels = [
      (data.isBJ || data.userId === this.client.bjId) && this.selected('streamer') && '스트리머 채팅',
      manager && this.selected('manager') && '매니저 채팅',
      matches(config.keywords) && this.selected('keyword') && '키워드',
      !own && matches(names) && this.selected('mention') && '닉네임 언급'
    ].filter(Boolean);

    if (labels.length) {
      this.send(
        'chat',
        `${data.userNick || data.userId}: ${message}`,
        1000,
        labels.join(', ')
      );
    }
  }

  call(message, cooldown, label) {
    const result = new Promise(resolve => {
      const sent = this.send('call', message, cooldown, label, undefined, resolve);

      if (!sent) {
        resolve(false);
      }
    });

    return result;
  }

  send(key, message, cooldown = 1000, label, url, complete) {
    const selected = key === 'chat'
      ? ['keyword', 'mention', 'streamer', 'manager'].some(key => this.selected(key))
      : this.selected(key);

    if (!selected) {
      return;
    }

    const config = this.state.config;

    if (!resolve(config.topic)) {
      return;
    }

    const name = this.client.bjNick || this.client.bjId;
    const signature =
      `${this.client.bjId}:${this.client.channel?.BNO}:${key}:${label || ''}:`
      + `${message}:${url || ''}`;
    const now = Date.now();

    for (const [item, time] of this.state.recent) {
      if (now - time >= 30000) {
        this.state.recent.delete(item);
      }
    }

    if (now - (this.state.recent.get(signature) || 0) < cooldown) {
      return;
    }

    this.state.recent.set(signature, now);

    if (this.state.queue.length >= 100) {
      log.warn('[알림]', '전송 대기 한도 초과');
      return;
    }

    this.state.queue.push({
      owner: this,
      key,
      complete,
      message: {
        title: `[${name}] ${label || EVENTS[key][1]}`,
        message: String(message || '변경되었습니다.').slice(0, 1000),
        click: url || `https://play.sooplive.com/${encodeURIComponent(this.client.bjId)}`,
        tags: ['SOOP'],
        priority: ['quit', 'disconnect', 'error'].includes(key) ? 4 : 3
      }
    });
    this.drain();

    return true;
  }

  drain() {
    const store = this.state;

    if (store.pending) {
      return;
    }

    store.pending = Promise.resolve().then(async () => {
      while (store.queue.length) {
        const item = store.queue.shift();

        if (
          item.owner.closed || !store.config.enabled
          || item.owner.id !== undefined && !store.config.events.multi
          || item.key !== 'chat' && !store.config.events[item.key]
        ) {
          item.complete?.(false);

          continue;
        }

        store.controller = new AbortController();

        try {
          const config = store.config;
          await ntfy.publish({
            server: resolve(config.server),
            topic: resolve(config.topic),
            token: resolve(config.token)
          }, item.message, store.controller.signal);
          item.complete?.(true);
        } catch {
          item.complete?.(false);
          if (!store.controller.signal.aborted) {
            log.warn('[알림]', 'ntfy 전송 실패: 서버, 토픽, 인증 설정을 확인하세요.');
          }
        } finally {
          store.controller = null;
        }
      }
    }).finally(() => {
      store.pending = null;

      if (store.queue.length) {
        this.drain();
      }
    });
  }

  command(input) {
    const [name, ...args] = input.trim().split(/\s+/);

    if (name !== '/알림') {
      return false;
    }

    const action = args.at(-1);
    const config = this.state.config;

    if (args.length === 1 && args[0] === '다시읽기') {
      this.state.config = read(this.file);
    }
    else if (['켜기', '끄기'].includes(action)) {
      const target = args.slice(0, -1).join(' ');
      const key = Object.keys(EVENTS).find(key => key === target || EVENTS[key][1] === target);

      if (target && !key) {
        throw new Error('알림 항목 없음');
      }

      const next = { ...config, events: { ...config.events } };

      if (key) {
        next.events[key] = action === '켜기';
      }
      else {
        next.enabled = action === '켜기';
      }

      fs.writeFileSync(this.file, `${JSON.stringify(next, null, 4)}\n`);
      this.state.config = next;
    }
    else if (args.length && !(args.length === 1 && args[0] === '목록')) {
      throw new Error('사용법: /알림 [항목] 켜기|끄기 또는 /알림 목록|다시읽기');
    }

    if (args.length && args[0] !== '목록') {
      this.apply(this.state.config);
    }
    const current = this.state.config;
    const enabled = current.enabled ? '켜짐' : '꺼짐';
    const topic = resolve(current.topic) ? '토픽 설정 됨' : '토픽 미설정';
    const rows = Object.entries(EVENTS).map(([key, [group, name]]) => [
      key,
      { 분류: group, 항목: name, 상태: current.events[key] ? '켜짐' : '꺼짐' }
    ]);

    log.info('[알림]', enabled, topic);
    log.table(Object.fromEntries(rows));

    return true;
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.pollController?.abort();

    if (this.client.notify === this) {
      this.client.notify = null;
    }

    for (const [event, handler] of this.events) {
      this.client.off(event, handler);
    }

    this.events.clear();
    this.state.clients.delete(this);
    this.state.queue = this.state.queue.filter(item => {
      if (item.owner === this) {
        item.complete?.(false);

        return false;
      }

      return true;
    });

    if (!this.state.clients.size) {
      this.state.controller?.abort();
      await this.state.pending;
      settings.delete(this.file);
    }
  }
}
