import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const defaults = { mode: 'single', text: '', pattern: [], order: 'sequence',
  interval: 2, variance: 0, countVariance: 0, duration: 180 };

export function validate(value) {
  if (!value || !['single', 'pattern'].includes(value.mode)
    || !['sequence', 'shuffle'].includes(value.order)
    || typeof value.text !== 'string' || value.text.length > 2000
    || !Array.isArray(value.pattern) || value.pattern.length > 30
    || value.pattern.some(line => typeof line !== 'string' || !line.trim() || line.length > 2000)
    || !Number.isFinite(value.interval) || value.interval < 1 || value.interval > 60
    || ![0, 0.2, 0.5, 1].includes(value.variance)
    || ![0, 1, 2, 3].includes(value.countVariance)
    || !Number.isInteger(value.duration) || value.duration < 0 || value.duration > 36000) {
    throw new Error('응원봉 설정을 확인해주세요.');
  }
  return Object.fromEntries(Object.keys(defaults).map(key => [key, value[key]]));
}

export class Cheer {
  constructor(state) {
    this.state = state;
    this.running = false;
    this.count = 0;
    this.message = '';
    this.generation = 0;
    this.timer = null;
    this.deadline = null;
    this.client = state.macro.client;
    this.cancel = () => this.stop('연결이 변경되어 정지했습니다.');
    for (const event of ['close', 'broadcastEnd', 'join']) this.client.on(event, this.cancel);
  }

  scope() {
    const client = this.state.macro.client;
    return { player: client.bjId || '', account: client.info?.IS_LOGIN === 1
      ? String(client.info.LOGIN_ID || '').replace(/\(\d+\)$/, '') : '' };
  }

  key(scope = this.scope()) { return `${scope.player}:${scope.account}`; }

  allowed() {
    const scope = this.scope();
    const chat = this.state.chat.state();
    return Boolean(scope.player && scope.account && chat.login && chat.connected
      && !this.state.switching && !this.client.idle);
  }

  file() {
    const { player, account } = this.scope();
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(player) || !/^[a-zA-Z0-9_]{1,64}$/.test(account)) {
      throw new Error('방송과 로그인 계정을 확인해주세요.');
    }
    return path.resolve('macros', player, 'cheer', `${account}.json`);
  }

  read() {
    if (!this.scope().player || !this.scope().account) return { config: { ...defaults }, revision: '' };
    let source = '';
    try { source = fs.readFileSync(this.file(), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { config: source ? validate(JSON.parse(source)) : { ...defaults, pattern: [] },
      revision: crypto.createHash('sha256').update(source).digest('hex') };
  }

  save(config, revision) {
    const value = validate(config);
    if (revision !== this.read().revision) throw new Error('설정이 변경되었습니다. 다시 열어주세요.');
    const target = this.file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, target);
    return value;
  }

  status() {
    if (this.running && (this.owner !== this.key() || !this.allowed())) this.cancel();
    return { ...this.scope(), running: this.running, count: this.count, message: this.message,
      remaining: this.ends ? Math.max(0, Math.ceil((this.ends - Date.now()) / 1000)) : 0,
      allowed: this.allowed() };
  }

  start(config, revision) {
    if (!this.allowed()) throw new Error('로그인 후 방송에 연결해주세요.');
    if (this.running) throw new Error('응원봉을 먼저 정지해주세요.');
    const value = validate(config);
    if (value.mode === 'single' ? !value.text.trim() : !value.pattern.length) {
      throw new Error('응원 문구를 입력해주세요.');
    }
    this.config = this.save(value, revision);
    this.owner = this.key();
    this.running = true;
    this.count = 0;
    this.index = 0;
    this.queue = [];
    this.message = '';
    this.generation++;
    this.ends = value.duration ? Date.now() + value.duration * 1000 : 0;
    if (value.duration) {
      this.deadline = setTimeout(() => this.stop('자동 종료되었습니다.'), value.duration * 1000);
      this.deadline.unref();
    }
    this.schedule();
  }

  schedule() {
    const delay = Math.max(1000, (this.config.interval + (Math.random() * 2 - 1) * this.config.variance) * 1000);
    const generation = this.generation;
    this.timer = setTimeout(() => void this.tick(generation), delay);
    this.timer.unref();
  }

  next() {
    if (this.config.mode === 'single') return this.config.text;
    if (this.config.order === 'sequence') return this.config.pattern[this.index++ % this.config.pattern.length];
    if (!this.queue.length) {
      this.queue = [...this.config.pattern];
      for (let index = this.queue.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [this.queue[index], this.queue[other]] = [this.queue[other], this.queue[index]];
      }
    }
    return this.queue.pop();
  }

  content(text) {
    const known = new Set((this.client.findEmoticon?.(text) || []).map(item => item.keyword));
    const tokens = [...text.matchAll(/\/[^/\s]+\//g)];
    const user = this.state.chat.user({ userId: this.client.userId || this.scope().account,
      userFlag: this.state.chat.flag || this.client.userFlag });
    const maximum = user.tier ? Infinity : 3;
    if (tokens.length && tokens.every(item => item[0] === tokens[0][0])
      && tokens.map(item => item[0]).join('') === text && known.has(tokens[0][0])) {
      const change = Math.round((Math.random() * 2 - 1) * this.config.countVariance);
      return tokens[0][0].repeat(Math.max(1, Math.min(maximum, tokens.length + change)));
    }
    let count = 0;
    return text.replace(/\/[^/\s]+\//g, token => !known.has(token) || ++count <= maximum ? token : '');
  }

  async tick(generation) {
    if (!this.running || generation !== this.generation) return;
    if (this.owner !== this.key() || !this.allowed()) { this.cancel(); return; }
    if (this.ends && Date.now() >= this.ends) { this.stop('자동 종료되었습니다.'); return; }
    if (this.client.iceMode) { this.stop('채팅이 얼려져 정지했습니다.'); return; }
    try {
      await this.state.chat.action({ action: 'send', message: this.content(this.next()) });
      if (!this.running || generation !== this.generation) return;
      this.count++;
      this.schedule();
    } catch (error) {
      if (generation === this.generation) this.stop(error.message || '전송하지 못했습니다.');
    }
  }

  stop(message = '') {
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.timer = this.deadline = null;
    this.running = false;
    this.ends = 0;
    this.message = message;
  }

  close() {
    this.stop();
    for (const event of ['close', 'broadcastEnd', 'join']) this.client.off(event, this.cancel);
  }
}
