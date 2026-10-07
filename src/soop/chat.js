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
    this.kicked = new Map();
    this.pages = new Set();
    this.requests = new Set();
    this.closed = false;
    this.flag = null;
    this.slow = 0;
    this.frozen = Boolean(client.iceMode);
    this.ice = { auth: [true, false, false, false, false, true], count: 1, date: 1 };
    this.poll = [1, 3, 4].includes(client.poll?.status) ? client.poll : null;

    this.on('chat', data => this.add('chat', data));
    this.on('managerChat', data => {
      if (this.state().manager) {
        this.add('manager', data);
      }
    });
    this.on('ogq', data => this.add('ogq', data));
    this.on('subtitle', data => this.add('subtitle', data));
    this.on('system', data => this.add('system', { message: data.message || data }));
    this.on('error', error => {
      this.add('error', { message: error?.message || String(error) });
    });
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
      this.slow = 0;
      this.frozen = false;
      this.users.clear();
      this.kicked.clear();
      this.system('방송에 연결되었습니다.');
      this.broadcast('state', this.state());
      void this.kicks().catch(() => {});
    });
    this.on('close', () => {
      this.poll = null;
      this.system('방송 연결이 종료되었습니다.');
      this.broadcast('state', this.state());
    });
    this.on('rule', () => this.broadcast('state', this.state()));
    this.on('viewer', () => this.broadcast('state', this.state()));
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

        if (data.flag) {
          const flag = `${data.flag.flag1}|${data.flag.flag2}`;
          const cached = this.users.get(data.userId) || {};

          this.users.set(data.userId, { ...cached, flag });
          this.broadcast('user', this.user({ ...data, userFlag: flag }));
        }

        if (event === 'subBj' && data.flag) {
          const message = data.flag.isManager
            ? '님이 매니저가 되셨습니다.'
            : '님이 매니저에서 해임되셨습니다.';

          this.add('system', {
            ...data,
            userFlag: `${data.flag.flag1}|${data.flag.flag2}`,
            role: '매니저',
            message
          });
        }
      });
    }
    this.on('dumb', data => {
      const count = Number(data.count);
      const valid = Number.isInteger(count) && count >= 0;
      const actor = this.actor(data);
      let message = '님이 채팅 금지되었습니다.';

      if (valid) {
        message = `님이 ${count}회 채팅 금지되었습니다.`;
      }

      if (valid && count >= 4) {
        message =
          '님이 채팅금지 횟수 초과로 블라인드 처리 되었습니다. '
          + '4초 동안 채팅과 방송화면을 볼 수 없습니다.';
      }

      if (actor) {
        message += ` (${actor})`;
      }

      this.add('system', { ...data, message });
    });
    this.on('chuser', data => {
      if (!data.user) {
        return;
      }

      const cached = this.users.get(data.user.id) || {};

      this.users.set(data.user.id, {
        ...cached,
        flag: data.user.flag,
        name: data.user.name
      });

      let message;

      if (data.type === 1) {
        message = '님이 대화방에 참여했습니다.';
      }
      else if (data.type === -1 && data.user.exit === 1) {
        message = '님이 대화방에서 나가셨습니다.';
      }
      else if (data.type === -1 && Number.isInteger(data.user.exit)) {
        void this.kick({
          ...data.user,
          userId: data.user.id,
          userNick: data.user.name,
          userFlag: data.user.flag
        });

        return;
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
      ['title', '방송 제목'],
      ['category', '카테고리'],
      ['hashtag', '태그']
    ]) {
      this.on(event, data => {
        const before = data.prev || '없음';
        const after = data[event] || '없음';

        this.add('system', {
          heading: `${label} 변경`,
          message: `${before} → ${after}`,
          tone: 'broadcast'
        });
      });
    }
    this.on('iceMode', data => {
      const frozen = data.index !== 0;
      const count = data.count > 0 ? data.count : this.ice.count;
      const date = data.date > 0 ? data.date : this.ice.date;
      let auth = this.ice.auth;

      if (data.auth) {
        auth = [
          data.auth.isStreamerAllowed,
          data.auth.isFanClubAllowed,
          data.auth.isSupporterAllowed,
          data.auth.isTopFanAllowed,
          data.auth.isSubscriberAllowed,
          data.auth.isManagerAllowed
        ];
      }

      const grades = auth.some((value, index) => value !== this.ice.auth[index]);
      const details = count !== this.ice.count || date !== this.ice.date;
      let heading = '채팅창을 얼렸습니다.';
      let message = '채팅에 참여 하실 수 있습니다.';

      if (!frozen) {
        heading = '채팅창을 녹였습니다.';
      }
      else {
        if (this.frozen && grades && details) {
          heading = '채팅 참여 등급, 등급 상세설정이 변경되었습니다.';
        }
        else if (this.frozen && grades) {
          heading = '채팅 참여 등급이 변경되었습니다.';
        }
        else if (this.frozen && details) {
          heading = '등급 상세설정이 변경되었습니다.';
        }

        const names = [
          [0, '스트리머'],
          [5, '매니저'],
          [3, '열혈팬'],
          [4, `구독팬(${date}개월↑)`],
          [1, `팬클럽(${count}개↑)`],
          [2, '서포터']
        ];
        const allowed = names.filter(([index]) => auth[index]).map(([, name]) => name);

        message = `${allowed.join(', ')}만 채팅에 참여할 수 있습니다.`;
      }

      this.frozen = frozen;
      this.ice.auth = auth;
      this.ice.count = count;
      this.ice.date = date;

      this.add('system', { heading, message, tone: 'ice' });
      this.broadcast('state', this.state());
    });
    this.on('slowMode', data => {
      this.slow = data.count;

      const heading =
        data.count > 0 ? '저속 모드가 활성화되었습니다.' : '저속 모드가 해제되었습니다.';
      const message =
        data.count > 0 ? `${data.count}초 간격으로 채팅 입력이 가능합니다.` : '';

      this.add('system', { heading, message, tone: 'ice' });
      this.broadcast('state', this.state());
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
    this.on('kickList', list => {
      this.kicked = new Map(list.map(data => [data.userId, data]));
      this.broadcast('state', this.state());

      for (const data of list) {
        this.broadcast(
          'user',
          this.user({
            userId: data.userId,
            userNick: data.userNick
          })
        );
      }
    });
    this.on('kickCancel', data => {
      if (data.type === 0) {
        void this.kick(data);

        return;
      }

      this.kicked.delete(data.userId);
      this.broadcast('state', this.state());
      this.broadcast('user', this.user(data));
      this.add('system', { ...data, message: '님의 강제 퇴장이 취소되었습니다.' });
    });
    this.on('poll', data => {
      this.poll = [1, 3, 4].includes(data.status) ? data : null;
      this.broadcast('state', this.state());

      const messages = {
        1: '현재 투표가 시작되었습니다.',
        2: '현재 투표가 종료되었습니다.',
        3: '현재 투표가 마감되었습니다.',
        4: '현재 투표 결과가 공개되었습니다.'
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

    const viewer = this.client.bridge?.viewer;
    const current = viewer?.broadNo === Number(this.client.channel?.BNO);
    const viewers = current ? viewer.pc + viewer.mobile : null;

    return {
      login,
      connected,
      viewers,
      manager,
      ice: Boolean(this.client.iceMode),
      freezing: this.ice,
      slow: this.slow,
      kicks: this.kicked.size,
      streamer: login && flag.isBJ,
      rule: rule?.chat_rule_display > 0 ? rule.chat_rule || '' : '',
      notice: notice?.state > 0 ? notice.message || '' : '',
      bjId: this.client.bjId || '',
      userId: this.client.userId || this.client.info?.LOGIN_ID || '',
      userName: this.client.info?.LOGIN_NICK || '',
      poll: this.poll,
      subtitle: this.client.subtitle,
      languages: SUBTITLE_LANG
    };
  }

  user(data = {}) {
    const id = String(data.userId || data.fromId || '');
    const current = this.client.userList?.get(id) || {};
    const cached = this.users.get(id) || {};
    const fw = current.fw > 0 ? current.fw : cached.fw;
    const afw = current.afw > 0 ? current.afw : cached.afw;
    const flag = data.userFlag || cached.flag || current.flag;
    const info = userInfo(this.client, flag);
    const tier = data.tier ?? info.tier;
    const month = Number(data.subMonth ?? data.fw ?? data.month ?? fw) || 0;
    const total = Number(data.accMonth ?? data.afw ?? afw ?? month) || 0;

    let name = String(
      data.userNick || data.fromNick || current.name || cached.name || id
    );
    const station = id.replace(/\(\d+\)$/, '');

    if (station === this.client.info?.LOGIN_ID && name === id) {
      name = this.client.info.LOGIN_NICK || name;
    }

    if (station === this.client.bjId && (!name || name === id || name === station)) {
      name = this.client.bjNick || this.client.station?.user_nick || name;
    }

    return {
      id,
      name,
      kicked: this.kicked.has(id),
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

    if (data.heading) {
      entry.heading = data.heading;
    }

    if (data.tone) {
      entry.tone = data.tone;
    }

    if (entry.user.id && entry.user.tier && entry.user.month > 0) {
      this.users.set(entry.user.id, {
        ...this.users.get(entry.user.id),
        fw: entry.user.month,
        afw: entry.user.total
      });
    }

    const folder = path.join(this.directory, time.getDate());
    const file = path.join(folder, this.filename());

    try {
      fs.mkdirSync(folder, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch (error) {
      if (type !== 'error') {
        this.client.emit('error', error);
      }
    }

    this.broadcast('chat', entry);

    return entry;
  }

  actor(data) {
    const user = this.client.userList.get(data.adminId);
    let name = data.adminNick || user?.name || data.adminId || '';

    if (!name && data.adminType) {
      name = data.adminType === 2 ? '매니저' : '스트리머';
    }

    return name;
  }

  async kick(data) {
    if (this.closed || data.test || this.kicked.has(data.userId)) {
      return;
    }

    const user = this.user(data);
    const channel = this.client.bjId;

    this.kicked.set(data.userId, data);
    this.broadcast('state', this.state());
    this.broadcast('user', { ...user, kicked: true });

    let actor = this.actor(data);

    if (!actor) {
      try {
        const list = await this.kicks();
        const entry = list.find(item => item.userId === data.userId);

        if (entry) {
          actor = this.actor(entry);
        }
      } catch {}
    }

    if (this.closed || channel !== this.client.bjId) {
      return;
    }

    let message = '님이 강제 퇴장되었습니다.';

    if (actor) {
      message += ` (${actor})`;
    }

    this.add('system', { ...data, role: user.role, message });
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
    let message = `${gifts[event]} ${count}개`;

    if (['follow', 'followEffect', 'subCeremony'].includes(event)) {
      message = `${gifts[event]} ${data.month || 0}개월`;
    }
    else if (['quickview', 'subscription'].includes(event)) {
      message = `${data.toNick || ''}님에게 ${gifts[event]}`;
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
    const current = this.client.userList?.get(user?.id);
    const cached = this.users.get(user?.id);
    const month = current?.fw > 0 ? current.fw : cached?.fw;
    const total = current?.afw > 0 ? current.afw : cached?.afw;

    if (!user?.tier || user.month > 0 || !month) {
      return;
    }

    user.month = month;
    user.total = total || month;
    user.tierUrl = this.client.makeTierUrl?.(user.tier, user.month) || '';
  }

  filename() {
    const id = encodeURIComponent(this.client.bjId);

    return `chat-${id}.log`;
  }

  search(options = {}) {
    const types = ['all', 'chat', 'manager', 'system', 'gift', 'mute', 'kick'];
    const type = options.type || 'all';
    const text = String(options.text || '')
      .trim()
      .toLowerCase();
    const start = options.start || '';
    const end = options.end || '';

    if (!types.includes(type) || text.length > 200) {
      throw new Error('검색 설정 오류');
    }

    for (const date of [start, end]) {
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('검색 날짜 오류');
      }
    }

    if (start && end && start > end) {
      throw new Error('검색 날짜 오류');
    }

    return this.history(options.cursor || '', '', '', { type, text, start, end });
  }

  history(cursor = '', user = '', type = '', search) {
    if (type && type !== 'manager') {
      throw new Error('채팅 종류 오류');
    }

    if (type === 'manager' && !this.state().manager) {
      throw new Error('매니저 권한 필요');
    }

    const manager = Boolean(search) || this.state().manager;
    const files = [];

    if (!['mute', 'kick'].includes(search?.type)) {
      files.push(this.filename());
    }

    if (manager && (search?.type === 'all' || search?.type === 'mute')) {
      files.push('mute.log');
    }

    if (manager && (search?.type === 'all' || search?.type === 'kick')) {
      files.push('kick.log');
    }

    const normalize = (entry, file, date, offset) => {
      if (file === this.filename()) {
        return entry;
      }

      if (entry.방송 !== this.client.bjId) {
        return null;
      }

      return {
        id: `${file}:${date}:${offset}`,
        date: new Date(entry.날짜.replace(' ', 'T')).toISOString(),
        type: file === 'mute.log' ? 'mute' : 'kick',
        user: { id: entry.대상자아이디, name: entry.대상자 },
        message: entry.채팅 || '',
        actor: entry.처리자,
        actorId: entry.처리자아이디,
        count: entry.횟수,
        duration: entry.시간,
        remarks: entry.비고
      };
    };

    const matches = entry => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }

      const privateChat = entry.type === 'manager';
      const selected = type === 'manager' ? privateChat : !privateChat;

      if (search) {
        if (privateChat && !manager) {
          return false;
        }

        const types = {
          chat: ['chat', 'ogq'],
          system: ['system', 'subtitle', 'notice', 'error']
        };
        const selected = types[search.type] || [search.type];

        if (search.type !== 'all' && !selected.includes(entry.type)) {
          return false;
        }

        const text = [
          entry.user?.id,
          entry.user?.name,
          entry.message,
          entry.heading,
          entry.actor,
          entry.actorId,
          entry.remarks
        ]
          .join('\n')
          .toLowerCase();

        return text.includes(search.text);
      }

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

      if (before.file && !files.includes(before.file)) {
        throw new Error('기록 위치 오류');
      }
    }

    const entries = [];
    const dates = fs.existsSync(this.directory)
      ? fs.readdirSync(this.directory).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
      : [];
    let scanned = 0;

    for (const date of dates.sort().reverse()) {
      if (search) {
        const early = search.start && date < search.start;
        const late = search.end && date > search.end;

        if (early || late) {
          continue;
        }
      }

      if (before && date > before.date) {
        continue;
      }

      for (const name of files) {
        if (
          before?.date === date
          && before.file
          && files.indexOf(name) < files.indexOf(before.file)
        ) {
          continue;
        }

        const file = path.join(this.directory, date, name);

        if (!fs.existsSync(file)) {
          continue;
        }

        const fd = fs.openSync(file, 'r');
        let offset = fs.fstatSync(fd).size;
        let remainder = Buffer.alloc(0);

        if (before?.date === date && (!before.file || before.file === name)) {
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
                  const value = JSON.parse(line);
                  const entry = normalize(value, name, date, offset + index + 1);

                  if (matches(entry)) {
                    this.subscription(entry);
                    entries.push(entry);
                  }
                } catch {}
              }

              if (entries.length >= 100 || scanned >= 1048576) {
                const next = Buffer.from(
                  JSON.stringify({ date, file: name, offset: offset + index + 1 })
                ).toString('base64url');

                return { entries: entries.reverse(), cursor: next };
              }
            }

            remainder = content.subarray(0, end);
          }

          if (remainder.length) {
            try {
              const value = JSON.parse(remainder.toString('utf8'));
              const entry = normalize(value, name, date, 0);

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

  members(query = '', cursor = '') {
    if (typeof query !== 'string' || query.length > 100 || typeof cursor !== 'string') {
      throw new Error('참여자 검색 오류');
    }

    if (this.closed || !this.client.isOpen?.()) {
      return { entries: [], total: 0, matches: 0, cursor: '' };
    }

    const roles = ['스트리머', '매니저', '운영자', '열혈', '팬', '일반'];
    const text = query.trim().toLowerCase();
    const entries = [];

    for (const current of this.client.userList.values()) {
      const user = this.user({ userId: current.id });
      const matched =
        user.name.toLowerCase().includes(text) || user.id.toLowerCase().includes(text);

      if (!matched) {
        continue;
      }

      const role = roles.indexOf(user.role);
      const key = `${role < 0 ? roles.length : role}:${user.id}`;

      entries.push({ key, user });
    }

    entries.sort((left, right) => {
      if (left.key < right.key) {
        return -1;
      }

      return left.key > right.key ? 1 : 0;
    });

    const remaining = entries.filter(entry => entry.key > cursor);
    const page = remaining.slice(0, 50);
    const next = remaining.length > page.length ? page.at(-1).key : '';

    return {
      entries: page.map(entry => entry.user),
      total: this.client.userList.size,
      matches: entries.length,
      cursor: next
    };
  }

  async kicks() {
    const state = this.state();

    if (this.closed || !state.connected) {
      throw new Error('방송 연결 없음');
    }

    const result = new Promise((resolve, reject) => {
      const finish = (error, list) => {
        clearTimeout(timer);
        this.client.off('kickList', receive);
        this.client.off('close', cancel);
        this.client.off('join', cancel);
        this.requests.delete(cancel);

        if (error) {
          reject(error);
        }
        else {
          resolve(list);
        }
      };
      const cancel = () => finish(new Error('방송 연결 변경 됨'));
      const receive = list => finish(null, list);
      const timer = setTimeout(() => {
        finish(new Error('강제 퇴장 인원 요청 실패'));
      }, 5000);

      this.requests.add(cancel);
      this.client.on('kickList', receive);
      this.client.on('close', cancel);
      this.client.on('join', cancel);

      Promise.resolve()
        .then(() => {
          if (!this.requests.has(cancel)) {
            return false;
          }

          return this.client.sendKickList();
        })
        .then(sent => {
          if (!sent) {
            finish(new Error('강제 퇴장 인원 요청 실패'));
          }
        })
        .catch(error => finish(error));
    });

    return result;
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

    if (data.action === 'translate') {
      const message = String(data.message || '').trim();

      if (!message || message.length > 2000 || this.translating) {
        throw new Error('번역 요청 오류');
      }

      this.translating = true;
      this.client.translationPreview = true;

      return new Promise((resolve, reject) => {
        const finish = (error, result) => {
          clearTimeout(timer);
          this.client.off('translation', receive);
          this.client.off('close', cancel);
          this.client.off('join', cancel);
          this.requests.delete(cancel);
          this.translating = false;
          this.client.translationPreview = false;

          if (error) {
            reject(error);
          }
          else {
            resolve({ message: result.message });
          }
        };
        const receive = result => {
          if (result.mode === 2) {
            finish(null, result);
          }
        };
        const cancel = () => finish(new Error('방송 연결 변경 됨'));
        const timer = setTimeout(() => finish(new Error('번역 요청 실패')), 5000);

        this.requests.add(cancel);
        this.client.on('translation', receive);
        this.client.on('close', cancel);
        this.client.on('join', cancel);

        try {
          if (!this.client.sendTranslation(message, 2)) {
            finish(new Error('번역 요청 실패'));
          }
        } catch (error) {
          finish(error);
        }
      });
    }

    if (data.action === 'nickname') {
      if (typeof data.message !== 'string' || data.message.length > 100) {
        throw new Error('닉네임 오류');
      }

      if (!this.client.sendNickName(data.message.trim())) {
        throw new Error('닉네임 변경 실패');
      }

      return;
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

    if (data.action === 'notice' || data.action === 'rule') {
      const rule = data.action === 'rule';

      if (!state.streamer) {
        throw new Error('스트리머 권한 필요');
      }

      if (typeof data.message !== 'string' || data.message.length > 2000) {
        throw new Error('내용 오류');
      }

      const message = data.message.trim();
      const display = message ? 1 : 0;
      const result = rule
        ? await this.client.sendRule(message, display)
        : await this.client.sendNotice(message);
      const code = Number(
        result?.channel?.result ?? result?.RESULT ?? result?.result ?? result?.code
      );

      if (code !== 1) {
        throw new Error(rule ? '규칙 수정 실패' : '공지 수정 실패');
      }

      if (rule) {
        this.client.rule = { chat_rule: message, chat_rule_display: display };
        this.client.emit('rule', this.client.rule);
      }
      else {
        this.client.notice = { message, state: display };
      }

      this.broadcast('state', this.state());

      return;
    }

    if (data.action === 'freeze') {
      if (typeof data.enabled !== 'boolean') {
        throw new Error('얼리기 설정 오류');
      }

      const type = data.enabled ? 'ice_on' : 'ice_off';
      const valid =
        Array.isArray(data.auth)
        && data.auth.length === 6
        && data.auth.every(value => typeof value === 'boolean')
        && data.auth[0];

      if (data.enabled && !valid) {
        throw new Error('등급 설정 오류');
      }

      if (data.enabled && !state.streamer) {
        if (data.auth[5] !== this.ice.auth[5]) {
          throw new Error('매니저 등급 변경은 스트리머 권한 필요');
        }

        const count = data.count ?? this.ice.count;
        const date = data.date ?? this.ice.date;

        if (count !== this.ice.count || date !== this.ice.date) {
          throw new Error('스트리머 권한 필요');
        }
      }

      if (data.enabled && state.streamer) {
        if (!Number.isSafeInteger(data.count) || data.count < 1 || data.count > 10000) {
          throw new Error('개수 설정 오류');
        }

        const date = data.date ?? 1;

        if (!Number.isSafeInteger(date) || date < 1) {
          throw new Error('구독 개월 오류');
        }

        const options = await this.client.sendIceOption(data.count, date);

        if (Number(options?.result) !== 1) {
          throw new Error('개수 설정 실패');
        }
      }

      const auth = data.enabled
        ? data.auth.map(value => (value ? '1' : '0')).join('')
        : 0;
      const result = await this.client.sendIceMode(type, auth);

      if (Number(result?.result) !== 1) {
        throw new Error('얼리기 설정 실패');
      }

      return;
    }

    if (data.action === 'slow') {
      if (!Number.isSafeInteger(data.count) || data.count < 0) {
        throw new Error('저속 모드 설정 오류');
      }

      if (!this.client.sendSlowMode(data.count)) {
        throw new Error('저속 모드 설정 실패');
      }

      return;
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

    const own = target.replace(/\(\d+\)$/, '');
    const current = String(this.client.userId || '').replace(/\(\d+\)$/, '');

    if (own === current || own === this.client.bjId) {
      throw new Error('본인에게 사용할 수 없습니다.');
    }

    let result;

    switch (data.action) {
      case 'mute':
        result = this.client.sendDumb(target, '채팅금지');
        break;
      case 'kick':
        result = this.client.sendKick(target, 0, '강퇴');
        break;
      case 'cancel':
        result = this.client.sendKick(target, 1);
        break;
      case 'black':
        result = this.client.sendBlack(target, this.client.bjId);
        break;
      case 'appoint':
      case 'dismiss':
        if (!state.streamer) {
          throw new Error('스트리머 권한 필요');
        }

        result = this.client.sendSubBj(target, data.action === 'appoint' ? 1 : 0);
        break;
      default:
        throw new Error('채팅 명령 오류');
    }

    result = await result;

    if (!result) {
      throw new Error('채팅 명령 실패');
    }

    if (data.action === 'black') {
      this.add('system', {
        userId: target,
        message: '님이 블랙리스트에 추가되었습니다.'
      });
    }
  }

  close() {
    this.closed = true;

    for (const cancel of this.requests) {
      cancel();
    }

    for (const [event, handler] of this.events) {
      this.client.off(event, handler);
    }

    for (const page of this.pages) {
      page.end();
    }

    this.pages.clear();
  }
}
