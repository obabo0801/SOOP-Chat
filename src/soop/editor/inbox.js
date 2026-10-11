import { DOMAIN } from '/config.js';
import { drag } from './scroll.js';
import * as chat from './chat.js';

export function createInbox(request, profile) {
  const $ = id => document.getElementById(id);
  const dialog = $('inbox');
  drag($('inbox-tabs'));
  const bell = $('inbox-open');
  const dot = bell.querySelector('.inbox-dot');
  let player = '';
  let account = '';
  let items = [];
  let category = '전체';
  let loading = false;
  let generation = 0;
  let stamp = '';
  let enabled = false;
  let emoticons = [];
  let emoteStamp = '';
  const enable = value => {
    enabled = Boolean(value);
    bell.hidden = !player || !enabled;
    if (!enabled && dialog.open) dialog.close();
  };
  const categories = ['전체', '방송', '채팅', '콘텐츠', '후원', '운영', '연결'];
  const users = new Map();
  const profiles = new Map();
  const reading = new Set();
  let readingTimer;
  const observer = new IntersectionObserver(entries => {
    if (!dialog.open || document.hidden) return;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        const id = entry.target.dataset.id;
        profiles.get(id)?.();
        profiles.delete(id);
        if (entry.target.classList.contains('unread')) reading.add(id);
      }
    }
    clearTimeout(readingTimer);
    readingTimer = setTimeout(() => void readVisible(), 600);
  }, { root: dialog, threshold: 0.5 });
  const readVisible = async () => {
    if (loading || !dialog.open || document.hidden || !reading.size) return;
    const current = generation;
    const ids = [...reading].filter(id => {
      const row = [...$('inbox-list').children].find(node => node.dataset.id === id);
      if (!row) return false;
      const rect = row.getBoundingClientRect();
      const bounds = dialog.getBoundingClientRect();
      const top = Math.max(rect.top, bounds.top, 0);
      const bottom = Math.min(rect.bottom, bounds.bottom, window.innerHeight);
      const left = Math.max(rect.left, bounds.left, 0);
      const right = Math.min(rect.right, bounds.right, window.innerWidth);
      return bottom > top && right > left
        && row.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
    });
    reading.clear();
    if (!ids.length) return;
    loading = true;
    try {
      const data = await request('PUT', { player, account, action: 'read', ids }, '/api/inbox');
      if (current !== generation) return;
      items = data.items;
      stamp = String(data.revision);
      indicator(data.unread);
      for (const row of $('inbox-list').querySelectorAll('.inbox-entry')) {
        if (!ids.includes(row.dataset.id)) continue;
        row.classList.remove('unread');
        row.querySelector('.inbox-dot').hidden = true;
        observer.unobserve(row);
      }
      $('inbox-read').disabled = !items.some(item => !item.read);
      $('inbox-delete-read').disabled = !items.some(item => item.read);
    } catch (error) { if (current === generation) status(error.message); }
    finally { loading = false; if (reading.size) void readVisible(); }
  };
  const dateKey = time => new Date(time).toLocaleDateString('sv-SE');
  const dateLabel = time => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const key = dateKey(time);
    return key === dateKey(today) ? '오늘' : key === dateKey(yesterday) ? '어제'
      : new Date(time).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  };
  const status = message => {
    $('inbox-status').textContent = message;
    $('inbox-status').hidden = !message;
  };
  const indicator = unread => {
    dot.hidden = !unread;
    bell.title = unread ? `읽지 않은 알림 ${unread}개` : '알림';
  };
  const render = () => {
    observer.disconnect();
    profiles.clear();
    const list = $('inbox-list');
    list.replaceChildren();
    $('inbox-read').disabled = !items.some(item => !item.read);
    $('inbox-delete-read').disabled = !items.some(item => item.read);
    $('inbox-delete-all').disabled = !items.length;
    const visible = items.filter(item => {
      const kind = item.kind === '선물' ? '후원' : item.kind;
      return category === '전체' || kind === category;
    })
      .sort((a, b) => ($('inbox-sort').value === 'unread' ? Number(a.read) - Number(b.read) : 0) || b.time - a.time);
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'inbox-empty';
      empty.textContent = '알림이 없습니다.';
      list.append(empty);
    }
    let previous = '';
    for (const item of visible) {
      const key = dateKey(item.time);
      if (key !== previous) {
        const separator = document.createElement('div');
        separator.className = 'inbox-date';
        separator.textContent = dateLabel(item.time);
        list.append(separator);
        previous = key;
      }
      const row = document.createElement('article');
      row.dataset.id = item.id;
      row.className = `inbox-entry${item.read ? '' : ' unread'}`;
      const user = { id: item.userId, name: item.nickname, ...item.user };
      const person = document.createElement('button');
      person.type = 'button';
      person.className = 'inbox-person';
      person.title = '프로필';
      person.addEventListener('click', () => profile(user));
      const image = document.createElement('img');
      image.className = 'inbox-avatar';
      image.alt = '';
      const id = String(item.userId || '').replace(/\(\d+\)$/, '');
      image.src = (item.image || new URL(`/LOGO/${id.slice(0, 2)}/${encodeURIComponent(id)}/m/${encodeURIComponent(id)}.webp`, DOMAIN.profile).href).replace(/^http:/, 'https:');
      image.addEventListener('error', () => {
        image.hidden = true;
        fallback.hidden = false;
      }, { once: true });
      const fallback = document.createElement('span');
      fallback.className = 'inbox-avatar inbox-fallback';
      fallback.hidden = true;
      fallback.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></svg>';
      const body = document.createElement('span');
      body.className = 'inbox-body';
      const name = document.createElement('b');
      name.textContent = item.nickname;
      const identity = document.createElement('button');
      identity.type = 'button';
      identity.className = 'inbox-person inbox-name';
      identity.title = '프로필';
      identity.append(name);
      identity.addEventListener('click', () => profile(user));
      const decorate = data => {
        for (const node of identity.querySelectorAll('img, .chat-badge')) node.remove();
        const picture = (url, title) => {
          if (!url) return;
          let address;
          try { address = new URL(url, DOMAIN.soop); } catch { return; }
          if (address.protocol !== 'https:') return;
          const icon = document.createElement('img');
          icon.src = address.href;
          icon.title = title;
          icon.alt = title;
          icon.addEventListener('error', () => icon.remove(), { once: true });
          identity.append(icon);
        };
        const emblem = data?.emblem;
        const grades = { silver: '실버', gold: '골드', platinum: '플래티넘', emerald: '에메랄드', diamond: '다이아', prestige: '프레스티지' };
        picture(emblem?.url, `${grades[emblem?.grade] || '엠블럼'}${String(emblem?.level || '').replace('lv', '')}`);
        for (const [key, value] of Object.entries(data?.user || {})) {
          if (value && (!user[key] || key === 'role' && user[key] === '일반')) user[key] = value;
        }
        const detail = user;
        identity.dataset.role = detail.role || '';
        picture(detail.tierUrl, `${detail.tierName || '구독'}${detail.month > 0
          ? ` ${detail.month}개월 연속 구독 중` : detail.total > 0 ? ` 누적 ${detail.total}개월 구독 중` : ''}`);
        const badges = { 스트리머: 'B', 매니저: 'M', 열혈: '♥', 팬: 'F', 운영자: 'S' };
        if (badges[detail.role]) {
          const badge = document.createElement('span');
          badge.className = 'chat-badge';
          badge.title = detail.role;
          badge.textContent = badges[detail.role];
          identity.append(badge);
        }
      };
      decorate();
      if (/^[a-zA-Z0-9_()-]{1,100}$/.test(id)) {
        profiles.set(item.id, () => {
          if (!users.has(id)) users.set(id, request('GET', undefined, `/api/user?id=${encodeURIComponent(id)}&emblem=1`).catch(() => null));
          void users.get(id).then(data => {
            if (!data || !row.isConnected) return;
            if (data.image) { image.src = data.image.replace(/^http:/, 'https:'); image.hidden = false; fallback.hidden = true; }
            decorate(data);
          });
        });
      }
      const label = document.createElement('span');
      label.className = 'inbox-label';
      const subscription = item.kind === '후원' && String(item.message || '')
        .match(/(연속 구독|구독 갱신|구독)\s+(\d+)개월/);
      label.textContent = subscription ? `${subscription[1]} ${subscription[2]}개월` : item.label;
      const heading = document.createElement('span');
      heading.className = 'inbox-identity';
      heading.append(identity, label);
      const message = document.createElement('span');
      message.className = 'inbox-message';
      chat.content(message, item.message, item.emoticons?.length ? item.emoticons : emoticons);
      const stickers = item.images || item.stickers || (item.sticker ? [item.sticker] : []);
      if (stickers.length) {
        if (!item.images && !item.stickers) message.replaceChildren();
        for (const url of stickers) {
          const sticker = document.createElement('img');
          sticker.className = url.includes('ogq-sticker-') ? 'inbox-sticker' : 'inbox-content-image';
          sticker.src = url;
          sticker.alt = '';
          sticker.loading = 'lazy';
          message.append(sticker);
        }
      }
      if (item.kind === '콘텐츠' && item.url) {
        try {
          const url = new URL(item.url);
          if (url.protocol === 'https:') {
            const link = document.createElement('a');
            link.href = url.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const [title, ...lines] = String(item.message || '').split('\n');
            link.textContent = title;
            const pictures = [...message.querySelectorAll('.inbox-sticker, .inbox-content-image')];
            const body = document.createElement('span');
            chat.content(body, lines.length ? `\n${lines.join('\n')}` : '',
              item.emoticons?.length ? item.emoticons : emoticons);
            message.replaceChildren(link, body, ...pictures);
          }
        } catch {}
      }
      const time = document.createElement('time');
      time.dateTime = new Date(item.time).toISOString();
      time.textContent = new Date(item.time).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      body.append(heading, message, time);
      const unread = document.createElement('span');
      unread.className = 'inbox-dot';
      unread.hidden = item.read;
      person.append(image, fallback);
      row.append(person, body, unread);
      list.append(row);
      if (dialog.open) observer.observe(row);
    }
  };
  const apply = data => {
    items = data.items;
    stamp = String(data.revision);
    indicator(data.unread);
    render();
  };
  const refresh = async () => {
    if (loading || !player) return;
    const current = generation;
    loading = true;
    try {
      const data = await request('GET', undefined, '/api/inbox');
      if (current === generation) { apply(data); status(''); }
    } catch (error) {
      if (current === generation) status(error.message);
    } finally { loading = false; if (reading.size) void readVisible(); }
  };
  const mutate = async (action, id) => {
    if (loading) return;
    const current = generation;
    loading = true;
    try {
      const data = await request('PUT', { player, account, action, id }, '/api/inbox');
      if (current === generation) { apply(data); status(''); }
    } catch (error) {
      if (current === generation) status(error.message);
    } finally { loading = false; }
  };
  for (const name of categories) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.classList.toggle('selected', name === category);
    button.addEventListener('click', () => {
      category = name;
      for (const tab of $('inbox-tabs').children) tab.classList.toggle('selected', tab === button);
      render();
    });
    $('inbox-tabs').append(button);
  }
  bell.addEventListener('click', () => {
    status('불러오는 중입니다.');
    dialog.showModal();
    refresh();
  });
  $('inbox-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { observer.disconnect(); reading.clear(); clearTimeout(readingTimer); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dialog.open) render(); });
  $('inbox-sort').addEventListener('change', render);
  $('inbox-read').addEventListener('click', () => mutate('read'));
  $('inbox-delete-read').addEventListener('click', () => mutate('deleteRead'));
  $('inbox-delete-all').addEventListener('click', () => mutate('deleteAll'));
  return {
    enable,
    update(data) {
      const icons = JSON.stringify(data.emoticons || []);
      if (icons !== emoteStamp) {
        emoticons = data.emoticons || [];
        emoteStamp = icons;
        stamp = '';
      }
      const changed = player !== data.player || account !== data.homeAccount;
      if (changed) {
        generation++;
        player = data.player || '';
        account = data.homeAccount;
        items = [];
        users.clear();
        reading.clear();
        stamp = '';
        if (dialog.open) dialog.close();
      }
      enable(data.notification?.config.enabled);
      indicator(data.inboxUnread || 0);
      const next = String(data.inboxRevision);
      if (dialog.open && stamp !== next) refresh();
    }
  };
}
