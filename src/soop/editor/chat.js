import { DOMAIN } from '/config.js';

const $ = id => document.getElementById(id);

function image(url, title = '') {
  if (!url) {
    return null;
  }

  let address;

  try {
    address = new URL(url, DOMAIN.play);
  } catch {
    return null;
  }

  if (address.protocol !== 'https:') {
    return null;
  }

  const img = document.createElement('img');

  img.src = address.href;
  img.alt = title;
  img.title = title;
  img.loading = 'lazy';
  img.addEventListener('error', () => img.remove());

  return img;
}

function content(node, message, emoticons = []) {
  const parts = String(message).split(/(\/[^/\s]+\/)/g);

  for (const part of parts) {
    const icon = emoticons.find(item => item.keyword === part);
    const img = icon && image(icon.smallUrl || icon.url, part);

    if (img) {
      img.className = 'chat-emote';
      node.append(img);
    }
    else {
      node.append(document.createTextNode(part));
    }
  }
}

function subscription(user) {
  const tier = user.tierName || (user.tier === 2 ? '플러스' : '베이직');

  return `${tier} | 누적 ${user.total || 0}개월`;
}

function identify(node, user) {
  if (user.tier) {
    const icon = image(user.tierUrl, subscription(user));

    if (icon) {
      icon.className = 'chat-tier';
      node.append(icon);
    }
  }

  const badges = { 스트리머: 'B', 매니저: 'M', 열혈: '♥', 팬: 'F', 운영자: 'S' };

  if (badges[user.role]) {
    const badge = document.createElement('span');

    badge.className = 'chat-badge';
    badge.title = user.role === '열혈' ? '열혈팬' : user.role;
    badge.textContent = badges[user.role];
    node.append(badge);
  }

  const name = document.createElement('b');

  name.textContent = user.name || user.id || '';
  node.append(name);
}

function announcement(entry) {
  if (entry.type === 'notice') {
    return true;
  }

  if (entry.type !== 'system') {
    return false;
  }

  const notice = entry.message.startsWith('[공지] ');
  const removed = entry.message === '공지가 삭제되었습니다.';

  return notice || removed;
}

export function createPreview(user, message, url, emoticons, gifts = []) {
  const fragment = document.createDocumentFragment();

  for (const gift of gifts) {
    const img = image(gift.url, gift.name);

    if (!img) {
      continue;
    }

    const node = document.createElement('article');

    node.className = 'chat-row chat-gift';
    img.className = 'chat-image';
    node.append(img);
    fragment.append(node);
  }

  const node = document.createElement('article');
  const identity = document.createElement('span');
  const text = document.createElement('span');

  node.className = url ? 'chat-row chat-ogq' : 'chat-row chat-chat';
  node.dataset.role = user.role || '';
  identity.className = 'chat-identity';
  identity.dataset.role = user.role || '';
  identify(identity, user);
  node.append(identity);

  const img = image(url);

  if (img) {
    img.className = 'chat-image';
    node.append(img);
  }

  text.className = 'chat-message';
  content(text, message, emoticons);
  node.append(text);
  fragment.append(node);

  return fragment;
}

export function createChat(token, inspect) {
  const seen = new Set();
  const users = new Map();
  const log = $('chat-log');
  const input = $('chat-input');
  const jump = $('chat-bottom');
  const preview = $('chat-latest');
  const video = $('video');
  const captions = [];
  const managers = new Set();
  const panel = $('chat-manager');
  const messages = $('chat-manager-log');
  const draft = $('chat-manager-input');
  let previous = '';
  let pending = false;
  let submitted = false;
  let loaded = false;
  let revision = 0;
  let state = {};
  let cursor = '';
  let loading = false;
  let person;
  let viewer;
  let target = '';
  let icons = [];
  let stickers = [];
  let sticker = null;
  let older = '';
  let streaming = false;
  let disconnected = false;
  let sending = false;
  let stopped = false;
  let channel = '';
  let controller;
  let agreed = '';
  let survey = null;
  let voting = false;
  let pinned = true;
  let offset = 0;
  let frame;

  const subtitle = () => {
    const caption = captions.findLast(item => {
      const elapsed = video.currentTime - item.time;

      return elapsed >= 0 && elapsed < 6;
    });
    const node = $('video-subtitle');

    node.textContent = caption?.message || '';
    node.hidden =
      !caption
      || video.paused
      || video.ended
      || state.subtitle === -1
      || $('captions').hidden;
  };

  for (const event of ['timeupdate', 'play', 'pause', 'seeked', 'ended']) {
    video.addEventListener(event, subtitle);
  }

  const rules = () => {
    if (!state.rule || agreed === state.rule) {
      return false;
    }

    if (!$('chat-rule').open) {
      input.blur();
      $('chat-rule').showModal();
    }

    return true;
  };

  const request = async (url, data) => {
    const options = { headers: { Authorization: `Bearer ${token()}` } };

    if (data) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || '채팅 요청 실패');
    }

    return result;
  };

  const bottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 4;

  const position = () => {
    jump.hidden = Boolean(state.poll) || bottom();

    if (jump.hidden) {
      preview.replaceChildren();
      jump.classList.remove('chat-unread');
    }
  };

  const follow = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      if (pinned) {
        log.scrollTop = log.scrollHeight;
        offset = log.scrollTop;
        position();
      }
    });
  };

  const observer = new window.ResizeObserver(follow);

  const unread = entry => {
    if (state.poll) {
      return;
    }

    preview.replaceChildren();

    if (entry.user) {
      const name = document.createElement('span');

      name.className = 'chat-identity';
      name.dataset.role = entry.user.role;
      identify(name, entry.user);
      preview.append(name);
    }

    const text = document.createElement('span');

    text.className = 'chat-snippet';
    content(text, entry.message, entry.emoticons);

    if (entry.image) {
      const img = image(entry.image);

      if (img) {
        img.className = 'chat-emote';
        text.prepend(img);
      }
    }

    preview.append(text);
    jump.classList.add('chat-unread');
  };

  const status = message => {
    if (!message) {
      return;
    }

    append({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      type: 'system',
      message
    });
  };

  const access = value => {
    const changed =
      state.manager !== value.manager
      || state.streamer !== value.streamer
      || state.login !== value.login;

    state = value;
    $('captions').classList.toggle('active', state.subtitle >= 0);
    $('captions').dataset.subtitle = state.subtitle ?? -1;
    $('subtitle-label').textContent = state.languages?.[state.subtitle]?.label || 'OFF';

    if (!$('subtitle-options').childElementCount && state.languages) {
      const languages = Object.entries(state.languages);

      languages.sort((first, second) => Number(first[0]) - Number(second[0]));

      for (const [index, language] of languages) {
        const button = document.createElement('button');

        button.type = 'button';
        button.dataset.subtitle = index;
        button.textContent = language.label;
        $('subtitle-options').append(button);
      }
    }

    for (const button of $('subtitle-options').children) {
      button.classList.toggle(
        'selected',
        Number(button.dataset.subtitle) === state.subtitle
      );
    }

    subtitle();
    $('chat-poll-open').hidden = !state.poll;
    position();

    if (survey !== state.poll?.surveyNo) {
      survey = null;

      if ($('chat-poll').open) {
        $('chat-poll').close();
      }
    }
    input.disabled = !state.login || !state.connected;
    $('chat-submit').disabled = input.disabled;
    $('chat-emoticon').disabled = !state.login;
    $('chat-icons-ogq').disabled = !state.login || Boolean(target);
    $('chat-manager-open').hidden = !state.manager;
    draft.disabled = !state.manager || !state.connected;
    $('chat-manager-submit').disabled = draft.disabled;

    if (!state.manager) {
      reset();
    }
    $('chat-whisper').disabled = !state.login;
    input.placeholder = state.login ? '채팅 입력' : '로그인이 필요합니다.';

    if (!state.login) {
      sticker = null;
      $('chat-sticker').hidden = true;
    }

    const notice = $('chat-notice');
    const content = $('chat-notice-content');
    const message = state.notice || '';

    if (content.textContent !== message) {
      const unread = Boolean(message) && notice.classList.contains('collapsed');

      notice.classList.toggle('unread', unread);
    }

    notice.hidden = !message;
    content.textContent = message;
    $('chat-rule-content').textContent = state.rule || '';

    if (!state.rule && $('chat-rule').open) {
      $('chat-rule').close();
    }

    if (changed && $('chat-person').open && person) {
      actions();
    }
  };

  const row = entry => {
    const node = document.createElement('article');

    node.className = `chat-row chat-${entry.type}`;
    node.dataset.id = entry.id;
    node.title = new Date(entry.date).toLocaleTimeString('ko-KR');

    if (entry.type === 'subtitle') {
      node.textContent = `[자막] ${entry.message}`;

      return node;
    }

    if (entry.type === 'system' && !entry.user?.id) {
      node.textContent = entry.message;

      return node;
    }

    const user = entry.user || {};
    const cached = users.get(user.id);

    if (cached && user.tier && !user.month) {
      Object.assign(user, cached);
    }

    node.dataset.role = user.role || '';

    if (entry.type === 'system') {
      const message = document.createElement('span');

      message.className = 'chat-message';
      message.dataset.role = user.role;
      message.dataset.user = user.id;
      message.dataset.tier = user.tier || 0;
      identify(message, user);
      content(message, entry.message, entry.emoticons);
      node.append(message);
      node.tabIndex = 0;
      node.addEventListener('click', () => void open(user));
      node.addEventListener('keydown', event => {
        if (event.target === node && ['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          void open(user);
        }
      });

      return node;
    }

    const identity = document.createElement('button');

    identity.type = 'button';
    identity.className = 'chat-identity';
    identity.dataset.role = user.role;
    identity.dataset.user = user.id;
    identity.dataset.tier = user.tier || 0;
    identify(identity, user);
    identity.addEventListener('click', () => void open(user));
    node.append(identity);

    if (entry.image) {
      const img = image(entry.image);

      if (img) {
        img.className = 'chat-image';

        if (entry.type === 'ogq') {
          const path = new URL(img.src).pathname.match(/^\/sticker\/([^/]+)\//);
          const id = entry.ogq || path?.[1];

          if (id) {
            const link = document.createElement('a');

            link.href = new URL(
              `/emoticon/${encodeURIComponent(id)}`,
              DOMAIN.market
            ).href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = '구매하기';
            img.title = '구매하기';
            link.append(img);
            node.append(link);
          }
          else {
            node.append(img);
          }
        }
        else {
          node.append(img);
        }
      }
    }

    const text = document.createElement('span');

    text.className = 'chat-message';
    content(text, entry.message, entry.emoticons);
    node.append(text);

    return node;
  };

  const reset = () => {
    revision++;
    panel.hidden = true;
    managers.clear();
    messages.replaceChildren();
    draft.value = '';
    previous = '';
    loaded = false;
    $('chat-manager-open').classList.remove('unread');
    $('chat-manager-status').hidden = true;
  };

  const receive = entry => {
    if (!state.manager || managers.has(entry.id)) {
      return;
    }

    const bottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 4;

    managers.add(entry.id);
    messages.append(row(entry));

    if (panel.hidden) {
      $('chat-manager-open').classList.add('unread');
    }
    else if (bottom) {
      messages.scrollTop = messages.scrollHeight;
    }
  };

  const records = async () => {
    if (pending || !state.manager || (loaded && !previous)) {
      return;
    }

    pending = true;

    const version = revision;
    const initial = !loaded;

    try {
      const params = new URLSearchParams({ type: 'manager', cursor: previous });
      const data = await request(`/api/chat?${params}`);

      if (version !== revision || !state.manager) {
        return;
      }

      const height = messages.scrollHeight;
      const fragment = document.createDocumentFragment();

      for (const entry of data.entries) {
        if (!managers.has(entry.id)) {
          managers.add(entry.id);
          fragment.append(row(entry));
        }
      }

      messages.prepend(fragment);
      messages.scrollTop = initial
        ? messages.scrollHeight
        : messages.scrollTop + messages.scrollHeight - height;
      previous = data.cursor;
      loaded = true;
    } catch (error) {
      if (version === revision) {
        $('chat-manager-status').textContent = error.message;
        $('chat-manager-status').hidden = false;
      }
    } finally {
      pending = false;
    }
  };

  const renew = user => {
    const data = {
      month: user.month,
      total: user.total,
      tierUrl: user.tierUrl,
      tierName: user.tierName
    };

    users.set(user.id, data);

    for (const identity of document.querySelectorAll('[data-user][data-tier]')) {
      if (identity.dataset.user !== user.id || identity.dataset.tier === '0') {
        continue;
      }

      const tier = identity.querySelector('.chat-tier');
      const icon = image(user.tierUrl, subscription(user));

      tier?.remove();

      if (icon) {
        icon.className = 'chat-tier';
        identity.prepend(icon);
      }
    }

    if (person?.id === user.id) {
      Object.assign(person, data);

      if ($('chat-person').open) {
        void open(person);
      }
    }
  };

  const append = entry => {
    if (seen.has(entry.id) || announcement(entry)) {
      return;
    }

    seen.add(entry.id);

    const node = row(entry);

    log.append(node);
    observer.observe(node);

    if (pinned) {
      log.scrollTop = log.scrollHeight;
      offset = log.scrollTop;
      follow();
    }
    else {
      unread(entry);
      position();
    }
  };

  const history = async initial => {
    if (loading || (!initial && !cursor)) {
      return;
    }

    loading = true;

    try {
      const params = new URLSearchParams({ cursor: initial ? '' : cursor });
      const data = await request(`/api/chat?${params}`);
      const height = log.scrollHeight;
      const existing = initial && log.children.length > 0;
      const fragment = document.createDocumentFragment();

      for (const entry of data.entries) {
        if (announcement(entry)) {
          continue;
        }

        if (existing) {
          append(entry);

          continue;
        }

        if (!seen.has(entry.id)) {
          const node = row(entry);

          seen.add(entry.id);
          fragment.append(node);
          observer.observe(node);
        }
      }

      log.prepend(fragment);
      if (!existing) {
        cursor = data.cursor;
      }
      access(data.state);

      if (initial && !existing) {
        pinned = true;
        log.scrollTop = log.scrollHeight;
        offset = log.scrollTop;
        follow();
      }
      else if (!initial) {
        log.scrollTop += log.scrollHeight - height;
        offset = log.scrollTop;
      }
    } catch (error) {
      status(error.message);
    } finally {
      loading = false;
    }
  };

  const collect = async initial => {
    const user = viewer;
    const params = new URLSearchParams({ user: user.id, cursor: initial ? '' : older });
    const data = await request(`/api/chat?${params}`);

    if (viewer !== user) {
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const entry of data.entries) {
      fragment.append(row(entry));
    }

    $('chat-history-log').prepend(fragment);
    older = data.cursor;
    $('chat-history-more').hidden = !older;
  };

  const button = (label, handler) => {
    const node = document.createElement('button');

    node.type = 'button';
    node.textContent = label;
    node.addEventListener('click', () => {
      Promise.resolve()
        .then(handler)
        .catch(error => status(error.message));
    });
    $('chat-person-actions').append(node);

    return node;
  };

  const actions = () => {
    $('chat-person-actions').replaceChildren();

    if (state.manager) {
      for (const [action, label] of [
        ['mute', '채팅 금지'],
        ['kick', '강제 퇴장'],
        ['black', '블랙리스트 추가']
      ]) {
        button(label, async () => {
          await request('/api/chat', { action, target: person.id });
          $('chat-person').close();
          status(`${label} 요청 완료`);
        });
      }

      $('chat-person-actions').append(document.createElement('hr'));
    }

    button('아이디 복사', async () => {
      await navigator.clipboard.writeText(person.id);
      $('chat-person').close();
    });

    if (state.manager && person.role === '매니저') {
      const node = button('매니저 해임', async () => {
        await request('/api/chat', { action: 'dismiss', target: person.id });
        $('chat-person').close();
        status('매니저 해임 요청 완료');
      });

      node.disabled = !state.streamer;
    }

    button('채팅 모아보기', async () => {
      viewer = person;
      $('chat-history-name').textContent = viewer.name;
      $('chat-history-name').href = $('chat-station').href;
      $('chat-history-station').href = $('chat-station').href;
      $('chat-history-avatar').hidden = !viewer.image;

      if (viewer.image) {
        $('chat-history-avatar').src = viewer.image;
      }
      else {
        $('chat-history-avatar').removeAttribute('src');
      }

      $('chat-person').close();
      $('chat-history-log').replaceChildren();
      $('chat-history').showModal();
      await collect(true);
    });

    const communication = button('소통', () => {
      $('chat-whisper').disabled = !state.login;
      $('chat-person').close();
      $('chat-communication').showModal();
    });

    communication.className = 'chat-forward';
  };

  const open = async user => {
    const cached = users.get(user.id);

    if (cached && user.tier) {
      Object.assign(user, cached);
    }

    person = user;
    $('chat-name').textContent = user.name;
    $('chat-id').textContent = user.id;

    const id = user.id.replace(/\(\d+\)$/, '');

    $('chat-station').href = new URL(
      `/station/${encodeURIComponent(id)}`,
      DOMAIN.soop
    ).href;
    $('chat-avatar').hidden = true;
    $('chat-avatar').removeAttribute('src');
    $('chat-subscription').hidden = !user.tier;
    $('chat-subscription').replaceChildren();

    if (user.tier) {
      const icon = image(user.tierUrl, subscription(user));

      if (icon) {
        $('chat-subscription').append(icon);
      }

      const name = user.tierName || (user.tier === 2 ? '플러스' : '베이직');

      $('chat-subscription').append(`${name} ${user.month || 0}개월 연속 구독 중`);
    }

    actions();

    if (!$('chat-person').open) {
      $('chat-person').showModal();
    }

    try {
      const data = await request(`/api/user?id=${encodeURIComponent(user.id)}`);
      const avatar = data.image && image(data.image);

      if (person === user && avatar) {
        user.image = avatar.src;
        $('chat-avatar').src = avatar.src;

        if (viewer === user && $('chat-history').open) {
          $('chat-history-avatar').src = avatar.src;
          $('chat-history-avatar').hidden = false;
        }
        $('chat-avatar').hidden = false;
      }
    } catch {}
  };

  const stream = async () => {
    if (streaming || stopped) {
      return;
    }

    streaming = true;
    controller = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        headers: { Authorization: `Bearer ${token()}`, Accept: 'text/event-stream' },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error('채팅 연결 실패');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      await history(true);
      previous = '';
      loaded = false;

      if (state.manager && !panel.hidden) {
        await records();
      }

      status('');

      while (true) {
        const chunk = await reader.read();

        if (chunk.done) {
          break;
        }

        buffer += decoder.decode(chunk.value, { stream: true });

        let boundary;

        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const packet = buffer.slice(0, boundary).split('\n');
          const event = packet.find(line => line.startsWith('event: '))?.slice(7);
          const source = packet.find(line => line.startsWith('data: '))?.slice(6);

          buffer = buffer.slice(boundary + 2);

          if (source) {
            const data = JSON.parse(source);

            disconnected = false;

            if (event === 'chat') {
              if (data.type === 'subtitle' && data.message) {
                captions.push({ time: video.currentTime, message: data.message });

                if (captions.length > 2000) {
                  captions.shift();
                }

                subtitle();
              }

              if (data.type === 'manager') {
                receive(data);
              }
              else {
                append(data);
              }
            }
            else if (event === 'user') {
              renew(data);
            }
            else if (event === 'state') {
              access(data);
            }
          }
        }
      }
    } catch {
    } finally {
      streaming = false;

      if (!stopped && !controller.signal.aborted && !disconnected) {
        disconnected = true;
        status('채팅 연결이 끊겼습니다.');
      }

      if (!stopped) {
        setTimeout(() => void start(), 2000);
      }
    }
  };

  const start = () => {
    void stream();
  };

  $('chat-manager-open').addEventListener('click', () => {
    panel.hidden = !panel.hidden;

    if (!panel.hidden) {
      $('chat-manager-open').classList.remove('unread');
      messages.scrollTop = messages.scrollHeight;
      void records();
      draft.focus();
    }
  });
  $('chat-manager-close').addEventListener('click', () => {
    panel.hidden = true;
  });
  messages.addEventListener('scroll', () => {
    if (messages.scrollTop < 100 && loaded) {
      void records();
    }
  });
  draft.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      panel.hidden = true;
    }
    else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('chat-manager-send').requestSubmit();
    }
  });
  $('chat-manager-send').addEventListener('submit', async event => {
    event.preventDefault();

    if (submitted || draft.disabled || !draft.value.trim()) {
      return;
    }

    submitted = true;

    const message = draft.value;
    const version = revision;

    try {
      await request('/api/chat', { action: 'manager', message });

      if (version === revision && draft.value === message) {
        draft.value = '';
      }

      $('chat-manager-status').hidden = true;
    } catch (error) {
      if (version === revision) {
        $('chat-manager-status').textContent = error.message;
        $('chat-manager-status').hidden = false;
      }
    } finally {
      submitted = false;
    }
  });
  $('chat-send').addEventListener('submit', async event => {
    event.preventDefault();

    if (sending || input.disabled || (!input.value.trim() && !sticker)) {
      return;
    }

    if (rules()) {
      return;
    }

    sending = true;

    const message = input.value;
    const selected = sticker;

    try {
      await request('/api/chat', {
        action: 'send',
        message,
        target,
        ogq: selected?.id,
        number: selected?.number
      });

      if (sticker === selected) {
        sticker = null;
        $('chat-sticker').hidden = true;
      }

      if (input.value === message) {
        input.value = '';
      }

      status('');
    } catch (error) {
      status(error.message);
    } finally {
      sending = false;
    }
  });
  input.addEventListener('focus', rules);
  $('chat-rule-agree').addEventListener('click', () => {
    agreed = state.rule;
    $('chat-rule').close();
    input.focus();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('chat-send').requestSubmit();
    }
  });
  $('chat-target').addEventListener('click', () => {
    target = '';
    $('chat-target').hidden = true;
  });
  $('chat-bottom').addEventListener('click', () => {
    pinned = true;
    log.scrollTop = log.scrollHeight;
    offset = log.scrollTop;
    position();
  });
  log.addEventListener('scroll', () => {
    if (bottom()) {
      pinned = true;
    }
    else if (!loading && log.scrollTop < offset) {
      pinned = false;
    }

    offset = log.scrollTop;

    if (log.scrollTop < 100) {
      void history(false);
    }

    position();
  });
  for (const panel of document.querySelectorAll('.chat-pinned details')) {
    const body = panel.querySelector('.chat-panel-body');

    panel.classList.toggle('collapsed', !panel.open);
    panel.querySelector('summary').addEventListener('click', event => {
      event.preventDefault();

      const expanded = panel.classList.contains('collapsed');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (expanded) {
        panel.open = true;
        panel.classList.remove('unread');
        body.getBoundingClientRect();
      }

      panel.classList.toggle('collapsed', !expanded);

      if (!expanded && reduced) {
        panel.open = false;
      }
    });
    body.addEventListener('transitionend', event => {
      if (
        event.propertyName === 'grid-template-rows'
        && panel.classList.contains('collapsed')
      ) {
        panel.open = false;
      }
    });
  }

  $('chat-poll-open').addEventListener('click', async () => {
    const poll = state.poll;

    if (!poll) {
      return;
    }

    try {
      const data = await request('/api/poll');

      if (state.poll?.surveyNo !== poll.surveyNo) {
        return;
      }

      survey = data.survey;
      $('chat-poll-title').textContent = data.title || '';
      $('chat-poll-status').textContent = '';
      $('chat-poll-list').replaceChildren();
      $('chat-poll-submit').disabled = true;

      for (const item of data.list || []) {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        const text = document.createElement('span');

        radio.type = 'radio';
        radio.name = 'answer';
        radio.value = item.answer_no;
        radio.disabled = !state.login;
        text.textContent = item.answer_title || '';
        radio.addEventListener('change', () => {
          $('chat-poll-submit').disabled = voting || !state.login;
        });
        label.append(radio, text);
        $('chat-poll-list').append(label);
      }

      if (!$('chat-poll').open) {
        $('chat-poll').showModal();
      }
    } catch (error) {
      status(error.message);
    }
  });
  $('chat-poll-form').addEventListener('submit', async event => {
    event.preventDefault();

    const selected = $('chat-poll-list').querySelector('input:checked');

    if (voting || !selected || !state.login || survey !== state.poll?.surveyNo) {
      return;
    }

    voting = true;
    $('chat-poll-submit').disabled = true;

    try {
      await request('/api/poll', { survey, answer: Number(selected.value) });
      $('chat-poll-status').textContent = '투표가 완료되었습니다.';
    } catch (error) {
      $('chat-poll-status').textContent = error.message;
      $('chat-poll-submit').disabled = !state.login;
    } finally {
      voting = false;
    }
  });
  $('chat-poll-cancel').addEventListener('click', () => $('chat-poll').close());
  $('chat-communication-back').addEventListener('click', () => {
    $('chat-communication').close();
    void open(person);
  });
  $('chat-whisper').addEventListener('click', () => {
    target = person.id;
    sticker = null;
    $('chat-sticker').hidden = true;
    $('chat-target').textContent = `${person.name}에게 귓속말 ×`;
    $('chat-target').hidden = false;
    $('chat-communication').close();
    input.focus();
  });
  $('chat-history-information').addEventListener('click', async () => {
    const user = viewer;

    try {
      const id = encodeURIComponent(user.id);
      const data = await request(`/api/user?id=${id}&details=1`);

      if (viewer === user && $('chat-history').open) {
        inspect(data.profile);
      }
    } catch (error) {
      status(error.message);
    }
  });
  $('chat-history-more').addEventListener('click', () => {
    collect(false).catch(error => status(error.message));
  });

  const picker = ogq => {
    $('chat-icons-list').hidden = ogq;
    $('chat-ogq').hidden = !ogq;
    $('chat-icons-emoticon').classList.toggle('selected', !ogq);
    $('chat-icons-ogq').classList.toggle('selected', ogq);
  };

  const gallery = pack => {
    $('chat-ogq-list').replaceChildren();

    for (const [index, url] of pack.images.entries()) {
      const img = image(url, `${pack.name} ${index + 1}`);

      if (!img) {
        continue;
      }

      const button = document.createElement('button');

      button.type = 'button';
      button.title = img.title;
      button.append(img);
      button.addEventListener('click', () => {
        sticker = { id: pack.id, number: index + 1 };
        $('chat-sticker-image').src = url;
        $('chat-sticker-image').alt = button.title;
        $('chat-sticker').hidden = false;
        $('chat-icons').close();
        input.focus();
      });
      $('chat-ogq-list').append(button);
    }
  };

  $('chat-sticker').addEventListener('click', () => {
    sticker = null;
    $('chat-sticker').hidden = true;
    input.focus();
  });
  $('chat-icons-emoticon').addEventListener('click', () => picker(false));
  $('chat-icons-ogq').addEventListener('click', () => {
    if (target) {
      return;
    }

    picker(true);
    $('chat-ogq-packs').replaceChildren();
    $('chat-ogq-list').replaceChildren();

    for (const pack of stickers) {
      const img = image(pack.images[0], pack.name);

      if (!img) {
        continue;
      }

      const button = document.createElement('button');

      button.type = 'button';
      button.title = pack.name;
      button.append(img);
      button.addEventListener('click', () => {
        for (const item of $('chat-ogq-packs').children) {
          item.classList.toggle('selected', item === button);
        }

        gallery(pack);
      });
      $('chat-ogq-packs').append(button);
    }

    if (stickers.length) {
      $('chat-ogq-packs').firstElementChild?.classList.add('selected');
      gallery(stickers[0]);
    }
  });
  $('chat-emoticon').addEventListener('click', () => {
    picker(false);
    $('chat-icons-ogq').disabled = Boolean(target);
    $('chat-icons-list').replaceChildren();

    for (const icon of icons) {
      const img = image(icon.smallUrl || icon.url, icon.keyword);

      if (!img) {
        continue;
      }

      const node = document.createElement('button');

      node.type = 'button';
      node.title = icon.keyword;
      node.append(img);
      node.addEventListener('click', () => {
        input.setRangeText(icon.keyword, input.selectionStart, input.selectionEnd, 'end');
        $('chat-icons').close();
        input.focus();
      });
      $('chat-icons-list').append(node);
    }

    $('chat-icons').showModal();
  });

  for (const id of [
    'chat-person',
    'chat-icons',
    'chat-history',
    'chat-communication',
    'chat-rule',
    'chat-poll'
  ]) {
    $(id + '-close').addEventListener('click', () => $(id).close());
    $(id).addEventListener('click', event => {
      if (event.target !== $(id)) {
        return;
      }

      const bounds = $(id).getBoundingClientRect();
      const outside =
        event.clientX < bounds.left
        || event.clientX > bounds.right
        || event.clientY < bounds.top
        || event.clientY > bounds.bottom;

      if (outside) {
        $(id).close();
      }
    });
  }

  window.addEventListener('pagehide', () => {
    stopped = true;
    observer.disconnect();
    window.cancelAnimationFrame(frame);
    controller?.abort();
  });

  return {
    system: status,
    support(supported) {
      for (const id of ['captions', 'settings', 'subtitle-settings']) {
        $(id).hidden = !supported;
      }

      if (!supported) {
        $('settings-menu').hidden = true;
        $('subtitle-menu').hidden = true;
        captions.length = 0;
      }

      subtitle();
    },
    update(data) {
      icons = data.emoticons || [];
      stickers = data.packs || [];
      $('conversation').hidden = !data.player;
      $('chat-rule-name').textContent = `${data.name || data.player || ''}님의`;
      $('chat-rule-avatar').hidden = !data.profile?.image;

      if (data.profile?.image) {
        $('chat-rule-avatar').src = data.profile.image;
      }

      if (channel !== data.player) {
        const notice = $('chat-notice');

        notice.open = false;
        notice.classList.add('collapsed');
        notice.classList.remove('unread');
        $('chat-notice-content').textContent = '';

        this.support(false);
        channel = data.player;
        agreed = '';
        captions.length = 0;
        subtitle();
        reset();
        seen.clear();
        users.clear();
        observer.disconnect();
        window.cancelAnimationFrame(frame);
        pinned = true;
        offset = 0;
        log.replaceChildren();
        position();
        cursor = '';
        target = '';
        sticker = null;
        $('chat-sticker').hidden = true;
        $('chat-target').hidden = true;
        controller?.abort();
        void start();
      }
    }
  };
}
