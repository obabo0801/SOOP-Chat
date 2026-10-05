import fs from 'fs';
import path from 'path';
import * as time from '#utils/time';

export class SoopHistory {
  constructor(client, options = {}) {
    this.client = client;
    this.directory = path.resolve(options.directory || 'logs');
    this.limit = options.limit ?? 10;
    this.maxUsers = options.maxUsers ?? 5000;
    this.retention = options.retention ?? 1800000;
    this.remarks = options.remarks || [];
    this.chats = new Map();
    this.pending = new Map();
    this.recent = new Map();
    this.events = new Map();
    this.closed = false;

    let invalid =
      !Number.isSafeInteger(this.limit)
      || this.limit < 1
      || !Number.isSafeInteger(this.maxUsers);

    if (!invalid) {
      invalid =
        this.maxUsers < 1 || !Number.isFinite(this.retention) || this.retention < 1;
    }

    if (invalid) {
      throw new Error('기록 설정 오류');
    }

    this.on('chat', data => this.add(data));
    this.on('managerChat', data => this.add(data));
    this.on('ogq', data => this.add(data));
    this.on('dumb', data => {
      if (!data.test) {
        this.record('mute', data);
      }
    });

    this.on('chuser', data => {
      if (data.type === -1 && Number.isInteger(data.user?.exit) && data.user.exit !== 1) {
        this.kick({
          ...data.user,
          userId: data.user.id,
          userNick: data.user.name
        });
      }
    });

    this.on('kickCancel', data => {
      if (data.type === 0) {
        this.kick(data);
      }
    });

    this.on('kickList', list => {
      for (const data of list) {
        const pending = this.pending.get(data.userId);
        const date = Date.parse(data.date);

        if (pending && Number.isFinite(date) && Math.abs(date - pending.date) < 10000) {
          clearTimeout(pending.timer);
          this.pending.delete(data.userId);
          this.record('kick', { ...pending.data, ...data }, pending.date);
        }
      }
    });

    this.on('close', () => {
      this.flush();
      this.chats.clear();
    });
  }

  on(event, handler) {
    this.events.set(event, handler);
    this.client.on(event, handler);
  }

  add(data) {
    if (!data.userId || data.test || this.closed) {
      return;
    }

    const now = Date.now();

    for (const [id, entries] of this.chats) {
      if (now - entries.at(-1).date <= this.retention) {
        break;
      }

      this.chats.delete(id);
    }

    const list = this.chats.get(data.userId) || [];

    list.push({
      date: now,
      name: data.userNick,
      message: String(data.message || '')
    });

    this.chats.delete(data.userId);
    this.chats.set(data.userId, list.slice(-this.limit));

    while (this.chats.size > this.maxUsers) {
      this.chats.delete(this.chats.keys().next().value);
    }
  }

  get(userId, date = Date.now()) {
    const value = (this.chats.get(userId) || []).filter(item => {
      const result = date - item.date <= this.retention;

      return result;
    });

    return value;
  }

  kick(data) {
    if (!data.userId || data.test || this.closed || this.pending.has(data.userId)) {
      return;
    }

    const date = Date.now();
    const last = this.recent.get(data.userId);

    if (last && date - last < 3000) {
      return;
    }

    this.recent.delete(data.userId);
    this.recent.set(data.userId, date);

    while (this.recent.size > this.maxUsers) {
      this.recent.delete(this.recent.keys().next().value);
    }

    const timer = setTimeout(() => {
      this.pending.delete(data.userId);
      this.record('kick', data, date);
    }, 3000);

    this.pending.set(data.userId, { data, date, timer });
    Promise.resolve()
      .then(() => this.client.sendKickList())
      .catch(error => {
        this.client.emit('error', error);
      });
  }

  record(type, data, date = Date.now()) {
    if (!['mute', 'kick'].includes(type) || !data.userId || this.closed) {
      return null;
    }

    const list = this.get(data.userId, date);
    const user = this.client.userList.get(data.userId);
    const admin = this.client.userList.get(data.adminId);
    const name = data.userNick || user?.name || list.at(-1)?.name || data.userId;
    const message = list.map(item => item.message).join('\n');
    const remarks = this.remarks
      .filter(item => {
        const words = Array.isArray(item.words) ? item.words : [];

        const result = words.some(word =>
          message.toLowerCase().includes(String(word).toLowerCase())
        );

        return result;
      })
      .map(item => item.name)
      .filter(Boolean);
    const stamp = new Date(date);
    const day = [
      stamp.getFullYear(),
      time.pad(stamp.getMonth() + 1),
      time.pad(stamp.getDate())
    ].join('-');
    const clock = [stamp.getHours(), stamp.getMinutes(), stamp.getSeconds()]
      .map(time.pad)
      .join(':');
    const record = {
      날짜: `${day} ${clock}`,
      방송: this.client.bjId || '',
      처리: type === 'mute' ? '채금' : '강퇴',
      처리자: data.adminNick || admin?.name || data.adminId || '',
      처리자아이디: data.adminId || '',
      대상자: name,
      대상자아이디: data.userId,
      횟수: data.count ?? '',
      시간: data.time ?? '',
      채팅: message,
      비고: [...new Set(remarks)].join('\n')
    };

    try {
      const directory = path.join(this.directory, day);

      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(
        path.join(directory, `${type}.log`),
        JSON.stringify(record) + '\n'
      );
    } catch {
      this.client.emit('error', new Error('처리 기록 저장 실패'));

      return null;
    }

    this.client.emit('history', record);

    return record;
  }

  row(record) {
    const value = [
      '날짜',
      '방송',
      '처리',
      '처리자',
      '처리자아이디',
      '대상자',
      '대상자아이디',
      '횟수',
      '시간',
      '채팅',
      '비고'
    ].map(key => {
      const result = record[key] ?? '';

      return result;
    });

    return value;
  }

  flush() {
    for (const { data, date, timer } of this.pending.values()) {
      clearTimeout(timer);
      this.record('kick', data, date);
    }

    this.pending.clear();
  }

  close() {
    if (this.closed) {
      return;
    }

    this.flush();
    this.closed = true;

    for (const [event, handler] of this.events) {
      this.client.off(event, handler);
    }

    this.events.clear();
    this.chats.clear();
    this.recent.clear();
  }
}
