import fs from 'fs';
import path from 'path';
import { settingsFile } from './settings.js';
import { useEnabled } from './editor/usage.js';
import { inbox } from './editor/alerts.js';
import { SVC } from '#soop/config';
import * as http from '#soop/http';
import * as ntfy from '#utils/ntfy';
import * as log from '#utils/log';
import * as push from './editor/push.js';

const PACKETS = new Set([
  SVC.CHAT,
  SVC.OGQ_EMOTICON,
  SVC.CHUSER,
  SVC.MANAGER_CHAT,
  SVC.DIRECT_CHAT,
  SVC.SET_DUMB,
  SVC.NOTIFY_POLL,
  SVC.MISSION,
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

const CONTENTS = { post: '게시글', clip: '클립', catch: '캐치' };
const ACTIONS = { Create: '작성', Edit: '수정', Delete: '삭제', Like: '좋아요' };
const EVENTS = {
  start: ['방송', '방송 시작'],
  end: ['방송', '방송 종료'],
  title: ['방송', '제목'],
  category: ['방송', '카테고리'],
  hashtag: ['방송', '태그'],
  age: ['방송', '연령 제한'],
  streamer: ['채팅', '스트리머 채팅'],
  manager: ['채팅', '매니저 채팅'],
  whisper: ['채팅', '귓속말'],
  call: ['채팅', '호출'],
  keyword: ['채팅', '키워드'],
  mention: ['채팅', '닉네임 언급'],
  ...Object.fromEntries(Object.entries(CONTENTS).flatMap(([type, name]) =>
    Object.entries(ACTIONS).map(([action, label]) => [`${type}${action}`, ['콘텐츠', `${name} ${label}`]]))),
  support: ['후원', '후원'],
  gift: ['후원', '선물'],
  challenge: ['후원', '도전이'],
  battle: ['후원', '대결이'],
  mute: ['운영', '채팅 금지'],
  quit: ['운영', '강제 퇴장'],
  ice: ['운영', '얼리기'],
  poll: ['운영', '투표'],
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
    topic: '',
    token: '$NTFYTOKEN',
    keywords: [],
    nicknames: [],
    events: Object.fromEntries(Object.keys(EVENTS).map(key => [key, true]))
  };

  return result;
}

export function stickers(value) {
  const matches = String(value || '').match(/https:\/\/ogq-sticker-global-cdn-z01\.sooplive\.com\/sticker\/[\w-]+\/[1-9]\d*(?:_\d+)?\.(?:png|webp)/g) || [];
  return [...new Set(matches)].slice(0, 10);
}

export function images(value, photos = []) {
  const sources = [...String(value || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map(match => match[1]);
  const result = [];
  for (const source of [...sources, ...photos]) {
    try {
      const url = new URL(String(source).replace(/&amp;/g, '&'), 'https://www.sooplive.com');
      if (url.protocol === 'http:') url.protocol = 'https:';
      if (url.protocol === 'https:' && !url.username && !url.password) result.push(url.href);
    } catch {}
  }
  return [...new Set(result)].slice(0, 10);
}

export function preview(value, limit = 300) {
  const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const text = String(value || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name) => entities[name.toLowerCase()])
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function read(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config = validate(value);
  return config;
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
      ...value.events,
      gift: value.events?.gift ?? value.events?.support ?? true
    }
  };

  for (const type of Object.keys(CONTENTS)) {
    for (const action of Object.keys(ACTIONS)) {
      const key = `${type}${action}`;
      config.events[key] = value.events?.[key] ?? value.events?.[type] ?? true;
    }
    delete config.events[type];
  }

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

  config.events.call = true;

  return config;
}

function resolve(value) {
  const result = value.startsWith('$') ? process.env[value.slice(1)] || '' : value;

  return result.trim();
}

function state(file) {
  if (!file) {
    return {
      config: defaults(), clients: new Set(), queue: [], pending: null,
      controller: null, recent: new Map(), streams: new Map()
    };
  }

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
  get enabled() {
    return useEnabled(this.client, this.file, this.state.config.enabled);
  }
  address() {
    const value = this.state.editor?.();

    if (!value) {
      return;
    }

    try {
      const address = new URL(value);

      if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) {
        return;
      }

      address.hash = '';

      return address.href;
    } catch {}
  }

  settings() {
    const config = this.state.config;
    const result = {
      config: { ...config, enabled: this.enabled, token: '', events: { ...config.events } },
      authenticated: Boolean(resolve(config.token)),
      connected: Boolean(resolve(config.topic)),
      events: Object.fromEntries(Object.entries(EVENTS).filter(([key]) => key !== 'call'))
    };

    return result;
  }

  save(value) {
    if (!this.file) {
      throw new Error('방송을 먼저 선택해주세요.');
    }

    const config = validate({ ...this.state.config, ...value, enabled: false });
    if (typeof value.enabled === 'boolean') {
      useEnabled(this.client, this.file, this.state.config.enabled, value.enabled);
    }

    if (JSON.stringify(config) !== JSON.stringify({ ...this.state.config, enabled: false })) {
      fs.writeFileSync(this.file, `${JSON.stringify(config, null, 4)}\n`);
      this.apply(config);
    } else if (!this.enabled) {
      if (this.id !== undefined) this.clearSupports();
      this.state.queue = this.state.queue.filter(item => {
        if (item.owner !== this) return true;
        item.complete?.(false);
        return false;
      });
      if (this.state.sending === this) this.state.controller?.abort();
    } else if (this.client.idle && this.client.isOpen()) {
      void this.prepare().catch(() => {});
    }

    return this.settings();
  }

  async test(value) {
    const config = validate({ ...this.state.config, ...value });
    if (!resolve(config.topic)) return false;

    await ntfy.publish({
      server: resolve(config.server),
      topic: resolve(config.topic),
      token: resolve(config.token)
    }, {
      title: 'SOOP Chat 알림 테스트',
      message: '알림 연결이 확인되었습니다.',
      click: this.address()
    });
  }

  apply(config) {
    this.state.config = config;

    for (const item of this.state.queue) {
      item.complete?.(false);
    }

    this.state.queue = [];
    this.state.controller?.abort();

    for (const notify of this.state.clients) {
      notify.clearSupports();
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
    this.options = options;
    this.file = client.bjId ? settingsFile('notifications', client.bjId, true, options.file) : null;
    this.state = state(this.file);

    if (typeof options.editor === 'function') {
      this.state.editor = options.editor;
    }

    this.state.clients.add(this);
    this.events = new Map();
    this.supports = new Set();
    this.messages = new Map();
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

    this.bind();
  }

  bind() {
    const client = this.client;
    this.state.config = validate(this.state.config);
    for (const [event, handler] of this.events) client.off(event, handler);
    this.events.clear();

    this.on('channel', () => this.select());

    this.on('join', () => {
      const key = client.bjId;
      const number = client.channel?.BNO;
      const before = this.state.streams.get(key);

      if (!number || this.id !== undefined) {
        return;
      }

      const starting = before?.live === false && before.number !== number;
      const stream = before?.number === number && before.live
        ? before : { number, live: true, started: false, ended: false };

      stream.started = true;
      this.state.streams.set(key, stream);

      if (starting && this.selected('start')) {
        this.send('start', `방송이 감지되었습니다.\n${client.broadcast.title}`,
          undefined, undefined, `https://play.sooplive.com/${encodeURIComponent(key)}/${encodeURIComponent(number)}`);
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

      this.state.queue = this.state.queue.filter(item => {
        const stale = ['error', 'disconnect'].includes(item.key)
          && item.bjId === key
          && (!data.broadNo || !item.number || String(item.number) === String(data.broadNo));

        if (stale) {
          item.complete?.(false);
        }

        return !stale;
      });

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
      if ((data.result ?? data.code) === 0 && this.id === undefined) {
        const key = data.bjId || client.bjId;
        const before = this.state.streams.get(key);

        this.state.streams.set(key, { ...before, live: false });
      }

      if ([-6, -8].includes(data.result ?? data.code)) {
        this.send('age', '성인 인증이 필요한 방송입니다.');
      }
    });
    this.on('chat', data => this.chat(data));
    this.on('ogq', data => this.chat({ ...data, message: '' }));
    this.on('managerChat', data => this.chat(data, true));
    this.on('directChat', data => {
      if (data.type !== 1 || !data.message) return;
      const user = data.fromNick || data.fromId || '사용자';
      this.send('whisper', `${user}님: ${data.message}`, 1000, '귓속말', undefined, undefined, {
        ...data, userId: data.fromId, userNick: user, month: data.month ?? data.subMonth
      });
    });
    this.on('poll', data => {
      const messages = {
        1: '새로운 투표가 시작되었습니다.',
        2: '투표가 종료되었습니다.',
        3: '투표가 마감되었습니다.',
        4: '투표 결과가 공개되었습니다.'
      };

      if (messages[data.status]) {
        this.send('poll', messages[data.status]);
      }
    });
    for (const event of ['challenge', 'battle']) {
      this.on(event, data => {
        const name = EVENTS[event][1];
        const title = data.title ? `[${data.title}] ` : '';
        let message = '';

        if (['CHALLENGE_GIFT', 'GIFT'].includes(data.type)) {
          const user = data.user_nick || data.user_id || '사용자';

          message = `${user}님이 ${title}${name}에 별풍선 ${data.gift_count}개 후원했습니다.`;
        }
        else if (['CHALLENGE_SETTLE', 'SETTLE'].includes(data.type)) {
          message = `${title}${name}로 별풍선 ${data.settle_count}개 획득했습니다.`;
        }
        else if (event === 'challenge' && ['SUCCESS', 'FAIL'].includes(data.mission_status)) {
          const result = data.mission_status === 'SUCCESS' ? '성공했습니다.' : '실패했습니다.';

          message = `${title}${name}가 ${result}`;
        }
        else if (event === 'battle' && data.type === 'NOTICE') {
          if (data.draw) {
            message = `${title}${name} 결과 무승부입니다.`;
          }
          else if (data.winner) {
            message = `${title}${name} 승리 팀은 ${data.winner}입니다.`;
          }
        }

        if (message) {
          this.send(event, message);
        }
      });
    }

    const contents = {
      post: '작성',
      edit: '수정',
      clip: '작성',
      catch: '작성',
      remove: '삭제',
      visibility: '공개 설정'
    };

    for (const [event, label] of Object.entries(contents)) {
      this.on(event, data => {
        const type = data.type || (event === 'edit' ? 'post' : event);

        if (!['post', 'clip', 'catch'].includes(type)) {
          return;
        }

        let action = label;

        if (event === 'visibility') {
          action = data.public ? '공개 전환' : '비공개 전환';
        }

        const pictures = type === 'post' ? images(data.content, data.photos) : [];
        const emoticons = type === 'post' ? this.client.findEmoticon?.(preview(data.content)) || [] : [];
        this.send(
          `${type}${event === 'remove' ? 'Delete' : ['edit', 'visibility'].includes(event) ? 'Edit' : 'Create'}`,
          [data.title || '제목 없음',
            type === 'post' && ['post', 'edit'].includes(event) ? preview(data.content) : '']
            .filter(Boolean).join('\n'),
          1000,
          `${CONTENTS[type]} ${action}`,
          data.url, undefined, type === 'post'
            ? { ...data, imageUrl: pictures[0] || emoticons[0]?.url,
              images: pictures, emoticons, stickers: stickers(data.content) } : data
        );
      });
    }

    for (const [event, action] of Object.entries({ comment: '작성', update: '수정', delete: '삭제' })) {
      this.on(event, data => {
        const type = data.contentType || 'post';
        if (!['post', 'clip', 'catch'].includes(type)) return;
        const kind = data.parentCommentNo ? '답글' : '댓글';
        this.send(`${type}${event === 'delete' ? 'Delete' : event === 'update' ? 'Edit' : 'Create'}`,
          [data.title || '제목 없음', preview(data.message)].filter(Boolean).join('\n'), 1000,
          `${CONTENTS[type]} ${kind} ${action}`, data.url, undefined, data);
      });
    }

    for (const event of ['like', 'unlike']) {
      this.on(event, data => {
        const type = data.contentType || data.type;
        if (!['post', 'clip', 'catch'].includes(type)) return;
        const kind = { comment: ' 댓글', reply: ' 답글' }[data.type] || '';
        const action = event === 'like' ? '좋아요' : '좋아요 취소';
        const message = [data.title || '제목 없음', data.message,
          `${data.before.toLocaleString('ko-KR')} → ${data.likes.toLocaleString('ko-KR')}개`]
          .filter(Boolean).join('\n');
        this.send(`${type}Like`, message, 1000, `${CONTENTS[type]}${kind} ${action}`,
          data.url, undefined, data);
      });
    }

    this.on('dumb', data => {
      const user = data.userNick || data.userId || '사용자';
      const admin = this.actor(data);

      const detail = data.count > 2
        ? `채팅 금지 횟수 초과로 ${data.count}초 동안 채팅과 방송 화면이 제한됩니다.`
        : `${data.time}초 동안 채팅할 수 없습니다. (누적 ${data.count}회)`;
      this.send('mute', `${user}님이 채팅 금지되었습니다.\n${detail}\n처리자: ${admin}`
        + this.moderation(data), 1000, undefined, undefined, undefined, data);
    });
    this.on('quit', data => {
      const author = { ...data, userId: client.userId, userNick: client.info?.LOGIN_NICK };
      this.send('quit', `강제 퇴장되었습니다.\n처리자: ${this.actor(data)}`
        + `\n누적 ${data.count}회` + this.moderation(author),
      1000, undefined, undefined, undefined, author);
    });
    this.on('chuser', data => {
      if (data.type === -1 && data.user.exit !== 1) {
        this.send('quit', `${data.user.name || data.user.id}님이 강제 퇴장되었습니다.`
          + this.moderation({ ...data, userId: data.user.id }),
        1000, undefined, undefined, undefined, { ...data.user, userId: data.user.id, userNick: data.user.name });
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

        if (Number(data.chat_rule_display) > 0 && data.chat_rule?.trim()) {
          this.send('rule', data.chat_rule);
        }
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
        const recipient = data.toNick || data.receivedName || data.toId || data.receivedId;
        const gift = ['quickview', 'subscription', 'ogqGift'].includes(event);
        const kind = event === 'quickview'
          ? data.item?.name || (data.item?.plus ? '퀵뷰 플러스' : name) : name;
        const count = data.count ?? data.month;
        const amount = count == null ? '' : ` ${count}${data.month != null ? '개월' : '개'}`;
        let detail = `${kind}${amount}`;

        if (event === 'quickview' && data.item?.days != null) {
          detail = `${kind} ${data.item.days}일권`;
        } else if (event === 'subscription') {
          detail = data.item?.label || `${data.tierName || ''} 구독권`.trim();
        } else if (event === 'followEffect' && data.accMonth > 0) {
          detail += ` (누적 ${data.accMonth}개월)`;
        }

        const label = gift
          ? `${event === 'ogqGift' ? kind : `${kind} 선물`}${recipient ? ` (${recipient})` : ''}`
          : ['follow', 'followEffect', 'subCeremony'].includes(event)
            ? `${kind}${data.month > 0 ? ` ${data.month}개월` : ''}`
            : event === 'missionSettle' ? kind : `${kind} 후원`;
        const title = data.title ? ` (${data.title})` : '';

        const message = gift
          ? `${user}님이 ${recipient ? `${recipient}님에게 ` : ''}${detail}${title}을 선물했습니다.`
          : `${user}: ${detail}${title}`;

        this.support(data, message, label, gift);
      });
    }
  }

  on(event, handler) {
    this.events.set(event, handler);
    this.client.on(event, handler);
  }

  selected(key) {
    const { config } = this.state;

    const result = !this.closed && (this.id === undefined || this.enabled) && config.events[key]
      && (!['error', 'disconnect'].includes(key) || !this.inactive())
      && (this.id === undefined || config.events.multi && !['start', 'rule'].includes(key));

    return result;
  }

  inactive(id = this.client.bjId, number = this.client.channel?.BNO) {
    const stream = this.state.streams.get(id);

    return stream?.live === false
      && (!number || !stream.number || String(stream.number) === String(number));
  }

  accepts(service) {
    const result = (this.id === undefined || this.enabled) && !this.closed
      && (this.id === undefined || this.state.config.events.multi)
      && PACKETS.has(service);

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

  moderation(data) {
    const id = String(data.userId || '').replace(/\(\d+\)$/, '');
    const recent = this.messages.get(id);
    const lines = [];
    if (data.reason) lines.push(`사유: ${data.reason}`);
    if (recent) {
      const time = new Date(recent.time).toLocaleTimeString('ko-KR', { hour12: false });
      lines.push(`최근 채팅 (${time}): ${recent.message}`);
    }
    else if (!data.reason) lines.push('최근 채팅 기록이 없습니다.');
    return `\n${lines.join('\n')}`;
  }

  chat(data, manager = false) {
    const message = String(data.message || '');

    if (!manager && message.trim() && data.userId) {
      const user = String(data.userId).replace(/\(\d+\)$/, '');
      this.messages.delete(user);
      this.messages.set(user, { message, time: Date.now() });
      if (this.messages.size > 5000) this.messages.delete(this.messages.keys().next().value);

      for (const item of this.supports) {
        if (item.user === user) {
          this.finishSupport(item, message);
        }
      }
    }

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
    const streamer = data.isBJ || data.userId === this.client.bjId;
    const labels = [
      !manager && streamer && this.selected('streamer') && '스트리머 채팅',
      manager && streamer && this.selected('manager') && '매니저 채팅',
      matches(config.keywords) && this.selected('keyword') && '키워드',
      !own && matches(names) && this.selected('mention') && '닉네임 언급'
    ].filter(Boolean);

    if (labels.length) {
      this.send(
        'chat',
        data.imageUrl ? `${data.userNick || data.userId}` : `${data.userNick || data.userId}: ${message}`,
        1000,
        labels.join(', '), undefined, undefined, data
      );
    }
  }

  support(data, message, label, gift = false) {
    const key = gift ? 'gift' : 'support';
    if (!this.selected(key)) {
      return;
    }

    const user = data.userId || data.fromId;
    const author = { ...data, gift };
    const text = String(data.message || '').trim();

    if (!user || text) {
      this.send(key, text ? `${message}\n${text}` : message, 1000, label, undefined, undefined, author);
      return;
    }

    if (this.supports.size >= 100) {
      this.finishSupport(this.supports.values().next().value);
    }

    const item = {
      user: String(user).replace(/\(\d+\)$/, ''), message, label, author, key,
      bjId: this.client.bjId, number: this.client.channel?.BNO
    };

    this.supports.add(item);
    item.timer = setTimeout(() => this.finishSupport(item), 10000);
    item.timer.unref();
  }

  finishSupport(item, message = '') {
    clearTimeout(item.timer);

    if (!this.supports.delete(item) || this.closed
      || item.bjId !== this.client.bjId || item.number !== this.client.channel?.BNO) {
      return;
    }

    this.send(item.key || (item.author?.gift ? 'gift' : 'support'),
      message ? `${item.message}\n${message}` : item.message, 1000, item.label, undefined, undefined, item.author);
  }

  actor(data) {
    let id = data.adminId;
    let user = this.client.userList?.get(id);

    if (!id && data.adminNick) {
      const matches = [...(this.client.userList || [])].filter(([, item]) => item.name === data.adminNick);
      if (matches.length === 1) {
        [id, user] = matches[0];
      }
    }

    const name = data.adminNick || user?.name;
    return name && id ? `${name}(${id})` : name || id || '운영자';
  }

  clearSupports() {
    for (const item of this.supports) {
      clearTimeout(item.timer);
    }
    this.supports.clear();
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

  inbox(action, entry) {
    return inbox(this.client, this.file, action, entry);
  }

  send(key, message, cooldown = 1000, label, url, complete, author) {
    const selected = key === 'chat'
      ? ['keyword', 'mention', 'streamer', 'manager'].some(key => this.selected(key))
      : this.selected(key);

    if (!selected) {
      return;
    }

    const config = this.state.config;

    if (this.id === undefined && this.enabled) {
      const id = String(author?.userId || author?.fromId || this.client.bjId || '').replace(/\(\d+\)$/, '');
      this.inbox('add', {
        kind: key === 'chat' ? '채팅' : EVENTS[key]?.[0] || '연결',
        label: label || EVENTS[key]?.[1] || '알림',
        message: String(message || '변경되었습니다.').slice(0, 1000),
        userId: id,
        nickname: author?.userNick || author?.fromNick || this.client.bjNick || id,
        image: author?.profileImage || '',
        sticker: author?.imageUrl || '',
        stickers: author?.stickers,
        images: author?.images,
        emoticons: author?.emoticons,
        url,
        user: { id, name: author?.userNick || author?.fromNick || this.client.bjNick || id,
          role: author?.role, tier: author?.gift ? undefined : author?.tier,
          tierName: author?.gift ? undefined : author?.tierName,
          month: author?.gift ? undefined : author?.month, total: author?.gift ? undefined : author?.accMonth },
        cooldown
      });
    }

    if (!this.enabled || !resolve(config.topic) && !push.connected(this.client, this.file)) {
      return;
    }

    const name = this.client.bjNick || this.client.bjId;
    const signature =
      `${this.client.bjId}:${this.client.channel?.BNO}:${key}:${label || ''}:`
      + `${message}:${url || ''}:${author?.imageUrl || ''}`;
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

    if (this.state.queue.length >= 100 && key !== 'call') {
      log.warn('[알림]', '전송 대기 한도 초과');
      return;
    }

    let priority = 3;

    if (key === 'call') {
      priority = 5;
    }
    else if (['quit', 'disconnect', 'error'].includes(key)) {
      priority = 4;
    }

    const item = {
      owner: this,
      key,
      bjId: this.client.bjId,
      number: this.client.channel?.BNO,
      complete,
      recipient: { bjId: this.client.bjId, info: { ...this.client.info } },
      file: this.file,
      message: {
        title: `[${name}] ${label || EVENTS[key][1]}`,
        message: String(message || '변경되었습니다.').slice(0, 1000),
        click: (key.startsWith('post') || key === 'start') && url ? url : this.address(),
        tags: ['SOOP'],
        image: author?.imageUrl,
        attach: author?.imageUrl?.replace(/\.webp$/, '.png'),
        time: now,
        kind: key,
        priority
      }
    };

    if (key === 'call') {
      if (this.state.queue.length >= 100) {
        const removed = this.state.queue.pop();
        removed.complete?.(false);
      }

      this.state.queue.unshift(item);
    }
    else {
      this.state.queue.push(item);
    }

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
          item.owner.closed || item.owner.state !== store || !item.owner.enabled
          || !item.recipient || item.recipient.info?.LOGIN_ID !== item.owner.client.info?.LOGIN_ID
          || item.owner.id !== undefined && !store.config.events.multi
          || item.key !== 'chat' && !item.owner.selected(item.key)
          || ['error', 'disconnect'].includes(item.key) && item.owner.inactive(item.bjId, item.number)
        ) {
          item.complete?.(false);

          continue;
        }

        store.sending = item.owner;
        store.controller = new AbortController();

        try {
          const config = store.config;
          const deliveries = [push.publish(item.recipient, item.file, item.message)];

          if (resolve(config.topic)) {
            deliveries.push(ntfy.publish({
              server: resolve(config.server),
              topic: resolve(config.topic),
              token: resolve(config.token)
            }, item.message, store.controller.signal).then(() => true).catch(error => {
              if (!store.controller?.signal.aborted) {
                log.warn('[알림]', `ntfy 전송 실패: ${error.message}`);
              }

              return false;
            }));
          }

          const results = await Promise.allSettled(deliveries);
          if (results.some(result => result.status === 'rejected')) {
            log.warn('[알림]', '기기 알림 전송 실패: 등록 정보를 확인하세요.');
          }

          const sent = results.some(result => result.status === 'fulfilled' && result.value);
          item.complete?.(sent);
        } catch {
          item.complete?.(false);
          if (!store.controller.signal.aborted) {
            log.warn('[알림]', '알림 전송 실패');
          }
        } finally {
          store.controller = null;
          store.sending = null;
        }
      }
    }).finally(() => {
      store.pending = null;

      if (store.queue.length) {
        const owner = store.queue[0].owner;

        owner.drain();
      }
    });
  }

  select() {
    this.clearSupports();
    if (!this.client.bjId) {
      return;
    }

    const previous = this.state;

    this.pollController?.abort();
    this.rule = null;
    this.nickname = '';
    previous.clients.delete(this);
    previous.queue = previous.queue.filter(item => {
      if (item.owner !== this) {
        return true;
      }

      item.complete?.(false);
      return false;
    });

    if (previous.sending === this) {
      previous.controller?.abort();
    }

    this.file = settingsFile('notifications', this.client.bjId, !this.file, this.options.file);
    this.state = state(this.file);
    this.state.editor = this.options.editor || previous.editor;
    this.state.clients.add(this);
  }

  command(input) {
    const [name, ...args] = input.trim().split(/\s+/);

    if (name !== '/알림') {
      return false;
    }

    const action = args.at(-1);
    const config = { ...this.state.config, enabled: this.enabled };

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
        next.events[key] = key === 'call' || action === '켜기';
      }
      else {
        next.enabled = action === '켜기';
      }

      this.save(next);
    }
    else if (args.length && !(args.length === 1 && args[0] === '목록')) {
      throw new Error('사용법: /알림 [항목] 켜기|끄기 또는 /알림 목록|다시읽기');
    }

    if (args.length && args[0] === '다시읽기') {
      this.apply(this.state.config);
    }
    const current = this.state.config;
    const enabled = this.enabled ? '켜짐' : '꺼짐';
    const topic = resolve(current.topic) ? '토픽 설정 됨' : '토픽 미설정';
    const rows = Object.entries(EVENTS).filter(([key]) => key !== 'call').map(([key, [group, name]]) => [
      key,
      { 분류: group, 항목: name, 상태: current.events[key] ? '켜짐' : '꺼짐' }
    ]);

    log.info('[알림]', enabled, topic);
    log.table(Object.fromEntries(rows));

    return true;
  }

  async close() {
    this.closed = true;
    this.clearSupports();
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
