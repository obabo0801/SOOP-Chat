import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { checkFlag, userInfo, SUBTITLE_LANG } from '#soop/handler';
import * as time from '#utils/time';

const gifts = {
  balloon: '별풍선',
  adcon: '애드벌룬',
  videoBalloon: '영상 별풍선',
  vodBalloon: 'VOD 별풍선',
  vodAdcon: 'VOD 애드벌룬',
  stationAdcon: '방송국 애드벌룬',
  sticker: '스티커',
  quickview: '퀵뷰 선물',
  subscription: '구독권 선물',
  follow: '구독',
  followEffect: '연속 구독',
  subCeremony: '구독 갱신',
  ogqGift: 'OGQ 선물',
  challenge: '도전미션',
  battle: '대결미션',
  missionSettle: '미션 정산'
};

export class Chat {
  constructor(client, options = {}) {
    this.client = client;
    this.directory = path.resolve(options.directory || 'logs');
    this.events = new Map();
    this.users = new Map();
    this.pages = new Set();
    this.closed = false;
    this.flag = null;
    this.poll = client.poll?.status === 1 ? client.poll : null;

    this.on('chat', data => this.add('chat', data));
    this.on('managerChat', data => {
      if (this.state().manager) {
        this.add('manager', data);
      }
    });
    this.on('ogq', data => this.add('ogq', data));
    this.on('subtitle', data => this.add('subtitle', data));
    this.on('system', data => this.add('system', { message: data.message || data }));
    this.on('live', data => {
      const messages = {
        0: '방송 연결을 기다립니다.',
        2: '방송 비밀번호가 필요합니다.',
        3: '방송이 오프라인입니다.'
      };

      if (messages[data.code] || data.message) {
        this.system(data.message || messages[data.code]);
      }
    });
    this.on('join', () => {
      this.flag = null;
      this.users.clear();
      this.system('방송에 연결되었습니다.');
      this.broadcast('state', this.state());
    });
    this.on('close', () => {
      this.poll = null;
      this.system('방송 연결이 종료되었습니다.');
      this.broadcast('state', this.state());
    });
    this.on('rule', () => this.broadcast('state', this.state()));
    this.on('notice', data => {
      this.client.notice = data;

      if (data.state > 0 && data.message) {
        this.add('notice', { message: data.message });
      }
      else if (data.state === 0) {
        this.add('notice', { message: '공지가 삭제되었습니다.' });
      }

      this.broadcast('state', this.state());
    });
    this.on('userExtend', data => {
      const user = this.user({ userId: data.id, ...data });

      this.users.set(user.id, data);
      this.broadcast('user', user);
    });
    for (const event of ['userFlag', 'subBj']) {
      this.on(event, data => {
        if (data.userId === this.client.userId && data.flag) {
          this.flag = `${data.flag.flag1}|${data.flag.flag2}`;
          this.broadcast('state', this.state());
        }

        if (event === 'userFlag' && data.flag) {
          const action = data.flag.isBlock ? '거부' : '허용';

          this.add('system', {
            ...data,
            userFlag: `${data.flag.flag1}|${data.flag.flag2}`,
            message: `님이 귓속말을 ${action}했습니다.`
          });
        }

        if (event === 'subBj' && data.flag) {
          const message = data.flag.isManager
            ? '님이 매니저가 되셨습니다.'
            : '님이 매니저에서 해임되셨습니다.';

          this.add('system', {
            ...data,
            userFlag: `${data.flag.flag1}|${data.flag.flag2}`,
            message
          });
        }
      });
    }
    this.on('dumb', data => {
      this.add('system', { ...data, message: '님이 채팅 금지되었습니다.' });
    });
    this.on('chuser', data => {
      if (!data.user) {
        return;
      }

      let message;

      if (data.type === 1) {
        message = '님이 대화방에 참여했습니다.';
      }
      else if (data.type === -1 && data.user.exit === 1) {
        message = '님이 대화방에서 나가셨습니다.';
      }
      else if (data.type === -1 && Number.isInteger(data.user.exit)) {
        message = '님이 강제 퇴장되었습니다.';
      }
      else {
        return;
      }

      this.add('system', {
        userId: data.user.id,
        userNick: data.user.name,
        userFlag: data.user.flag,
        role: data.user.role,
        tier: data.user.tier,
        subMonth: data.user.fw,
        accMonth: data.user.afw,
        message
      });
    });

    this.on('nickName', data => {
      this.add('system', {
        ...data,
        userNick: data.oldNick,
        userFlag: `${data.userFlag?.flag1 || 0}|${data.userFlag?.flag2 || 0}`,
        message: `님이 닉네임을 ${data.newNick}(으)로 변경했습니다.`
      });
    });
    for (const [event, label] of [
      ['title', '제목'],
      ['category', '카테고리'],
      ['hashtag', '태그']
    ]) {
      this.on(event, data => {
        const before = data.prev || '없음';
        const after = data[event] || '없음';

        this.system(`${label} 변경: ${before} → ${after}`);
      });
    }
    this.on('iceMode', data => {
      const message = data.index === 0 ? '채팅을 녹였습니다.' : '채팅을 얼렸습니다.';

      this.system(message);
    });
    this.on('slowMode', data => {
      let message = '저속 모드가 해제되었습니다.';

      if (data.count > 0) {
        message = `저속 모드: ${data.count}초 간격으로 채팅할 수 있습니다.`;
      }

      this.system(message);
    });
    this.on('adminNotice', data => {
      if (data.message) {
        this.system(`[SOOP 안내] ${data.message}`);
      }
    });
    this.on('banWord', data => {
      const words = (data.after || []).filter(Boolean);

      if (!words.length) {
        return;
      }

      const message = `[금칙어] ${words.join(', ')}`;

      this.system(message);
    });
    this.on('kickCancel', data => {
      const message =
        data.type === 0
          ? '님이 강제 퇴장되었습니다.'
          : '님의 강제 퇴장이 취소되었습니다.';

      this.add('system', { ...data, message });
    });
    this.on('poll', data => {
      this.poll = data.status === 1 ? data : null;
      this.broadcast('state', this.state());

      const messages = {
        1: '투표가 시작되었습니다.',
        2: '투표가 종료되었습니다.',
        3: '투표가 마감되었습니다.',
        4: '투표 결과가 공개되었습니다.'
      };

      if (messages[data.status]) {
        this.system(messages[data.status]);
      }
    });
    this.on('quit', data => {
      let actor = data.adminNick || '운영자';

      if (data.type === 1) {
        actor = '스트리머';
      }
      else if (data.type === 2) {
        actor = '매니저';
      }

      this.system(`${actor}에 의해 강제 퇴장되었습니다.`);
    });

    for (const event of Object.keys(gifts)) {
      this.on(event, data => this.gift(event, data));
    }
  }

  on(event, handler) {
    this.events.set(event, handler);
    this.client.on(event, handler);
  }

  state() {
    const flag = checkFlag(this.flag || this.client.userFlag);
    const login = this.client.info?.IS_LOGIN === 1;
    const connected = Boolean(this.client.isOpen?.());
    const manager =
      login && (flag.isBJ || flag.isManager || flag.isAdmin || flag.isAdminChat);
    const rule = this.client.rule;
    const notice = this.client.notice;

    return {
      login,
      connected,
      manager,
      streamer: login && flag.isBJ,
      rule: rule?.chat_rule_display > 0 ? rule.chat_rule || '' : '',
      notice: notice?.state > 0 ? notice.message || '' : '',
      bjId: this.client.bjId || '',
      poll: this.poll,
      subtitle: this.client.subtitle,
      languages: SUBTITLE_LANG
    };
  }

  user(data = {}) {
    const id = String(data.userId || data.fromId || '');
    const current = this.client.userList?.get(id) || {};
    const flag = data.userFlag || current.flag;
    const info = userInfo(this.client, flag);
    const tier = data.tier ?? info.tier;
    const month = Number(data.subMonth ?? data.fw ?? current.fw ?? data.month) || 0;
    const total = Number(data.accMonth ?? data.afw ?? current.afw ?? month) || 0;

    return {
      id,
      name: String(data.userNick || data.fromNick || current.name || id),
      role: data.role || info.role,
      tier,
      tierName: data.tierName || info.tierName,
      month,
      total,
      tierUrl: tier ? this.client.makeTierUrl?.(tier, month) || '' : ''
    };
  }

  add(type, data = {}) {
    if (this.closed || data.test || !this.client.bjId) {
      return;
    }

    const entry = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      type,
      user: this.user(data),
      message: String(data.message || ''),
      image: data.imageUrl || '',
      ogq: data.ogqId || '',
      emoticons: this.client.findEmoticon?.(data.message || '') || []
    };
    const folder = path.join(this.directory, time.getDate());
    const file = path.join(folder, this.filename());

    try {
      fs.mkdirSync(folder, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch (error) {
      this.client.emit('error', error);
    }

    this.broadcast('chat', entry);

    return entry;
  }

  system(message) {
    return this.add('system', { message });
  }

  gift(event, data) {
    if (!data || data.test) {
      return;
    }

    const name = data.userNick || data.user_nick || data.fromNick || '';
    const count =
      Number(
        data.count
          ?? data.gift_count
          ?? data.settle_count
          ?? data.total_count
          ?? data.month
      ) || 0;
    let message = `${name}님 ${gifts[event]} ${count}개`;

    if (['follow', 'followEffect', 'subCeremony'].includes(event)) {
      message = `${name}님 ${gifts[event]} ${data.month || 0}개월`;
    }
    else if (['quickview', 'subscription'].includes(event)) {
      message = `${name}님이 ${data.toNick || ''}님에게 ${gifts[event]}`;
    }
    else if (event === 'challenge' || event === 'battle') {
      message = `[${data.title || gifts[event]}] ${gifts[event]} ${count}개`;
    }
    else if (event === 'missionSettle') {
      const total = (data.list || []).reduce(
        (sum, item) => sum + Number(item[2] || 0),
        0
      );

      message = `미션 정산 ${total}개`;
    }

    this.add('gift', {
      ...data,
      userId: data.userId || data.user_id,
      userNick: name,
      message
    });
  }

  subscription(entry) {
    const user = entry.user;
    const current = this.client.userList?.get(user?.id) || this.users.get(user?.id);

    if (!user?.tier || user.month || !current?.fw) {
      return;
    }

    user.month = current.fw;
    user.total = current.afw || current.fw;
    user.tierUrl = this.client.makeTierUrl?.(user.tier, user.month) || '';
  }

  filename() {
    const id = encodeURIComponent(this.client.bjId);

    return `chat-${id}.log`;
  }

  history(cursor = '', user = '', type = '') {
    if (type && type !== 'manager') {
      throw new Error('채팅 종류 오류');
    }

    if (type === 'manager' && !this.state().manager) {
      throw new Error('매니저 권한 필요');
    }

    const matches = entry => {
      const privateChat = entry.type === 'manager';
      const selected = type === 'manager' ? privateChat : !privateChat;

      return selected && (!user || entry.user?.id === user);
    };
    let before;

    if (cursor) {
      try {
        before = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      } catch {
        throw new Error('기록 위치 오류');
      }

      const valid = before && /^\d{4}-\d{2}-\d{2}$/.test(before.date);

      if (!valid || !Number.isSafeInteger(before.offset) || before.offset < 0) {
        throw new Error('기록 위치 오류');
      }
    }

    const entries = [];
    const dates = fs.existsSync(this.directory)
      ? fs.readdirSync(this.directory).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
      : [];
    let scanned = 0;

    for (const date of dates.sort().reverse()) {
      if (before && date > before.date) {
        continue;
      }

      const file = path.join(this.directory, date, this.filename());

      if (!fs.existsSync(file)) {
        continue;
      }

      const fd = fs.openSync(file, 'r');
      let offset = fs.fstatSync(fd).size;
      let remainder = Buffer.alloc(0);

      if (before?.date === date) {
        offset = Math.min(offset, before.offset);
      }

      try {
        while (offset > 0) {
          const size = Math.min(offset, 65536);
          const buffer = Buffer.alloc(size);

          offset -= size;
          fs.readSync(fd, buffer, 0, size, offset);
          scanned += size;

          const content = Buffer.concat([buffer, remainder]);
          let end = content.length;

          for (let index = content.length - 1; index >= 0; index--) {
            if (content[index] !== 10) {
              continue;
            }

            const line = content.subarray(index + 1, end).toString('utf8');

            end = index;

            if (line) {
              try {
                const entry = JSON.parse(line);

                if (matches(entry)) {
                  this.subscription(entry);
                  entries.push(entry);
                }
              } catch {}
            }

            if (entries.length >= 100 || scanned >= 1048576) {
              const next = Buffer.from(
                JSON.stringify({ date, offset: offset + index + 1 })
              ).toString('base64url');

              return { entries: entries.reverse(), cursor: next };
            }
          }

          remainder = content.subarray(0, end);
        }

        if (remainder.length) {
          try {
            const entry = JSON.parse(remainder.toString('utf8'));

            if (matches(entry)) {
              this.subscription(entry);
              entries.push(entry);
            }
          } catch {}
        }
      } finally {
        fs.closeSync(fd);
      }
    }

    return { entries: entries.reverse(), cursor: '' };
  }

  broadcast(event, data) {
    for (const page of this.pages) {
      if (!page.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
        page.destroy();
      }
    }
  }

  listen(response) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`event: state\ndata: ${JSON.stringify(this.state())}\n\n`);
    this.pages.add(response);

    const timer = setInterval(() => {
      response.write(`event: state\ndata: ${JSON.stringify(this.state())}\n\n`);
    }, 5000);

    timer.unref();
    response.once('close', () => {
      clearInterval(timer);
      this.pages.delete(response);
    });
  }

  async action(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('채팅 요청 오류');
    }

    const state = this.state();
    const target = String(data.target || '');

    if (data.action === 'subtitle') {
      const valid =
        Number.isInteger(data.index) && Object.hasOwn(SUBTITLE_LANG, data.index);

      if (!state.connected || !valid) {
        throw new Error('자막 설정 오류');
      }

      if (!this.client.sendSubtitle(data.index)) {
        throw new Error('자막 설정 실패');
      }

      this.client.subtitle = data.index;
      this.broadcast('state', this.state());

      return;
    }

    if (!state.login) {
      throw new Error('로그인이 필요합니다.');
    }

    if (!state.connected) {
      throw new Error('방송 연결 없음');
    }

    if (data.action === 'send') {
      const message = String(data.message || '');

      if ((!message.trim() && !data.ogq) || message.length > 2000) {
        throw new Error('채팅 내용 오류');
      }

      if (data.ogq) {
        const index = this.client.ogq?.data?.findIndex(item => item.ogq_id === data.ogq);
        const pack = this.client.findOgq(index);
        const valid = Number.isSafeInteger(data.number) && data.number > 0;

        if (target || !pack || !valid || data.number > pack.max) {
          throw new Error('OGQ 선택 오류');
        }

        const result = await this.client.sendOgq(message, pack.id, data.number);

        if (Number(result?.code) !== 1) {
          throw new Error('OGQ 전송 실패');
        }

        return;
      }

      const result = target
        ? this.client.sendDirectChat(message, target)
        : this.client.sendChat(message);

      if (!result) {
        throw new Error('채팅 전송 실패');
      }

      return;
    }

    if (!state.manager) {
      throw new Error('매니저 권한 필요');
    }

    if (data.action === 'manager') {
      const message = String(data.message || '');

      if (!message.trim() || message.length > 2000) {
        throw new Error('채팅 내용 오류');
      }

      if (!this.client.sendManagerChat(message)) {
        throw new Error('채팅 전송 실패');
      }

      return;
    }

    if (!target || target.length > 100) {
      throw new Error('대상 아이디 오류');
    }

    let result;

    switch (data.action) {
      case 'mute':
        result = this.client.sendDumb(target, '채팅금지');
        break;
      case 'kick':
        result = this.client.sendKick(target, 0, '강퇴');
        break;
      case 'black':
        result = this.client.sendBlack(target, this.client.userId);
        break;
      case 'dismiss':
        if (!state.streamer) {
          throw new Error('스트리머 권한 필요');
        }

        result = this.client.sendSubBj(target, 0);
        break;
      default:
        throw new Error('채팅 명령 오류');
    }

    if (!result) {
      throw new Error('채팅 명령 실패');
    }
  }

  close() {
    this.closed = true;

    for (const [event, handler] of this.events) {
      this.client.off(event, handler);
    }

    for (const page of this.pages) {
      page.end();
    }

    this.pages.clear();
  }
}
