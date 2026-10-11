import { DOMAIN } from '/config.js';
import { drag } from './scroll.js';

export function createHome(request, select, profile, signin, preview) {
  const $ = id => document.getElementById(id);
  const home = $('home');
  const sections = $('home-sections');
  const status = $('home-status');
  let key;
  let version = 0;
  let switching = false;
  let loadingScreens = false;
  let screenContent = '';
  let screenCards = new Map();
  const source = value => {
    const url = new URL(value, DOMAIN.soop);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  };
  const preload = src => new Promise(resolve => {
    if (!src) return resolve();
    const image = new Image();
    const timer = setTimeout(done, 8000);
    function done() {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve();
    }
    image.onload = image.onerror = done;
    try {
      image.src = source(src);
    } catch {
      done();
    }
  });
  const reset = () => {
    version++;
    sections.replaceChildren();
  };
  const picture = (src, className, title = '') => {
    const image = document.createElement('img');

    image.addEventListener('load', () => image.classList.remove('loading'));
    image.addEventListener('error', () => image.remove());
    image.src = source(src);
    image.alt = '';
    image.title = title;
    image.className = `${className} loading`;
    image.loading = 'lazy';

    return image;
  };
  const emblem = item => {
    const names = { silver: '실버', gold: '골드', platinum: '플래티넘', emerald: '에메랄드', diamond: '다이아', prestige: '프레스티지' };
    const grade = String(item.emblemGrade || '').toLowerCase();
    const level = String(item.emblemLevel || '').toLowerCase();
    let name = names[grade] || '';
    if (name && grade !== 'prestige' && ['lv1', 'lv2', 'lv3'].includes(level)) name += level.slice(2);
    return picture(item.emblem, 'home-emblem', name);
  };
  const station = id => id
    ? new URL(`/station/${encodeURIComponent(String(id).replace(/\(\d+\)$/, ''))}`, DOMAIN.soop).href : '';
  const portrait = (user, src, className) => {
    if (!user.id) return picture(src, className);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-portrait';
    button.title = '프로필';
    button.addEventListener('click', () => void profile(user));
    button.append(picture(src, className));
    return button;
  };
  const card = (item, kind) => {
    const node = document.createElement('article');
    const cover = document.createElement('a');
    const thumb = document.createElement('span');
    const count = document.createElement('span');
    const body = document.createElement('div');
    const identity = document.createElement('div');
    const name = document.createElement('a');
    const title = document.createElement('a');
    const tags = document.createElement('div');
    const session = kind === 'session';
    const live = kind === 'live' || session;
    const target = session ? item.url : new URL(live
      ? `/${encodeURIComponent(item.id)}/${encodeURIComponent(item.number)}`
      : `/player/${encodeURIComponent(item.number)}`, live ? DOMAIN.play : DOMAIN.vod).href;

    node.className = 'home-card';
    cover.className = 'home-cover';
    cover.href = target;
    cover.title = item.title;
    thumb.className = 'home-thumb';

    if (item.image && (!session || item.connected)) {
      thumb.append(picture(item.image, 'home-thumbnail'));
    }

    count.className = live ? 'home-count live' : 'home-count';
    count.textContent = Number(item.viewers || 0).toLocaleString('ko-KR');

    if (session && !item.connected) {
      const waiting = document.createElement('span');
      waiting.className = 'home-waiting';
      waiting.textContent = '방송 연결 대기';
      thumb.append(waiting);
    }
    else if (kind !== 'story') {
      thumb.append(count);
    }

    if (item.adult || item.password) {
      const badge = document.createElement('span');

      badge.className = 'home-restriction';
      if (item.adult) {
        badge.textContent = '19';
      } else {
        badge.title = session ? '접속 비밀번호' : '비밀 방송';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        icon.setAttribute('viewBox', '0 0 24 24');
        line.setAttribute('d', 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3');
        icon.append(line);
        badge.append(icon);
      }
      thumb.append(badge);
    }

    cover.append(thumb);
    if (live && item.number && !item.password && (!session || item.connected)) {
      preview(thumb, item.id);
    } else if (!live && item.number) {
      preview(thumb, item.number, 'vod');
    }
    body.className = 'home-body';
    identity.className = 'home-identity';
    if (item.id) {
      name.href = station(item.id);
      name.addEventListener('click', event => {
        event.preventDefault();
        void profile({ id: String(item.id), name: item.name || String(item.id), role: '스트리머' });
      });
    }
    name.textContent = item.name || item.id;

    if (item.profile) {
      body.append(portrait({ id: String(item.id || ''), name: item.name || String(item.id || ''), role: '스트리머' }, item.profile, 'home-profile'));
    }

    identity.append(name);

    if (item.emblem) {
      identity.append(emblem(item));
    }

    title.className = 'home-title';
    title.href = target;
    title.textContent = kind === 'story' ? item.date || item.title : item.title;
    tags.className = 'home-tags';

    const groups = [
      ['label', [item.drops ? '드롭스' : '']],
      ['language', item.languages || []],
      ['category', item.categories || []],
      ['tag', item.hashtags || []],
      ['label', [item.subtitle ? 'CC' : '']]
    ];
    for (const [kind, values] of groups) {
      for (const text of values.filter(Boolean)) {
        const tag = document.createElement(kind === 'label' ? 'span' : 'a');
        tag.textContent = text;
        if (text === '드롭스') tag.className = 'drops';
        if (kind !== 'label') {
          const url = new URL(kind === 'category' ? `/directory/category/${encodeURIComponent(text)}/live` : '/search', DOMAIN.soop);
          if (kind !== 'category') url.search = new URLSearchParams({ hash: 'hashtag', tagname: text, hashtype: 'live', stype: 'hash', acttype: 'total', location: 'live' });
          tag.href = url.href;
          tag.target = '_blank';
          tag.rel = 'noopener noreferrer';
        }
        tags.append(tag);
      }
    }

    const details = document.createElement('div');

    details.append(identity, title, tags);
    body.append(details);
    node.append(cover, body);

    if (session) {
      const media = document.createElement('div');
      media.className = 'home-media';
      cover.replaceWith(media);
      media.append(cover);
      const account = document.createElement('button');
      const user = item.identity || { name: item.account };
      const nickname = document.createElement('span');
      account.type = 'button';
      account.className = 'home-account';
      account.title = '연결된 계정';
      account.dataset.role = user.role || '';
      if (user.image && user.id) account.append(picture(user.image, 'home-account-profile'));
      else {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.classList.add('home-account-icon');
        line.setAttribute('d', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2');
        icon.append(line);
        account.append(icon);
      }
      nickname.textContent = user.name || item.account || '비로그인';
      nickname.className = 'home-account-name';
      account.addEventListener('click', () => {
        if (user.id) void profile(user);
        else signin();
      });
      account.append(nickname);
      if (user.tierUrl) {
        const tier = picture(user.tierUrl, 'home-account-tier');
        const months = Number(user.total || user.month || 0);
        tier.title = `${user.tierName || '구독팬'}${months > 0 ? ` | 누적 ${months}개월` : ''}`;
        account.append(tier);
      }
      const badges = { 스트리머: 'B', 매니저: 'M', 열혈: '♥', 팬: 'F', 운영자: 'S' };
      if (badges[user.role]) {
        const badge = document.createElement('span');
        badge.className = 'chat-badge';
        badge.title = user.role === '열혈' ? '열혈팬' : user.role;
        badge.textContent = badges[user.role];
        account.append(badge);
      }

      media.append(account);
      return node;
    }

    for (const link of [cover, title]) {
      if (!live) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        continue;
      }

      link.addEventListener('click', async event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
          return;
        }

        event.preventDefault();

        if (switching) {
          return;
        }

        switching = true;
        status.textContent = '';

        try {
          await select(item);
        } catch (error) {
          status.textContent = error.message;
        } finally {
          switching = false;
        }
      });
    }

    return node;
  };
  const section = (title, items, kind) => {
    if (!items.length) {
      return;
    }

    const node = document.createElement('section');
    const heading = document.createElement('h2');
    const list = document.createElement('div');
    const button = document.createElement('button');
    let offset = 0;

    heading.textContent = title;
    const horizontal = kind === 'catch' || kind === 'story';
    list.className = horizontal ? 'home-row' : 'home-grid';
    if (horizontal) drag(list);
    button.type = 'button';
    button.className = 'home-more';
    button.textContent = '더 보기';
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    arrow.setAttribute('viewBox', '0 0 16 16');
    line.setAttribute('d', 'm3 6 5 5 5-5');
    arrow.append(line);
    button.append(arrow);
    node.append(heading, list, button);
    sections.append(node);

    const more = () => {
      for (const item of items.slice(offset, offset + 10)) {
        list.append(card(item, kind));
      }

      offset += 10;
      button.hidden = offset >= items.length;
    };

    more();
    button.addEventListener('click', more);
  };

  const screens = async () => {
    if (loadingScreens || home.hidden) {
      return;
    }

    loadingScreens = true;

    try {
      const { items } = await request('GET', undefined, '/api/screens');
      const content = JSON.stringify(items);

      if (content === screenContent) {
        return;
      }

      await Promise.all(items.flatMap(item => [item.profile, item.image, item.emblem,
        item.identity?.image, item.identity?.emblem, item.identity?.tierUrl].map(preload)));
      if (home.hidden) return;
      const next = new Map();
      const cards = items.map(item => {
        const signature = JSON.stringify({ ...item, viewers: undefined, image: undefined });
        const previous = screenCards.get(item.number);
        const node = previous?.signature === signature ? previous.node :
          card({ ...item, title: item.title || '방송 연결 대기' }, 'session');
        next.set(item.number, { signature, node });
        if (previous?.node === node) {
          const count = node.querySelector('.home-count');
          if (count) count.textContent = Number(item.viewers || 0).toLocaleString('ko-KR');
          const image = node.querySelector('.home-thumbnail');
          if (image && item.image) image.src = source(item.image);
        }
        return node;
      });
      screenCards = next;
      screenContent = content;
      const list = $('home-screens-list');
      const scroll = list.scrollLeft;

      for (let index = 0; index < cards.length; index++) {
        if (list.children[index] !== cards[index]) list.insertBefore(cards[index], list.children[index] || null);
      }
      while (list.children.length > cards.length) list.lastElementChild.remove();
      $('home-screens').hidden = !items.length;

      list.scrollLeft = scroll;
    } catch {
    } finally {
      loadingScreens = false;
    }
  };

  return {
    update(data) {
      home.hidden = Boolean(data.player);
      void screens();
      const current = data.player ? null : data.homeAccount || '';

      if (key === current) {
        return;
      }

      key = current;
      reset();

      if (home.hidden) {
        return;
      }

      const revision = version;

      status.textContent = '';
      void request('GET', undefined, '/api/home').then(result => {
        if (revision !== version) {
          return;
        }

        status.textContent = result.live.length ? '' : '방송 목록이 없습니다.';
        section('인기 LIVE', result.popular, 'live');
        if (result.personalized) section('추천 LIVE', result.live, 'live');
        section('관심 캐치 모아보기', result.catch, 'catch');
        section('관심 VOD', result.vod, 'vod');
        section(result.name ? `${result.name}님의 관심 스토리` : '관심 스토리', result.story, 'story');
      }).catch(error => {
        if (revision === version) {
          status.textContent = error.message;
          key = undefined;
        }
      });
    }
  };
}
