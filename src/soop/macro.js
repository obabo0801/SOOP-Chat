import fs from 'fs';
import path from 'path';
import { SoopHistory } from '#soop/history';
import { checkFlag } from '#soop/handler';
import * as weflab from '#utils/weflab';

const EVENTS = {
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
  challenge: '도전미션',
  battle: '대결미션',
  missionSettle: '미션 정산'
};

export class SoopMacro {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.file =
      options.file === false ? null : path.resolve(options.file || 'macros.json');

    this.config = {
      enabled: false,
      rules: []
    };
    this.rules = [];

    this.events = new Map();
    this.cooldowns = new Map();
    this.queue = Promise.resolve();
    this.timer = null;
    this.closed = false;
    this.allowed = null;
    this.challenge = '';
    this.battle = '';

    if (this.file) {
      if (!fs.existsSync(this.file)) {
        if (options.file !== undefined) {
          throw new Error('매크로 파일 없음');
        }

        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(
          this.file,
          JSON.stringify(
            {
              enabled: false,
              rules: [
                {
                  name: '명령어',
                  kind: 'command',
                  pattern: '!명령어',
                  action: 'reply',
                  reply: '!명령어',
                  cooldown: 5
                }
              ],
              history: { remarks: [] }
            },
            null,
            4
          ) + '\n'
        );
      }

      this.load();

      this.watcher = () => {
        if (this.closed) {
          return;
        }

        try {
          this.load();
          this.client.emit('macro', {
            type: 'load',
            message: '수정 완료'
          });
        } catch (error) {
          this.client.emit('error', error);
        }
      };

      fs.watchFile(this.file, { interval: 1000 }, this.watcher);
    }
    else {
      this.update(options.config || this.config);
    }

    if (options.history === false) {
      this.history = null;
    }
    else {
      this.history = new SoopHistory(client, {
        ...this.config.history,
        ...(options.history || {})
      });
    }

    this.on('chat', data => {
      return this.handle(data);
    });

    this.on('managerChat', data => {
      return this.handle(data, 'chat', true);
    });

    this.on('ogq', data => {
      return this.handle(data);
    });

    this.on('join', () => {
      this.allowed = null;
      this.challenge = '';
      this.battle = '';
    });

    for (const event of ['subBj', 'userFlag']) {
      this.on(event, data => {
        if (this.isSelf(data.userId)) {
          this.allowed = Boolean(data.flag.isBJ || data.flag.isManager);
        }
      });
    }

    this.on('chuser', data => {
      if (data.type === 1) {
        this.handleEvent('enter', {
          ...data.user,
          userId: data.user.id,
          userNick: data.user.name
        });
      }
    });

    for (const event of Object.keys(EVENTS)) {
      this.on(event, data => {
        return this.handleEvent(event, data);
      });
    }
  }

  on(event, handler) {
    this.events.set(event, handler);
    this.client.on(event, handler);
  }

  load() {
    let config;

    try {
      config = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      throw new Error('매크로 설정 오류');
    }

    this.update(config);
  }

  update(config, write = false) {
    if (!config || typeof config.enabled !== 'boolean' || !Array.isArray(config.rules)) {
      throw new Error('매크로 설정 오류');
    }

    const ids = new Set();

    const rules = config.rules.map((rule, index) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new Error('매크로 규칙 오류');
      }

      const id = String(rule.id || index + 1);
      const kind = rule.kind === 'timer' ? 'interval' : rule.kind || 'command';
      const action = rule.action || 'reply';
      const cooldown = Number(rule.cooldown ?? 5);
      const interval = Number(rule.interval ?? 300);
      const patterns = Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern];

      let invalid =
        ids.has(id)
        || !['command', 'text', 'regex', 'event', 'interval'].includes(kind)
        || !['reply', 'roulette', 'mute', 'kick', 'warn'].includes(action);

      if (!invalid) {
        invalid =
          (rule.enabled !== undefined && typeof rule.enabled !== 'boolean')
          || (rule.commands !== undefined && typeof rule.commands !== 'boolean')
          || (rule.edit !== undefined && typeof rule.edit !== 'boolean');
      }

      if (!invalid) {
        invalid =
          (rule.reply !== undefined
            && typeof rule.reply !== 'string'
            && (!Array.isArray(rule.reply)
              || rule.reply.some(line => typeof line !== 'string')))
          || (!patterns.length && rule.enabled !== false)
          || patterns.some(
            pattern => typeof pattern !== 'string' || (!pattern && kind !== 'interval')
          );
      }

      if (!invalid) {
        invalid =
          !Number.isFinite(cooldown)
          || cooldown < 0
          || !Number.isFinite(interval)
          || interval < 1;
      }

      if (!invalid) {
        invalid =
          !['all', 'manager', 'streamer'].includes(rule.access || 'all')
          || !['both', 'chat', 'console'].includes(rule.input || 'both')
          || !['chat', 'manager', 'direct'].includes(rule.output || 'chat');
      }

      if (invalid) {
        throw new Error(`매크로 규칙 오류 (${rule.name || id})`);
      }

      ids.add(id);

      let regexes;

      if (kind === 'regex') {
        try {
          regexes = patterns.map(value => {
            const expression = /[\\^$.*+?()[\]{}|]/.test(value);
            let pattern;

            if (expression) {
              pattern = value;
            }
            else {
              pattern = `(^|[^\\p{L}\\p{N}_])${value}(?=$|[^\\p{L}\\p{N}_])`;
            }

            let flags;

            if (expression) {
              flags = rule.flags || 'i';
            }
            else {
              flags = [...new Set((rule.flags || 'i') + 'u')].join('');
            }

            const result = new RegExp(pattern, flags);

            return result;
          });
        } catch {
          throw new Error(`정규식 오류 (${rule.name || id})`);
        }
      }

      let ogq;

      if (typeof rule.ogq === 'string') {
        ogq = /^(.+?)\s+([1-9]\d*)$/.exec(rule.ogq.trim());
      }
      else {
        ogq = null;
      }

      if (rule.ogq && (!ogq || !Number.isSafeInteger(Number(ogq[2])))) {
        throw new Error(`OGQ 설정 오류 (${rule.name || id})`);
      }

      if (rule.numbers !== undefined) {
        const numbers = rule.numbers;
        let groups;

        if (Array.isArray(numbers) && numbers.every(Array.isArray)) {
          groups = numbers;
        }
        else {
          groups = [numbers];
        }

        if (
          groups.some(
            group =>
              !Array.isArray(group)
              || group.some(number => !Number.isSafeInteger(number) || number < 1)
          )
        ) {
          throw new Error(`룰렛 번호 설정 오류 (${rule.name || id})`);
        }
      }

      if (action === 'roulette') {
        const ranges = rule.ranges;
        const index = rule.index;

        let invalid =
          (rule.title !== undefined && typeof rule.title !== 'string')
          || (rule.default !== undefined
            && (!Number.isSafeInteger(rule.default) || rule.default < 1));

        if (!invalid && ranges !== undefined) {
          invalid =
            !Array.isArray(ranges)
            || !ranges.length
            || ranges.some(range => {
              const malformed =
                !Array.isArray(range)
                || range.length !== 2
                || range.some(number => {
                  const invalid = !Number.isSafeInteger(number) || number < 1;

                  return invalid;
                })
                || range[0] > range[1];

              return malformed;
            });
        }

        if (!invalid && index !== undefined) {
          if (typeof index === 'number') {
            invalid = !Number.isSafeInteger(index) || index < 0;
          }
          else {
            invalid = !index || typeof index !== 'object' || Array.isArray(index);

            if (!invalid) {
              invalid = Object.entries(index).some(([number, value]) => {
                const malformed =
                  !/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(value) || value < 0;

                return malformed;
              });
            }
          }
        }

        if (invalid) {
          throw new Error(`룰렛 설정 오류 (${rule.name || id})`);
        }

        if (
          rule.default !== undefined
          && !this.matchesRoulette(rule, String(rule.default))
        ) {
          throw new Error(`룰렛 설정 오류 (${rule.name || id})`);
        }
      }

      const count = Number(rule.count ?? 0);

      if (action === 'mute' && (!Number.isSafeInteger(count) || count < 0 || count > 3)) {
        throw new Error(`채금 횟수 오류 (${rule.name || id})`);
      }

      const result = {
        ...rule,
        id,
        kind,
        action,
        cooldown,
        interval,
        patterns,
        regexes,
        count,
        ogqName: ogq?.[1],
        ogqNumber: ogq ? Number(ogq[2]) : undefined
      };

      return result;
    });

    if (
      config.history?.remarks
      && (!Array.isArray(config.history.remarks)
        || config.history.remarks.some(
          item =>
            !item
            || !item.name
            || !Array.isArray(item.words)
            || item.words.some(word => typeof word !== 'string' || !word.trim())
        ))
    ) {
      throw new Error('비고 설정 오류');
    }

    if (write && this.file) {
      const temporary = this.file + '.tmp';

      fs.writeFileSync(temporary, JSON.stringify(config, null, 4) + '\n');
      fs.renameSync(temporary, this.file);
    }

    this.config = config;
    this.rules = rules;
    this.cooldowns.clear();

    if (this.history) {
      this.history.remarks =
        this.options.history?.remarks || config.history?.remarks || [];
    }

    clearInterval(this.timer);
    this.timer = null;

    if (rules.some(rule => rule.kind === 'interval' && this.isEnabled(rule))) {
      this.timer = setInterval(() => {
        for (const rule of this.rules) {
          if (rule.kind === 'interval' && this.isEnabled(rule)) {
            this.enqueue(rule, { source: 'event' }, {}, rule.interval);
          }
        }
      }, 1000);
    }
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new Error('매크로 설정 오류');
    }

    this.save({ ...this.config, enabled });
  }

  save(config) {
    this.update(config, true);
  }

  isEnabled(rule) {
    let reply;

    if (Array.isArray(rule.reply)) {
      reply = rule.reply.join('\n');
    }
    else {
      reply = String(rule.reply || '');
    }

    const result =
      rule.enabled !== false
      && (rule.action !== 'reply' || Boolean(reply.trim() || rule.ogq));

    return result;
  }

  list() {
    const result = this.rules.map(rule => {
      const name = rule.name || rule.id;
      const state = this.isEnabled(rule) ? '켜짐' : '꺼짐';
      const kind = {
        command: '명령어',
        text: '자동답변',
        regex: '자동답변',
        event: '이벤트',
        interval: '타이머'
      }[rule.kind];
      const pattern = rule.patterns.join('\n');
      let action;

      if (rule.action === 'mute' && !rule.count) {
        action = '경고';
      }
      else {
        action = {
          reply: '답변',
          roulette: '룰렛',
          mute: '채금',
          kick: '강퇴',
          warn: '경고'
        }[rule.action];
      }

      const value = {
        이름: name,
        사용: state,
        종류: kind,
        규칙: pattern,
        동작: action
      };

      return value;
    });

    return result;
  }

  isSelf(userId) {
    const normalize = id => String(id || '').replace(/\(\d+\)$/, '');

    const result = Boolean(
      userId && this.client.userId && normalize(userId) === normalize(this.client.userId)
    );

    return result;
  }

  canSend() {
    const flag = checkFlag(this.client.userFlag);
    const user = [...this.client.userList.values()].find(item => this.isSelf(item.id));
    const allowed =
      this.allowed
      ?? Boolean(
        flag.isBJ
        || flag.isManager
        || user?.isBJ
        || user?.isManager
        || ['스트리머', '매니저'].includes(user?.role)
      );

    const result =
      !this.closed
      && this.config.enabled
      && !this.client.idle
      && this.client.isOpen()
      && Number(this.client.info?.IS_LOGIN) === 1
      && allowed;

    return result;
  }

  access(rule, data) {
    if (
      rule.kind === 'interval'
      || (rule.access || 'all') === 'all'
      || data.source === 'console'
    ) {
      return true;
    }

    const user = this.client.userList.get(data.userId);
    const role = data.role || user?.role;

    let result;

    if (rule.access === 'streamer') {
      result = role === '스트리머';
    }
    else {
      result = ['스트리머', '매니저'].includes(role);
    }

    return result;
  }

  matchesRoulette(rule, args) {
    if (!args) {
      const output = rule.default !== undefined;

      return output;
    }

    const value =
      !rule.ranges
      || rule.ranges.some(([start, end]) => {
        const result = Number(args) >= start && Number(args) <= end;

        return result;
      });

    return value;
  }

  async replyManager(message) {
    try {
      if (!(await this.client.sendManagerChat(message))) {
        throw new Error('매니저 채팅 전송 실패');
      }
    } catch (error) {
      this.client.emit('error', error);
    }
  }

  async handle(data, source = 'chat', manager = false) {
    if (data.test || this.closed) {
      return false;
    }

    const message = String(data.message || '').trim();
    const command = message.split(/\s+/)[0];
    const args = message.slice(command.length).trim();
    const context = { ...data, message, source };
    const forward = /^(!공지|!시간)(?:\/|\s|$)([\s\S]*)$/.exec(message);
    const edit = rule => {
      const value =
        rule.kind === 'command'
        && rule.action === 'reply'
        && rule.edit
        && rule.patterns.some(pattern => {
          const result = pattern.toLowerCase() === command.toLowerCase();

          return result;
        });

      return value;
    };

    if (manager && forward && this.access({ access: 'manager' }, context)) {
      if (!this.canSend()) {
        return false;
      }

      try {
        const name = forward[1];
        const content = forward[2].trim();
        let reply;

        if (content) {
          reply = `${name}/${content}`;
        }
        else {
          reply = { '!공지': '!공지/삭제', '!시간': '!시간/업타임' }[name];
        }

        if (!(await this.client.sendChat(reply))) {
          throw new Error('채팅 전송 실패');
        }

        this.client.emit('macro', {
          type: 'send',
          rule: name,
          message: reply
        });

        const reset = !content || content === (name === '!공지' ? '삭제' : '업타임');
        let status;

        if (reset) {
          if (name === '!공지') {
            status = '삭제 완료';
          }
          else {
            status = '업타임 전환';
          }
        }
        else {
          status = '수정 완료';
        }

        const icon = reset ? '/개털림/' : '/개번쩍/';
        const response = [`${icon} [${name}] ${status}`, reset ? '' : content]
          .filter(Boolean)
          .join('\n');

        await this.replyManager(response);

        return true;
      } catch (error) {
        await this.replyManager(`[${forward[1]}] 처리 실패`);
        this.client.emit('error', error);

        return false;
      }
    }

    if (manager && this.access({ access: 'manager' }, context) && this.rules.some(edit)) {
      try {
        if (this.file) {
          this.load();
        }

        const index = this.rules.findIndex(edit);

        if (index >= 0) {
          this.save({
            ...this.config,
            rules: this.config.rules.map((rule, number) => {
              if (number === index) {
                const result = {
                  ...rule,
                  reply: args.replace(/\\r\\n|\\n/g, '\n')
                };

                return result;
              }

              return rule;
            })
          });

          const status = args ? '수정 완료' : '삭제 완료';
          const reply = this.config.rules[index].reply;
          const icon = args ? '/개번쩍/' : '/개털림/';
          const response = [`${icon} [${command}] ${status}`, reply]
            .filter(Boolean)
            .join('\n');

          this.client.emit('macro', {
            type: 'load',
            message: status
          });

          await this.replyManager(response);

          return true;
        }
      } catch (error) {
        await this.replyManager(`[${command}] 처리 실패`);
        this.client.emit('error', error);

        return false;
      }
    }

    if (source === 'chat' && this.isSelf(data.userId)) {
      return false;
    }

    for (const rule of this.rules) {
      if (
        !this.isEnabled(rule)
        || ['event', 'interval'].includes(rule.kind)
        || (rule.input && rule.input !== 'both' && rule.input !== source)
        || !this.access(rule, context)
      ) {
        continue;
      }

      let match;

      if (rule.kind === 'command') {
        if (
          !rule.patterns.some(pattern => {
            const result =
              message.split(/\s+/)[0].toLowerCase() === pattern.toLowerCase();

            return result;
          })
        ) {
          continue;
        }

        match = { args };

        if (rule.action === 'roulette' && !this.matchesRoulette(rule, match.args)) {
          continue;
        }
      }
      else if (rule.kind === 'text') {
        if (
          !rule.patterns.some(pattern =>
            message.toLowerCase().includes(pattern.toLowerCase())
          )
        ) {
          continue;
        }
      }
      else {
        let result;

        for (const regex of rule.regexes) {
          regex.lastIndex = 0;
          result = regex.exec(message);

          if (result) {
            break;
          }
        }

        if (!result) {
          continue;
        }

        match = Object.fromEntries(result.map((value, index) => [index, value || '']));
      }

      const output = this.enqueue(rule, context, match || {});

      return output;
    }

    return false;
  }

  handleEvent(event, data) {
    if (data.test || this.closed) {
      return;
    }

    if (event === 'missionSettle') {
      for (const [userId, userNick, count] of data.list || []) {
        this.handleEvent('mission', { ...data, userId, userNick, count });
      }

      return;
    }

    const names = [event === 'mission' ? 'missionSettle' : event];

    if (event === 'followEffect') {
      names.push('subCeremony');
    }

    if (event === 'challenge') {
      if (data.title) {
        this.challenge = data.title;
      }

      if (data.type === 'CHALLENGE_SETTLE') {
        data = { ...data, title: data.title || this.challenge };
        this.challenge = '';
      }

      names[0] = {
        CHALLENGE_GIFT: 'challengeGift',
        CHALLENGE_SETTLE: 'challengeSettle'
      }[data.type];
    }
    else if (event === 'battle') {
      if (data.title) {
        this.battle = data.title;
      }

      if (data.type === 'SETTLE') {
        data = { ...data, title: data.title || this.battle };
        this.battle = '';
      }

      names[0] = { GIFT: 'battleGift', SETTLE: 'battleSettle' }[data.type];
    }

    if (event === 'balloon' && data.fanOrder > 0) {
      names.push('fanClub');
    }

    if (event === 'balloon' && data.topFan > 0) {
      names.push('topFan');
    }

    for (const rule of this.rules) {
      if (
        rule.kind === 'event'
        && this.isEnabled(rule)
        && rule.patterns.some(pattern => names.includes(pattern))
      ) {
        this.enqueue(rule, {
          ...data,
          source: 'event',
          donation: EVENTS[event] || '별풍선'
        });
      }
    }
  }

  enqueue(rule, data, match = {}, cooldown = rule.cooldown) {
    if (!this.canSend() || !this.isEnabled(rule) || !this.access(rule, data)) {
      return Promise.resolve(false);
    }

    const now = Date.now();
    let key;

    if (rule.action === 'roulette') {
      key = `${rule.id}:${Number(match.args || rule.default)}`;
    }
    else {
      key = rule.id;
    }

    const last = this.cooldowns.get(key);

    if (last !== undefined && now - last < cooldown * 1000) {
      return Promise.resolve(false);
    }

    this.cooldowns.delete(key);
    this.cooldowns.set(key, now);

    while (this.cooldowns.size > 1000) {
      this.cooldowns.delete(this.cooldowns.keys().next().value);
    }

    this.queue = this.queue
      .then(async () => {
        if (!this.canSend() || !this.rules.includes(rule)) {
          return false;
        }

        return this.run(rule, data, match);
      })
      .catch(error => {
        this.client.emit('error', error);

        return false;
      });

    const result = this.queue;

    return result;
  }

  async run(rule, data, match) {
    const warning = rule.action === 'warn' || (rule.action === 'mute' && !rule.count);

    if (['mute', 'kick', 'warn'].includes(rule.action)) {
      const user = this.client.userList.get(data.userId);

      let invalid =
        data.source !== 'chat'
        || !data.userId
        || ['스트리머', '매니저'].includes(data.role || user?.role);

      if (!invalid) {
        invalid = data.isBJ || data.isManager || user?.isBJ;
      }

      if (!invalid) {
        invalid = user?.isManager;
      }

      if (invalid) {
        return false;
      }

      if (!warning) {
        const reason = rule.reason || rule.name || '자동관리';
        let result = true;

        for (let count = 0; count < (rule.action === 'mute' ? rule.count : 1); count++) {
          if (!this.canSend() || !this.rules.includes(rule)) {
            return false;
          }

          if (rule.action === 'mute') {
            result = await this.client.sendDumb(data.userId, reason);
          }
          else {
            result = await this.client.sendKick(data.userId, 0, reason);
          }

          if (!result) {
            throw new Error('자동관리 요청 실패');
          }
        }

        let reply;

        if (Array.isArray(rule.reply)) {
          reply = rule.reply.join('\n');
        }
        else {
          reply = String(rule.reply || '');
        }

        if (!reply.trim() && !rule.ogq) {
          this.client.emit('macro', {
            type: 'send',
            rule: rule.name || rule.id,
            message: reason
          });

          return result;
        }
      }
    }

    let reply;

    if (Array.isArray(rule.reply)) {
      reply = rule.reply.join('\n');
    }
    else {
      reply = String(rule.reply || '');
    }

    if (warning && !reply.trim()) {
      reply = '{이름}님, 채팅 내용을 주의해주세요.';
    }

    if (rule.commands) {
      const commands = new Set(
        this.rules
          .filter(
            item =>
              item.kind === 'command' && this.isEnabled(item) && item.input !== 'console'
          )
          .flatMap(item => item.patterns.map(pattern => pattern.toLowerCase()))
      );

      reply = reply
        .replace(/\\r\\n|\\n/g, '\n')
        .split('\n')
        .flatMap(line => {
          const names = line.trim().split(/\s+/);

          if (!names.every(name => name.startsWith('!'))) {
            const value = [line];

            return value;
          }

          const list = names.filter(name => commands.has(name.toLowerCase()));

          const result = list.length ? [list.join(' ')] : [];

          return result;
        })
        .join('\n');
    }

    if (rule.action === 'roulette') {
      const count = Number(match.args || rule.default);
      let user;

      if (typeof this.options.weflab === 'function') {
        user = this.options.weflab();
      }
      else {
        user = this.options.weflab;
      }

      if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error('사용법: !룰렛 개수');
      }

      if (!user) {
        throw new Error('WEFLAB 설정 없음');
      }

      let index;

      if (typeof rule.index === 'object') {
        index = rule.index[count] ?? 0;
      }
      else {
        index = rule.index ?? 0;
      }

      const roulette = await weflab.roulette(user, count, index);

      reply = weflab.format(roulette, count, rule.numbers, rule.title);
    }

    const variables = {
      이름: data.userNick || data.fromNick || data.user_nick || '',
      아이디: data.userId || data.fromId || data.user_id || '',
      내용: data.message || '',
      제목: data.title || '',
      인수: match.args || '',
      개수:
        data.count
        ?? data.item?.days
        ?? data.gift_count
        ?? data.settle_count
        ?? data.month
        ?? '',
      개월: data.month ?? data.item?.month ?? '',
      받는이: data.toNick || data.receivedName || '',
      후원종류: data.donation || '',
      팬순번: data.fanOrder ?? '',
      ...match
    };

    const message = reply
      .replace(/\{([^{}]+)\}/g, (text, key) => {
        const result = variables[key] === undefined ? text : String(variables[key]);

        return result;
      })
      .replace(/\\r\\n|\\n/g, '\n');

    let ogq;

    if (rule.ogq && (!rule.output || rule.output === 'chat')) {
      const group = this.client.ogq?.data?.findIndex(item => {
        const result =
          item.ogq_title?.trim().toLowerCase() === rule.ogqName.toLowerCase();

        return result;
      });

      ogq = group >= 0 ? this.client.findOgq(group) : null;

      if (ogq && rule.ogqNumber > ogq.max) {
        ogq = null;
      }
    }

    if (!this.canSend() || !this.rules.includes(rule) || (!message && !ogq)) {
      return false;
    }

    let result;

    if (ogq) {
      result = await this.client.sendOgq(
        message ? '\n' + message : '',
        ogq.id,
        rule.ogqNumber
      );

      if (Number(result?.code) !== 1) {
        throw new Error(`OGQ 전송 실패 (${result?.code ?? '응답 없음'})`);
      }

      result = true;
    }
    else if (rule.output === 'manager') {
      result = await this.client.sendManagerChat(message);
    }
    else if (rule.output === 'direct') {
      if (!data.userId) {
        throw new Error('귓속말 대상 없음');
      }

      result = await this.client.sendDirectChat(message, data.userId);
    }
    else {
      result = await this.client.sendChat(message);
    }

    if (!result) {
      throw new Error('매크로 전송 실패');
    }

    this.client.emit('macro', {
      type: 'send',
      rule: rule.name || rule.id,
      message,
      userId: data.userId || '',
      userNick: data.userNick || ''
    });

    return true;
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    clearInterval(this.timer);

    if (this.file) {
      fs.unwatchFile(this.file, this.watcher);
    }

    for (const [event, handler] of this.events) {
      this.client.off(event, handler);
    }

    this.events.clear();
    this.history?.close();
    await this.queue;
  }
}
