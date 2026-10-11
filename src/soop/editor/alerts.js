import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as log from '#utils/log';

const stores = new Map();

export function inbox(client, file, action, entry) {
  if (!file || !client.bjId) return { items: [], unread: 0, revision: 0 };
  const account = client.info?.IS_LOGIN === 1 ? client.info.LOGIN_ID : '';
  const target = path.join(path.dirname(file), 'inbox', `${encodeURIComponent(account || '비로그인')}.json`);
  let store = stores.get(target);
  if (!store) {
    let items = [];
    try {
      if (fs.existsSync(target)) {
        const data = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (Array.isArray(data)) items = data.filter(item => item && typeof item.id === 'string' && Number.isFinite(item.time)).slice(-500);
      }
    } catch {
      log.warn('[알림]', '알림 목록을 읽을 수 없습니다.');
    }
    store = { items, recent: new Map(), revision: 0 };
    stores.set(target, store);
  }
  if (action === 'add') {
    const now = Date.now();
    for (const [key, time] of store.recent) {
      if (now - time >= 30000) store.recent.delete(key);
    }
    const signature = JSON.stringify([client.channel?.BNO, entry.kind, entry.label, entry.message, entry.sticker]);
    if (now - (store.recent.get(signature) || 0) < (entry.cooldown || 1000)) return inbox(client, file);
    store.recent.set(signature, now);
    store.items.push({ ...entry, id: crypto.randomUUID(), time: now, read: false });
    store.items = store.items.slice(-500);
  }
  else if (action === 'read') {
    for (const item of store.items) {
      if (!entry?.id && !Array.isArray(entry?.ids) || item.id === entry?.id
        || Array.isArray(entry?.ids) && entry.ids.includes(item.id)) item.read = true;
    }
  }
  else if (action === 'deleteRead') store.items = store.items.filter(item => !item.read);
  else if (action === 'deleteAll') store.items = [];
  else if (action) throw new Error('알림 요청을 확인해주세요.');
  if (action) {
    store.revision++;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(`${target}.tmp`, JSON.stringify(store.items, null, 2));
      fs.renameSync(`${target}.tmp`, target);
    } catch {
      log.warn('[알림]', '알림 목록을 저장할 수 없습니다.');
    }
  }
  return { items: store.items.map(item => ({ ...item })), unread: store.items.filter(item => !item.read).length, revision: store.revision };
}
