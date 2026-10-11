import { DOMAIN } from '/config.js';
import { drag } from './scroll.js';

export function createSearch(request, select, profile, preview) {
  const $ = id => document.getElementById(id);
  const input = $('search-input');
  const panel = $('search-panel');
  const list = $('search-results');
  const message = $('search-status');
  const container = input.closest('.search');
  const suggestions = $('search-suggestions');
  let keyword = '';
  let timer;
  let version = 0;
  let page = 1;
  let type = 'all';
  let more = false;
  let loading = false;
  let switching = false;
  let scroll = 0;
  const base = location.pathname.replace(/\/search\/?$/, '/') || '/';
  const route = () => {
    const url = new URL(location.href);
    url.pathname = `${base.replace(/\/$/, '')}/search`;
    url.search = new URLSearchParams({ szLocation: 'total_search',
      szSearchType: ({ all: 'total', live: 'live', vod: 'vod', post: 'post', streamer: 'bj' })[type],
      szKeyword: keyword, szStype: 'di', szActype: 'input_field' });
    history.replaceState(history.state, '', url);
  };
  const node = (tag, className, text = '') => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  const picture = (element, src, className, title = '') => {
    if (!src) return;
    let url;
    try { url = new URL(src, DOMAIN.soop); } catch { return; }
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return;
    const image = node('img', className);
    image.src = url.href;
    image.alt = title;
    image.title = title;
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove());
    element.append(image);
  };
  const personButton = user => {
    const button = node('button', 'search-person');
    button.type = 'button';
    picture(button, user.image || user.profile, 'search-avatar');
    button.append(node('b', '', user.name || user.id || ''));
    const names = { silver: '실버', gold: '골드', platinum: '플래티넘', emerald: '에메랄드', diamond: '다이아', prestige: '프레스티지' };
    const grade = String(user.emblemGrade || '').toLowerCase();
    const level = String(user.emblemLevel || '').toLowerCase();
    let name = names[grade] || '';
    if (name && grade !== 'prestige' && ['lv1', 'lv2', 'lv3'].includes(level)) name += level.slice(2);
    picture(button, user.emblem, 'search-medal', name);
    if (user.subscribed) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS(icon.namespaceURI, 'title');
      const circle = document.createElementNS(icon.namespaceURI, 'circle');
      const cup = document.createElementNS(icon.namespaceURI, 'path');
      const star = document.createElementNS(icon.namespaceURI, 'path');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.classList.add('search-subscription');
      title.textContent = '구독';
      for (const [key, value] of Object.entries({ cx: 12, cy: 12, r: 12, fill: '#ef565f' })) circle.setAttribute(key, value);
      cup.setAttribute('d', 'M5 6h12v7a6 6 0 0 1-12 0V6Zm12 2h1a3 3 0 0 1 0 6h-1');
      cup.setAttribute('fill', '#fff');
      cup.setAttribute('stroke', '#fff');
      cup.setAttribute('stroke-linejoin', 'round');
      star.setAttribute('d', 'm11 8 1.2 2.4 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4Z');
      star.setAttribute('fill', '#ef565f');
      icon.append(title, circle, cup, star);
      button.append(icon);
    }
    if (user.fan) {
      const badge = node('span', 'search-fan', 'F');
      badge.title = '팬클럽';
      button.append(badge);
    }
    button.addEventListener('click', () => void profile({ id: String(user.id || user.userId), name: user.name, role: '스트리머' }));
    return button;
  };
  const close = () => {
    const results = document.body.classList.contains('searching');
    clearTimeout(timer);
    version++;
    loading = false;
    panel.hidden = true;
    panel.classList.remove('results');
    document.body.classList.remove('searching');
    if (results) window.scrollTo(0, scroll);
    if (/\/search\/?$/.test(location.pathname)) {
      history.replaceState(history.state, '', base);
    }
    input.blur();
  };
  const connect = async item => {
    if (switching) return;
    switching = true;
    try { if (await select(item)) close(); }
    catch (error) { message.textContent = error.message; }
    finally { switching = false; }
  };
  const external = (tag, className, url, text = '') => {
    const link = node(tag, className, text);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  };
  const video = (item, story = false, compact = false) => {
    const article = node('article', `search-video${story ? ' story' : ''}${compact ? ' compact' : ''}`);
    const live = item.live || Boolean(item.number);
    const link = live ? node('button', 'search-cover') : external('a', 'search-cover', item.url);
    if (live) { link.type = 'button'; link.addEventListener('click', () => void connect(item)); }
    const thumbnail = live ? new URL(`/m/${item.number}`, DOMAIN.thumbnail).href : story ? item.vertical || item.image : item.image;
    picture(link, thumbnail, 'search-thumbnail');
    if (live && !item.password) preview(link, item.id || item.userId);
    else if (!live && item.id) preview(link, item.id, 'vod');
    link.append(node('span', `search-label${live ? ' live' : ''}`, live
      ? Number(item.viewers || 0).toLocaleString('ko-KR')
      : story ? '스토리' : item.type === 'CLIP' && item.originalName ? item.originalName
        : ({REVIEW: '다시보기', CLIP: '클립', CATCH: '캐치', CATCH_STORY: '스토리', NORMAL: '업로드 VOD'})[item.type] || 'VOD'));
    if (item.duration && !story) link.append(node('span', 'search-duration', item.duration));
    const details = node('div', 'search-video-details');
    const id = item.userId || item.id;
    if (id) details.append(personButton({ ...item, id, name: item.name, image: new URL(`/LOGO/${id.slice(0, 2)}/${encodeURIComponent(id)}/${encodeURIComponent(id)}.jpg`, 'https://profile.img.sooplive.com').href }));
    if (!story) {
      const title = live ? node('button', 'search-video-title', item.title) : external('a', 'search-video-title', item.url, item.title);
      if (live) { title.type = 'button'; title.addEventListener('click', () => void connect(item)); }
      details.append(title, node('p', 'search-meta', live ? `${Number(item.viewers || 0).toLocaleString('ko-KR')}명 시청 중` : `조회수 ${Number(item.views || 0).toLocaleString('ko-KR')}  ${item.date?.slice(0, 10) || ''}`));
      const tags = node('div', 'search-tags');
      if (item.drops) tags.append(node('span', 'drops', '드롭스'));
      for (const value of [...item.languages || [], ...item.categories || [], ...item.tags || []]) tags.append(node('span', '', value));
      details.append(tags);
    }
    article.append(link, details);
    return article;
  };
  const person = (user, featured = false) => {
    const article = node('article', featured ? 'search-featured' : 'search-streamer');
    const button = personButton(user);
    const details = node('div', 'search-person-details');
    details.append(node('span', 'search-meta', `애청자 ${Number(user.favorites || 0).toLocaleString('ko-KR')}명`));
    if (user.notice) details.append(external('a', 'search-notice', user.noticeUrl, `공지  ${user.notice}`));
    picture(button, user.medal, 'search-medal');
    if (user.medals?.length) {
      const medals = node('div', 'search-medals');
      medals.append(node('span', 'search-meta', '메달'));
      for (const medal of user.medals.slice(0, 5)) {
        const badge = node('button', 'search-medal-button');
        badge.type = 'button';
        picture(badge, medal.image, 'search-medal', medal.name);
        badge.addEventListener('click', () => showMedals(user.medals));
        medals.append(badge);
      }
      if (user.medals.length > 5) {
        const more = node('button', 'search-medal-more');
        more.type = 'button';
        more.title = '메달 더보기';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const line = document.createElementNS(icon.namespaceURI, 'path');
        icon.setAttribute('viewBox', '0 0 24 24');
        line.setAttribute('d', 'M12 5v14M5 12h14');
        icon.append(line);
        more.append(icon);
        more.addEventListener('click', () => showMedals(user.medals));
        medals.append(more);
      }
      details.append(medals);
    }
    if (Number.isFinite(user.participants)) {
      details.append(node('span', 'search-meta', `누적 참여자 ${user.participants.toLocaleString('ko-KR')}명`));
    }
    article.append(button, details);
    return article;
  };
  const showMedals = medals => {
    const items = $('search-medal-items');
    items.replaceChildren();
    for (const medal of medals) {
      const item = node('div', 'search-medal-item');
      const details = node('div', '');
      picture(item, medal.image, 'search-medal', medal.name);
      details.append(node('b', '', medal.name), node('p', 'search-meta', medal.description));
      item.append(details);
      items.append(item);
    }
    $('search-medal-dialog').showModal();
  };
  $('search-medal-close').addEventListener('click', () => $('search-medal-dialog').close());
  const decorateMore = button => {
    button.classList.add('home-more');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrow.setAttribute('viewBox', '0 0 16 16');
    line.setAttribute('d', 'm3 6 5 5 5-5');
    arrow.append(line);
    button.append(arrow);
  };
  const section = (title, items, render, horizontal = false, tab = '') => {
    if (!items.length) return;
    const existing = type !== 'all' && list.querySelector('.search-section > div');
    if (existing) {
      for (const item of items) existing.append(render(item));
      return;
    }
    const group = node('section', 'search-section');
    if (title) group.append(node('h2', '', title));
    const rows = node('div', horizontal ? 'search-row' : 'search-column');
    if (horizontal) drag(rows);
    for (const item of items) rows.append(render(item));
    group.append(rows);
    if (tab && type === 'all') {
      const button = node('button', 'search-section-more', '더 보기');
      decorateMore(button);
      button.type = 'button';
      button.addEventListener('click', () => change(tab));
      group.append(button);
    }
    list.append(group);
  };
  const render = data => {
    section('', data.profiles || [], item => person(item, true));
    if (type === 'all' && data.profiles?.length) {
      section('', [...(data.live || []), ...(data.latest || [])], item => video(item), true);
    } else {
      section('LIVE', type === 'all' ? (data.live || []).slice(0, 6) : data.live || [], item => video(item), true, 'live');
    }
    if (type === 'all') {
      section('', data.banners || [], item => {
        const banner = node('div', 'search-banner');
        picture(banner, item.image, '');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        for (const area of item.links || []) {
          const link = document.createElementNS(svg.namespaceURI, 'a');
          const title = document.createElementNS(svg.namespaceURI, 'title');
          const rect = document.createElementNS(svg.namespaceURI, 'rect');
          link.setAttribute('href', area.url);
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
          title.textContent = area.title;
          for (const [name, value] of Object.entries({ x: area.left, y: area.top, width: area.width, height: area.height })) {
            rect.setAttribute(name, String(value));
          }
          link.append(title, rect);
          svg.append(link);
        }
        if (svg.childElementCount) banner.append(svg);
        return banner;
      });
      section('관련 콘텐츠', data.related || [], item => item.kind === 'streamer' ? person(item) : video(item), true);
      section('캐치 스토리', data.stories || [], item => video(item, true), true);
    }
    section('VOD', data.vod || [], item => video(item, false, true), false, 'vod');
    section('게시글', data.posts || [], item => {
      const article = node('article', 'search-post');
      article.append(personButton({ ...item, id: item.userId, name: item.name, image: item.profile }));
      const link = external('a', 'search-post-content', item.url);
      const details = node('div', '');
      details.append(node('b', '', item.title), node('p', 'search-excerpt', item.content));
      link.append(details);
      picture(link, item.image, 'search-post-image');
      article.append(link, node('p', 'search-meta', `조회수 ${Number(item.views).toLocaleString('ko-KR')}  ${item.date}`));
      return article;
    }, false, 'post');
    section('스트리머', data.streamers || [], item => person(item), false, 'streamer');
  };
  const find = async initial => {
    if (switching || !initial && (loading || !more)) return;
    if (initial) { version++; page = 1; more = false; list.replaceChildren(); }
    if (!keyword) { close(); return; }
    const current = version;
    loading = true;
    panel.hidden = false;
    panel.classList.add('results');
    if (!document.body.classList.contains('searching')) scroll = window.scrollY;
    document.body.classList.add('searching');
    if (initial) window.scrollTo(0, 0);
    $('search-more').hidden = true;
    message.textContent = '';
    try {
      const params = new URLSearchParams({query: keyword, page, type});
      const data = await request('GET', undefined, `/api/search?${params}`);
      if (current !== version) return;
      render(data);
      route();
      page++;
      more = data.more;
      $('search-more').hidden = !more;
      message.textContent = list.childElementCount ? '' : '검색 결과 없음';
    } catch (error) { if (current === version) message.textContent = error.message; }
    finally { if (current === version) loading = false; }
  };
  const change = value => {
    type = value;
    for (const button of $('search-tabs').children) button.classList.toggle('selected', button.dataset.type === type);
    void find(true);
  };
  const open = value => {
    clearTimeout(timer);
    keyword = value;
    input.value = value;
    suggestions.replaceChildren();
    change('all');
    input.blur();
  };
  const suggest = async () => {
    const value = input.value.trim();
    if (!value) { close(); return; }
    const current = ++version;
    panel.classList.remove('results');
    document.body.classList.remove('searching');
    suggestions.replaceChildren();
    panel.hidden = true;
    message.textContent = '';
    try {
      const params = new URLSearchParams({query: value, type: 'suggest'});
      const data = await request('GET', undefined, `/api/search?${params}`);
      if (current !== version) return;
      for (const user of data.items || []) {
        const button = node('button', 'search-suggestion');
        button.type = 'button';
        picture(button, user.image, 'search-avatar');
        const details = node('div', '');
        details.append(node('b', '', user.name));
        if (user.title) details.append(node('span', 'search-suggestion-title', user.title));
        button.append(details);
        if (user.live) button.append(node('span', 'search-suggestion-live', 'LIVE'));
        button.addEventListener('click', () => open(user.name || user.id));
        suggestions.append(button);
      }
      panel.hidden = !suggestions.childElementCount;
    } catch (error) {
      if (current === version) {
        message.textContent = error.message;
        panel.hidden = false;
      }
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    version++;
    if (!panel.classList.contains('results')) panel.hidden = true;
    timer = setTimeout(suggest, 350);
  });
  $('search-form').addEventListener('submit', event => {
    event.preventDefault();
    open(input.value.trim());
  });
  $('search-tabs').addEventListener('click', event => { const button = event.target.closest('button[data-type]'); if (button) change(button.dataset.type); });
  drag($('search-tabs'));
  $('search-more').addEventListener('click', () => void find(false));
  decorateMore($('search-more'));
  document.addEventListener('click', event => {
    if (!panel.classList.contains('results') && !container.contains(event.target)) close();
  });
  container.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  container.addEventListener('popupclose', close);
  const restore = () => {
    if (!/\/search\/?$/.test(location.pathname)) return;
    const params = new URLSearchParams(location.search);
    keyword = params.get('szKeyword') || '';
    input.value = keyword;
    change(({ total: 'all', live: 'live', vod: 'vod', post: 'post', bj: 'streamer' })[params.get('szSearchType')] || 'all');
  };
  container.addEventListener('popuprestore', restore);
  if (/\/search\/?$/.test(location.pathname)) {
    const url = location.href;
    history.replaceState(history.state, '', base);
    const params = new URL(url).searchParams;
    keyword = params.get('szKeyword') || '';
    input.value = keyword;
    change(({ total: 'all', live: 'live', vod: 'vod', post: 'post', bj: 'streamer' })[params.get('szSearchType')] || 'all');
  }
}
