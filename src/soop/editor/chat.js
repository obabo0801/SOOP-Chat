import { DOMAIN } from '/config.js';

let popup;

const $ = id => document.getElementById(id) || popup?.document.getElementById(id);

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

function content(node, message, emoticons = [], enabled = true) {
  const parts = String(message).split(/(\/[^/\s]+\/)/g);

  for (const part of parts) {
    const icon = enabled && emoticons.find(item => item.keyword === part);
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

function notification(node, message, emoticons) {
  const text = String(message);
  const match = text.match(/채팅금지 횟수 초과|채팅 금지|강제 퇴장|블랙리스트/);

  if (!match) {
    content(node, text, emoticons);

    return;
  }

  const warning = document.createElement('strong');

  warning.className = 'chat-warning';
  warning.textContent = match[0];
  content(node, text.slice(0, match.index), emoticons);
  node.append(warning);
  content(node, text.slice(match.index + match[0].length), emoticons);
}

function donation(node, message, emoticons) {
  const text = String(message);
  const match = text.match(/[\d,]+(?=개|개월)/);

  if (!match) {
    content(node, text, emoticons);

    return;
  }

  const count = document.createElement('strong');

  count.className = 'chat-count';
  count.textContent = match[0];
  content(node, text.slice(0, match.index), emoticons);
  node.append(count);
  content(node, text.slice(match.index + match[0].length), emoticons);
}

function subscription(user) {
  const tier = user.tierName || (user.tier === 2 ? '플러스' : '베이직');

  return `${tier} | 누적 ${user.total || 0}개월`;
}

function day(date) {
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function divider(node, previous) {
  const date = node.dataset.date;

  if (!date || date === previous?.dataset.date) {
    return null;
  }

  const line = document.createElement('div');
  const today = new Date();
  const yesterday = new Date(today);

  yesterday.setDate(yesterday.getDate() - 1);

  line.className = 'chat-date';
  line.textContent = date;

  if (date === day(today)) {
    line.textContent = '오늘';
  }
  else if (date === day(yesterday)) {
    line.textContent = '어제';
  }

  return line;
}

function dates(log) {
  for (const line of log.querySelectorAll('.chat-date')) {
    line.remove();
  }

  let previous;

  for (const node of log.querySelectorAll('.chat-row:not([hidden])')) {
    const line = divider(node, previous);

    if (line) {
      node.before(line);
    }

    previous = node;
  }
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
  const compose = $('chat-compose');
  const jump = $('chat-bottom');
  const preview = $('chat-latest');
  const video = $('video');
  const captions = [];
  const managers = new Set();
  const panel = $('chat-manager');
  const messages = $('chat-manager-log');
  const draft = $('chat-manager-input');
  const entries = new WeakMap();
  const settings = { emotes: true, motion: true, small: false, entry: true, size: 2 };
  let cleared = 0;
  let translating = false;
  let queue = Promise.resolve();
  let queued = 0;
  let caret = 0;
  let composing = false;
  let previous = '';
  let pending = false;
  let submitted = false;
  let loaded = false;
  let revision = 0;
  let state = {};
  let cursor = '';
  let loading = false;
  let epoch = 0;
  let person;
  let viewer;
  let target = '';
  let icons = [];
  let stickers = [];
  let sticker = null;
  let older = '';
  let collection = 0;
  let collecting = false;
  let searching = false;
  let search = 0;
  let kicks = 0;
  let members = 0;
  let listing = false;
  let memberCursor = '';
  let memberRole = '';
  let memberQuery = '';
  let memberTimer;
  let continuation = '';
  let query;
  let streaming = false;
  let disconnected = false;
  let sending = false;
  let stopped = false;
  let channel = '';
  let controller;
  let agreed = '';
  let dismissed = false;
  let survey = null;
  let voting = false;
  let pinned = true;
  let offset = 0;
  let frame;
  const commands = [
    ['/지우기', '채팅 지우기'],
    ['/닉네임', '닉네임 변경'],
    ['/귓속말', '아이디 내용'],
    ['/매니저', '매니저 채팅 내용'],
    ['/채금', '아이디'],
    ['/강퇴', '아이디'],
    ['/강퇴취소', '아이디'],
    ['/번역', '번역할 내용'],
    ['/크기', '1 ~ 5'],
    ['/팝업', '채팅 팝업'],
    ['/멀티', '멀티 모드'],
    ['/도움말', '명령어 목록']
  ];
  const suggestions = document.createElement('div');

  suggestions.id = 'chat-commands';
  suggestions.hidden = true;
  $('chat-send').after(suggestions);

  const commandList = () => {
    const value = input.value.trimStart();
    const keyword = value.split(/\s/)[0];
    const emoticon = icons.some(icon => value.startsWith(icon.keyword));

    suggestions.replaceChildren();
    suggestions.hidden = !value.startsWith('/') || emoticon || /\s/.test(value);

    if (suggestions.hidden) {
      return;
    }

    for (const [name, label] of commands.filter(([name]) => name.startsWith(keyword))) {
      const button = document.createElement('button');

      button.type = 'button';
      button.textContent = `${name}  ${label}`;
      button.addEventListener('click', () => {
        input.value = `${name} `;
        caret = input.value.length;
        render(true);
      });
      suggestions.append(button);
    }

    if (!suggestions.children.length) {
      suggestions.textContent = '지원하지 않는 명령어입니다.';
    }
  };

  try {
    const saved = JSON.parse(window.localStorage.getItem('chat-display') || '{}');

    for (const key of ['emotes', 'motion', 'small', 'entry']) {
      if (typeof saved[key] === 'boolean') {
        settings[key] = saved[key];
      }
    }

    if (Number.isInteger(saved.size) && saved.size >= 1 && saved.size <= 5) {
      settings.size = saved.size;
    }
  } catch {}

  const text = node => {
    if (node.nodeType === window.Node.TEXT_NODE) {
      return node.textContent;
    }

    if (node.nodeName === 'IMG') {
      return node.alt;
    }

    if (node.nodeName === 'BR') {
      return node.dataset.tail ? '' : '\n';
    }

    const value = [...node.childNodes].map(text).join('');

    return value;
  };

  const selection = () => {
    const selected = compose.ownerDocument.getSelection();

    if (!selected.rangeCount || !compose.contains(selected.anchorNode)) {
      return null;
    }

    const range = selected.getRangeAt(0);
    const before = range.cloneRange();

    before.selectNodeContents(compose);
    before.setEnd(range.startContainer, range.startOffset);
    caret = text(before.cloneContents()).length;

    return range;
  };

  const render = (focus = false) => {
    compose.replaceChildren();

    const parts = input.value.split(/(\/[^/\s]+\/)/g);

    for (const part of parts) {
      const icon = icons.find(item => item.keyword === part);
      const url = icon?.smallUrl || icon?.url;

      if (!url || !url.startsWith('https://')) {
        compose.append(document.createTextNode(part));
        continue;
      }

      const img = document.createElement('img');

      img.src = url;
      img.alt = part;
      img.title = part;
      img.className = 'chat-emote';
      img.contentEditable = 'false';
      compose.append(img);
    }

    if (input.value.endsWith('\n')) {
      const tail = document.createElement('br');

      tail.dataset.tail = 'true';
      compose.append(tail);
    }

    commandList();

    if (!focus) {
      return;
    }

    const selected = compose.ownerDocument.getSelection();
    const range = document.createRange();
    let offset = Math.min(caret, input.value.length);

    range.selectNodeContents(compose);
    range.collapse(false);

    for (const node of compose.childNodes) {
      const length = text(node).length;

      if (offset <= length) {
        if (node.nodeType === window.Node.TEXT_NODE) {
          range.setStart(node, offset);
        }
        else if (offset === 0) {
          range.setStartBefore(node);
        }
        else {
          range.setStartAfter(node);
        }

        range.collapse(true);
        break;
      }

      offset -= length;
    }

    compose.focus();
    selected.removeAllRanges();
    selected.addRange(range);
  };

  const insert = (value, focus = true) => {
    const range = selection();
    const end = caret + (range ? text(range.cloneContents()).length : 0);

    input.value = input.value.slice(0, caret) + value + input.value.slice(end);
    caret += value.length;
    render(focus);
  };

  const inline = () => {
    input.value = text(compose);
    selection();
    commandList();

    if (composing) {
      return;
    }

    const expected = [...input.value.matchAll(/\/[^/\s]+\//g)]
      .map(match => match[0])
      .filter(keyword => icons.some(icon => icon.keyword === keyword));
    const current = [...compose.querySelectorAll('img')].map(img => img.alt);

    if (JSON.stringify(expected) !== JSON.stringify(current)) {
      render(true);
    }
  };

  compose.addEventListener('input', inline);
  compose.addEventListener('compositionstart', () => {
    composing = true;
  });
  compose.addEventListener('compositionend', () => {
    composing = false;
    inline();
  });
  compose.addEventListener('paste', event => {
    event.preventDefault();
    insert(event.clipboardData.getData('text/plain').replace(/\r\n/g, '\n'));
  });
  for (const type of ['copy', 'cut']) {
    compose.addEventListener(type, event => {
      const range = selection();

      if (!range || range.collapsed) {
        return;
      }

      event.preventDefault();
      event.clipboardData.setData('text/plain', text(range.cloneContents()));

      if (type === 'cut') {
        insert('');
      }
    });
  }
  document.addEventListener('selectionchange', selection);

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
    if (!state.login) {
      return false;
    }

    if (dismissed) {
      dismissed = false;

      return false;
    }

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
    content(text, entry.heading || entry.message, entry.emoticons);

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

  const status = (message, error = true) => {
    if (!message) {
      return;
    }

    append({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      type: error ? 'error' : 'system',
      message
    });
  };

  const freezing = () => {
    const grades = $('chat-grades').querySelectorAll('input');

    grades[0].disabled = true;
    grades[5].disabled = !state.streamer;
    $('chat-freeze-count').disabled = !state.streamer || !grades[1].checked;
    $('chat-freeze-month').disabled = !state.streamer || !grades[4].checked;
  };

  const access = value => {
    const phase = state.poll?.status !== value.poll?.status;
    const changed =
      state.manager !== value.manager
      || state.streamer !== value.streamer
      || state.login !== value.login;

    state = value;

    const account = state.login ? String(state.userId || '').replace(/\(\d+\)$/, '') : '';

    if ($('account').dataset.id !== account) {
      $('account').dataset.id = account;
      $('account').classList.toggle('logged-in', Boolean(account));
      $('account').title = account ? '내 프로필' : '로그인';
      $('account-label').textContent = account ? state.userName || account : '로그인';
      $('account-avatar').hidden = true;
      $('account-avatar').removeAttribute('src');

      if (account) {
        void request(`/api/user?id=${encodeURIComponent(account)}`)
          .then(data => {
            const avatar = image(data.image);

            if ($('account').dataset.id === account && avatar) {
              $('account-avatar').src = avatar.src;
              $('account-avatar').hidden = false;
            }
          })
          .catch(() => {});
      }
    }

    if (state.viewers !== null && state.viewers !== undefined) {
      $('members-count').textContent = Number(state.viewers).toLocaleString('ko-KR');
    }

    $('members-open').disabled = !state.connected;

    if (!state.connected) {
      $('members').close();
      $('members-list').replaceChildren();
    }
    $('kicks-open').disabled = !state.connected || !state.kicks;

    if (!state.connected) {
      $('kicks').close();
      $('kicks-results').replaceChildren();
    }

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

    const polls = {
      1: '새 투표가 시작되었습니다.',
      3: '투표가 마감되었습니다.',
      4: '투표 결과가 공개되었습니다.'
    };

    $('chat-poll-open').title = polls[state.poll?.status] || '';
    $('chat-poll-label').textContent = polls[state.poll?.status] || '';

    if (state.poll?.status !== 1) {
      $('chat-poll-submit').disabled = true;

      for (const radio of $('chat-poll-list').querySelectorAll('input')) {
        radio.disabled = true;
      }
    }
    position();

    if (phase || survey !== state.poll?.surveyNo) {
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
    $('chat-manage-open').hidden = !state.manager;
    $('chat-manage-open').disabled = !state.connected;
    $('chat-freeze').textContent = state.ice ? '적용' : '얼리기';
    $('chat-melt').disabled = !state.ice;
    freezing();
    if (document.activeElement !== $('chat-slow-count')) {
      $('chat-slow-count').value = state.slow || 0;
    }
    $('chat-notice-open').disabled = !state.streamer || !state.connected;
    $('chat-rule-open').disabled = !state.streamer || !state.connected;
    $('chat-nickname-open').disabled = !state.login || !state.connected;

    if (!state.manager || !state.connected) {
      $('chat-manage').close();
    }

    if (!state.login || !state.connected) {
      $('chat-nickname').close();
    }
    draft.disabled = !state.manager || !state.connected;
    $('chat-manager-submit').disabled = draft.disabled;

    if (!state.manager) {
      reset();
    }
    $('chat-whisper').disabled = !state.login;
    compose.contentEditable = String(!input.disabled);
    compose.dataset.placeholder = state.login ? '채팅 입력' : '로그인이 필요합니다.';

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

    $('account').hidden = false;
  };

  const row = entry => {
    const node = document.createElement('article');
    const date = new Date(entry.date);
    const emoticons = settings.emotes ? entry.emoticons : [];

    node.className = `chat-row chat-${entry.type}`;
    entries.set(node, entry);
    node.hidden = !settings.entry && entry.type === 'system'
      && /님이 대화방(?:에 참여했습니다|에서 나가셨습니다)\./.test(entry.message);
    node.dataset.id = entry.id;
    node.title = date.toLocaleTimeString('ko-KR');

    if (!Number.isNaN(date.getTime())) {
      node.dataset.date = day(date);
    }

    if (entry.type === 'subtitle') {
      node.textContent = `[자막] ${entry.message}`;

      return node;
    }

    if (['system', 'error'].includes(entry.type) && !entry.user?.id) {
      if (entry.type === 'system') {
        const heading = document.createElement('strong');
        const message = document.createElement('span');

        node.dataset.tone = entry.tone || '';
        content(heading, entry.heading || entry.message, emoticons);
        node.append(heading);

        if (entry.heading && entry.message) {
          content(message, entry.message, emoticons);
          node.append(document.createElement('br'), message);
        }
      }
      else {
        notification(node, entry.message, emoticons);
      }

      return node;
    }

    const user = entry.user || {};
    const cached = users.get(user.id);

    if (cached && user.tier && !user.month) {
      const { month, total, tierUrl, tierName } = cached;

      Object.assign(user, { month, total, tierUrl, tierName });
    }

    node.dataset.role = user.role || '';

    if (entry.type === 'gift') {
      if (entry.message.includes('애드벌룬')) {
        node.dataset.gift = 'adcon';
      }
      else if (entry.message.includes('별풍선')) {
        node.dataset.gift = 'balloon';
      }
    }

    if (entry.type === 'system') {
      const message = document.createElement('span');

      message.className = 'chat-message';
      message.dataset.role = user.role;
      message.dataset.user = user.id;
      message.dataset.tier = user.tier || 0;
      identify(message, user);
      notification(message, entry.message, emoticons);
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

    if (entry.image && (entry.type !== 'ogq' || settings.emotes)) {
      const img = image(entry.image);

      if (img) {
        img.className = 'chat-image';

        if (entry.type === 'gift') {
          node.classList.add('chat-gift-image');
          img.addEventListener('error', () => node.classList.remove('chat-gift-image'));
        }

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

    if (entry.type === 'gift') {
      donation(text, entry.message, emoticons);
    }
    else {
      content(text, entry.message, emoticons, settings.emotes);
    }

    node.append(text);

    if (!settings.motion) {
      for (const img of node.querySelectorAll('.chat-emote, .chat-ogq .chat-image')) {
        const freeze = () => {
          if (!img.naturalWidth || !img.parentNode) {
            return;
          }

          const canvas = document.createElement('canvas');

          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.className = img.className;
          canvas.title = img.title;
          canvas.getContext('2d').drawImage(img, 0, 0);
          img.replaceWith(canvas);
        };

        if (img.complete) {
          freeze();
        }
        else {
          img.addEventListener('load', freeze, { once: true });
        }
      }
    }

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

    const node = row(entry);
    const line = divider(node, messages.lastElementChild);

    if (line) {
      messages.append(line);
    }

    messages.append(node);

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
      dates(messages);
      messages.scrollTop = initial
        ? messages.scrollHeight
        : messages.scrollTop + messages.scrollHeight - height;
      previous = data.cursor;
      loaded = true;
    } catch (error) {
      if (version === revision) {
        status(error.message);
        $('chat-manager-status').textContent = error.message;
        $('chat-manager-status').hidden = false;
      }
    } finally {
      pending = false;
    }
  };

  const renew = user => {
    const data = { ...users.get(user.id), ...user };

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
    if (seen.has(entry.id) || announcement(entry) || new Date(entry.date).getTime() <= cleared) {
      return;
    }

    seen.add(entry.id);

    const node = row(entry);
    const line = node.hidden ? null : divider(
      node,
      [...log.querySelectorAll('.chat-row:not([hidden])')].at(-1)
    );

    if (line) {
      log.append(line);
    }

    log.append(node);
    observer.observe(node);

    if (pinned) {
      log.scrollTop = log.scrollHeight;
      offset = log.scrollTop;
      follow();
    }
    else if (!node.hidden) {
      unread(entry);
      position();
    }

    if (translating && state.login && entry.type === 'chat' && queued < 20) {
      queued++;
      queue = queue.then(async () => {
        if (!translating || !node.isConnected) {
          return;
        }

        const result = await request('/api/chat', { action: 'translate', message: entry.message });

        if (translating && node.isConnected && result.message !== entry.message) {
          const translation = document.createElement('div');

          translation.className = 'chat-translation';
          translation.textContent = result.message;
          node.append(translation);
        }
      }).catch(error => {
        translating = false;
        $('chat-translate').checked = false;
        status(error.message);
      }).finally(() => queued--);
    }
  };

  const history = async initial => {
    if (loading || (!initial && !cursor)) {
      return;
    }

    loading = true;

    const version = epoch;

    try {
      const params = new URLSearchParams({ cursor: initial ? '' : cursor });
      const data = await request(`/api/chat?${params}`);

      if (version !== epoch) {
        return;
      }

      const height = log.scrollHeight;
      const existing = initial && log.children.length > 0;
      const fragment = document.createDocumentFragment();

      for (const entry of data.entries) {
        if (announcement(entry) || new Date(entry.date).getTime() <= cleared) {
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
      dates(log);

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
      if (version === epoch) {
        status(error.message);
      }
    } finally {
      if (version === epoch) {
        loading = false;
      }
    }
  };

  const collect = async initial => {
    if (!viewer || (!initial && (collecting || !older))) {
      return;
    }

    if (initial) {
      collection++;
    }

    const user = viewer;
    const version = collection;

    collecting = true;

    try {
      const params = new URLSearchParams({ user: user.id, cursor: initial ? '' : older });
      const data = await request(`/api/chat?${params}`);

      if (viewer !== user || version !== collection) {
        return;
      }

      const log = $('chat-history-log');
      const height = log.scrollHeight;
      const top = log.scrollTop;
      const fragment = document.createDocumentFragment();

      for (const entry of data.entries) {
        fragment.append(row(entry));
      }

      log.prepend(fragment);
      dates(log);
      older = data.cursor;

      if (initial) {
        log.scrollTop = log.scrollHeight;
      }
      else {
        log.scrollTop = top + log.scrollHeight - height;
      }
    } finally {
      if (version === collection) {
        collecting = false;
      }
    }
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

    const id = person.id.replace(/\(\d+\)$/, '');
    const own = id === String(state.userId || '').replace(/\(\d+\)$/, '');
    const protectedUser = own || id === state.bjId;

    if (state.manager && !protectedUser) {
      for (const [action, label] of [
        ['mute', '채팅 금지'],
        [
          person.kicked ? 'cancel' : 'kick',
          person.kicked ? '강제 퇴장 취소' : '강제 퇴장'
        ],
        ['black', '블랙리스트 추가']
      ]) {
        button(label, async () => {
          await request('/api/chat', { action, target: person.id });
          $('chat-person').close();
        });
      }

      $('chat-person-actions').append(document.createElement('hr'));
    }

    button('아이디 복사', async () => {
      await navigator.clipboard.writeText(person.id);
      $('chat-person').close();
    });

    if (state.streamer && !protectedUser) {
      const manager = person.role === '매니저';
      const action = manager ? 'dismiss' : 'appoint';
      const label = manager ? '매니저 해임' : '매니저 임명';

      button(label, async () => {
        await request('/api/chat', { action, target: person.id });
        $('chat-person').close();
      });
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

    if (!own) {
      const communication = button('소통', () => {
        $('chat-whisper').disabled = !state.login;
        $('chat-person').close();
        $('chat-communication').showModal();
      });

      communication.className = 'chat-forward';
    }

    if (own && state.login) {
      $('chat-person-actions').append(document.createElement('hr'));

      const logout = button('로그아웃', async () => {
        logout.disabled = true;

        try {
          const data = await request('/api/account', { action: 'logout' });

          access(data.state);
          $('chat-person').close();
        } finally {
          logout.disabled = false;
        }
      });
    }
  };

  const profile = user => {
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
  };

  const open = async user => {
    user = { ...user, ...users.get(user.id) };
    profile(user);

    try {
      const data = await request(`/api/user?id=${encodeURIComponent(user.id)}`);

      if (person !== user || !$('chat-person').open) {
        return;
      }

      if (data.user) {
        const latest = { ...user, ...data.user };

        users.set(user.id, latest);
        Object.assign(user, latest);
        profile(user);
      }

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

    const version = epoch;

    try {
      const response = await fetch('/api/chat', {
        headers: { Authorization: `Bearer ${token()}`, Accept: 'text/event-stream' },
        signal: controller.signal
      });

      if (version !== epoch) {
        return;
      }

      if (!response.ok) {
        throw new Error('채팅 연결 실패');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      await history(true);

      if (version !== epoch) {
        return;
      }

      previous = '';
      loaded = false;

      if (state.manager && !panel.hidden) {
        await records();
      }

      status('');

      while (true) {
        const chunk = await reader.read();

        if (version !== epoch || chunk.done) {
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
        status('채팅 연결이 끊겼습니다.', false);
      }

      if (!stopped) {
        setTimeout(() => void start(), 2000);
      }
    }
  };

  const start = () => {
    void stream();
  };

  let multiple = { running: false, rows: [] };
  let updating = false;
  let changing = false;
  let refresh = null;

  const renderMulti = () => {
    const rows = multiple.rows;
    const connected = rows.filter(row => row.connected).length;
    const errors = rows.filter(row => row.error).length;
    const waiting =
      rows.length - connected - rows.filter(row => !row.connected && row.error).length;

    $('chat-multi-count').disabled = changing || multiple.running;
    $('chat-multi-start').disabled = changing || multiple.running;
    $('chat-multi-stop').disabled = changing || !multiple.running;
    $('chat-multi-summary').textContent = multiple.running
      ? `전체 ${rows.length}개  연결 ${connected}개\n대기 ${waiting}개  오류 ${errors}개`
      : '';
    $('chat-multi-summary').hidden = !multiple.running;

    const list = $('chat-multi-list');

    list.replaceChildren();

    if (!rows.length) {
      return;
    }

    const table = document.createElement('table');
    const header = table.createTHead().insertRow();

    for (const label of ['번호', '상태']) {
      const cell = document.createElement('th');

      cell.textContent = label;
      header.append(cell);
    }

    const body = table.createTBody();

    for (const row of rows) {
      const entry = body.insertRow();
      let message = '대기';

      if (row.connected) {
        message = '연결 됨';
      }
      else if (row.error) {
        message = row.error;
      }
      else if (row.connecting) {
        message = '연결 중';
      }

      entry.insertCell().textContent = row.id;
      entry.insertCell().textContent = message;
    }

    list.append(table);
  };

  const multi = async data => {
    if (updating) {
      return;
    }

    clearTimeout(refresh);
    updating = true;
    changing = Boolean(data);
    renderMulti();

    try {
      multiple = await request('/api/multi', data);
    } catch (error) {
      status(error.message);
    } finally {
      updating = false;
      changing = false;
      renderMulti();

      if ($('chat-multi').open) {
        refresh = setTimeout(() => void multi(), 2000);
      }
    }
  };

  $('chat-multi-form').addEventListener('submit', event => {
    event.preventDefault();

    void multi({ action: 'start', count: Number($('chat-multi-count').value) });
  });
  $('chat-multi-stop').addEventListener('click', () => void multi({ action: 'stop' }));
  $('chat-multi').addEventListener('close', () => clearTimeout(refresh));
  $('chat-multi-open').addEventListener('click', () => {
    $('chat-menu').close();
    $('chat-multi').showModal();
    void multi();
  });

  const manage = async data => {
    const buttons = $('chat-manage').querySelectorAll('button, input');

    for (const button of buttons) {
      button.disabled = true;
    }

    try {
      await request('/api/chat', data);
    } catch (error) {
      status(error.message);
    } finally {
      for (const button of buttons) {
        button.disabled = false;
      }
      freezing();
      $('chat-rule-open').disabled = !state.streamer;
      $('chat-notice-open').disabled = !state.streamer;
      $('chat-melt').disabled = !state.ice;
      renderMulti();
    }
  };

  $('chat-manage-open').addEventListener('click', () => {
    $('chat-slow-count').value = state.slow || 0;
    $('chat-freeze-count').value = state.freezing?.count || 1;
    $('chat-freeze-month').value = state.freezing?.date || 1;

    for (const [index, checkbox] of [
      ...$('chat-grades').querySelectorAll('input')
    ].entries()) {
      checkbox.checked = Boolean(state.freezing?.auth?.[index]);
    }
    $('chat-grades').querySelector('input').checked = true;
    freezing();
    $('chat-manage').showModal();
  });
  $('chat-grades').addEventListener('change', freezing);
  $('chat-freeze').addEventListener('click', () => {
    const auth = [...$('chat-grades').querySelectorAll('input')].map(
      item => item.checked
    );
    const count = Number($('chat-freeze-count').value);
    const date = Number($('chat-freeze-month').value);

    manage({ action: 'freeze', enabled: true, auth, count, date });
  });
  $('chat-melt').addEventListener('click', () => {
    manage({ action: 'freeze', enabled: false });
  });

  const tabs = [
    ['chat-freeze-tab', 'chat-freezing'],
    ['chat-slow-tab', 'chat-slow'],
    ['chat-notice-open', 'chat-announcement'],
    ['chat-rule-open', 'chat-rule-edit']
  ];

  for (const [tab, panel] of tabs) {
    $(tab).addEventListener('click', () => {
      clearTimeout(refresh);

      for (const [button, section] of tabs) {
        $(section).hidden = section !== panel;
        $(button).classList.toggle('selected', button === tab);
      }

      if (panel === 'chat-announcement') {
        $('chat-announcement-content').value = state.notice || '';
      }
      else if (panel === 'chat-rule-edit') {
        $('chat-rule-input').value = state.rule || '';
      }
    });
  }
  $('chat-slow').addEventListener('submit', event => {
    event.preventDefault();

    const count = Number($('chat-slow-count').value);

    manage({ action: 'slow', count });
  });
  $('chat-slow-off').addEventListener('click', () => {
    manage({ action: 'slow', count: 0 });
  });
  const display = () => {
    document.body.dataset.chatSize = settings.size;

    if (popup && !popup.closed) {
      popup.document.body.dataset.chatSize = settings.size;
    }

    $('conversation').classList.toggle('chat-small-ogq', settings.small);
    $('chat-size-value').textContent = settings.size;
    $('chat-size-down').disabled = settings.size === 1;
    $('chat-size-up').disabled = settings.size === 5;

    for (const [id, key] of [
      ['chat-show-emotes', 'emotes'],
      ['chat-move-emotes', 'motion'],
      ['chat-small-ogq', 'small'],
      ['chat-show-entry', 'entry']
    ]) {
      $(id).checked = settings[key];
    }

    const top = log.scrollTop;

    for (const node of log.querySelectorAll('.chat-row')) {
      const entry = entries.get(node);

      if (entry) {
        const replacement = row(entry);

        observer.unobserve(node);
        node.replaceWith(replacement);
        observer.observe(replacement);
      }
    }

    dates(log);
    log.scrollTop = pinned ? log.scrollHeight : top;
    offset = log.scrollTop;
    position();

    try {
      window.localStorage.setItem('chat-display', JSON.stringify(settings));
    } catch {}
  };
  for (const [id, key] of [
    ['chat-show-emotes', 'emotes'],
    ['chat-move-emotes', 'motion'],
    ['chat-small-ogq', 'small'],
    ['chat-show-entry', 'entry']
  ]) {
    $(id).addEventListener('change', event => {
      settings[key] = event.target.checked;
      display();
    });
  }
  for (const [id, change] of [['chat-size-down', -1], ['chat-size-up', 1]]) {
    $(id).addEventListener('click', () => {
      settings.size = Math.max(1, Math.min(5, settings.size + change));
      display();
    });
  }
  const clear = () => {
    cleared = Date.now();
    cursor = '';
    observer.disconnect();
    log.replaceChildren();
    preview.replaceChildren();
    pinned = true;
    offset = 0;
    position();
    $('chat-menu').close();
  };
  $('chat-clear').addEventListener('click', clear);
  $('chat-translate').addEventListener('change', event => {
    if (event.target.checked && !state.login) {
      event.target.checked = false;
      $('chat-translation').close();
      signin();

      return;
    }

    translating = event.target.checked;
  });
  $('chat-popup').addEventListener('click', () => {
    $('chat-menu').close();

    if (popup && !popup.closed) {
      popup.focus();

      return;
    }

    popup = window.open('', 'soop-chat', 'popup,width=480,height=720');

    if (!popup) {
      status('팝업을 허용해 주세요.');

      return;
    }

    const child = popup.document;
    const nodes = [$('conversation'), ...document.querySelectorAll(
      'dialog[id^="chat-"], #login, #logs, #kicks, #members'
    )];
    const anchors = new Map();

    child.title = '채팅';
    child.documentElement.lang = 'ko';
    child.head.replaceChildren();

    for (const source of document.querySelectorAll('link[rel="stylesheet"]')) {
      const link = child.createElement('link');

      link.rel = 'stylesheet';
      link.href = source.href;
      child.head.append(link);
    }

    child.body.className = document.body.className;
    child.body.classList.add('chat-window');
    child.body.dataset.chatSize = settings.size;

    for (const node of nodes) {
      const anchor = document.createComment('chat-popup');

      node.before(anchor);
      anchors.set(node, anchor);
      child.body.append(node);
    }

    const restore = () => {
      for (const [node, anchor] of anchors) {
        anchor.replaceWith(node);
      }

      popup = undefined;
      follow();
    };

    popup.addEventListener('pagehide', restore, { once: true });
    follow();
  });
  display();
  for (const id of ['chat-display', 'chat-entry', 'chat-translation', 'chat-size']) {
    $(id + '-open').addEventListener('click', () => {
      $('chat-menu').close();
      $(id).showModal();
    });
  }
  for (const id of [
    'chat-display', 'chat-entry', 'chat-translation', 'chat-size',
    'chat-nickname', 'chat-multi'
  ]) {
    const back = document.createElement('button');

    back.type = 'button';
    back.className = 'chat-setting-back';
    back.title = '뒤로가기';
    back.append($('chat-communication-back').firstElementChild.cloneNode(true));
    back.addEventListener('click', () => {
      $(id).close();
      $('chat-menu').showModal();
    });
    $(id).querySelector('.heading').prepend(back);
  }
  $('chat-menu-open').addEventListener('click', () => $('chat-menu').showModal());
  $('chat-nickname-open').addEventListener('click', () => {
    $('chat-menu').close();
    $('chat-nickname-input').value = '';
    $('chat-nickname').showModal();
    $('chat-nickname-input').focus();
  });
  for (const [form, action, input] of [
    ['chat-announcement-form', 'notice', 'chat-announcement-content'],
    ['chat-rule-form', 'rule', 'chat-rule-input']
  ]) {
    $(form).addEventListener('submit', async event => {
      event.preventDefault();
      event.submitter.disabled = true;

      try {
        await request('/api/chat', { action, message: $(input).value });
      } catch (error) {
        status(error.message);
      } finally {
        event.submitter.disabled = false;
      }
    });
  }
  $('chat-nickname-form').addEventListener('submit', async event => {
    event.preventDefault();

    const button = event.submitter;

    button.disabled = true;

    try {
      await request('/api/chat', {
        action: 'nickname',
        message: $('chat-nickname-input').value
      });
      $('chat-nickname').close();
    } catch (error) {
      status(error.message);
    } finally {
      button.disabled = false;
    }
  });

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
        status(error.message);
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

    const value = input.value.trim();
    const slash = value.startsWith('/') && !icons.some(icon => value.startsWith(icon.keyword));

    if (slash) {
      const [name, ...args] = value.split(/\s+/);
      const message = args.join(' ');

      sending = true;

      try {
        if (name === '/지우기') {
          clear();
        }
        else if (name === '/도움말') {
          input.value = '/';
          caret = 1;
          render(true);

          return;
        }
        else if (name === '/팝업' || name === '/멀티') {
          if (message) {
            throw new Error('명령어 뒤에 내용을 입력하지 마세요.');
          }

          const buttons = {
            '/팝업': 'chat-popup',
            '/멀티': 'chat-multi-open'
          };

          $(buttons[name]).click();
        }
        else if (name === '/크기') {
          const size = Number(message);

          if (!Number.isInteger(size) || size < 1 || size > 5) {
            throw new Error('사용법: /크기 1 ~ 5');
          }

          settings.size = size;
          display();
        }
        else if (name === '/닉네임' && !message) {
          $('chat-nickname-open').click();
        }
        else if (name === '/번역') {
          const result = await request('/api/chat', { action: 'translate', message });

          input.value = result.message;
          caret = input.value.length;
          render(true);

          return;
        }
        else {
          const action = {
            '/닉네임': 'nickname',
            '/귓속말': 'send',
            '/매니저': 'manager',
            '/채금': 'mute',
            '/강퇴': 'kick',
            '/강퇴취소': 'cancel'
          }[name];

          if (!action || !message || (name === '/귓속말' && args.length < 2)) {
            throw new Error('명령어를 확인해 주세요. / 를 입력하면 목록이 나타납니다.');
          }

          await request('/api/chat', {
            action,
            target: ['send', 'mute', 'kick', 'cancel'].includes(action) ? args[0] : '',
            message: name === '/귓속말' ? args.slice(1).join(' ') : message
          });
        }

        if (input.value.trim() === value) {
          input.value = '';
          caret = 0;
          render();
        }
      } catch (error) {
        status(error.message);
      } finally {
        sending = false;
      }

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
        caret = 0;
        render();
      }

      status('');
    } catch (error) {
      status(error.message);
    } finally {
      sending = false;
    }
  });
  compose.addEventListener('focus', rules);
  compose.addEventListener('click', () => {
    if (!state.login) {
      signin();
    }
  });
  $('chat-rule-agree').addEventListener('click', () => {
    agreed = state.rule;
    $('chat-rule').close();
    compose.focus();
  });
  compose.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }

    event.preventDefault();

    if (event.shiftKey) {
      insert('\n');
    }
    else {
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

  const pollNotice = message => {
    $('chat-poll-message').textContent = message;

    if (!$('chat-poll-notice').open) {
      $('chat-poll-notice').showModal();
    }
  };

  $('chat-poll-notice-confirm').addEventListener('click', () => {
    $('chat-poll-notice').close();
  });

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
      $('chat-poll-list').replaceChildren();
      $('chat-poll-submit').disabled = true;
      $('chat-poll-submit').hidden = data.status !== 1;
      $('chat-poll-cancel').textContent = data.status === 1 ? '취소' : '닫기';
      $('chat-poll').querySelector('h2').textContent =
        data.status === 4 ? '투표 결과' : '투표하기';

      for (const item of data.list || []) {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        const text = document.createElement('span');

        radio.type = 'radio';
        radio.name = 'answer';
        radio.value = item.answer_no;
        radio.disabled = !state.login || data.status !== 1;
        text.textContent = item.answer_title || '';

        if (data.status === 4) {
          radio.hidden = true;
          text.textContent += ` (${Number(item.answer_total) || 0}표)`;
        }
        radio.addEventListener('change', () => {
          $('chat-poll-submit').disabled =
            voting || !state.login || state.poll?.status !== 1;
        });
        label.append(radio, text);
        $('chat-poll-list').append(label);
      }

      if (!$('chat-poll').open) {
        $('chat-poll').showModal();
      }

      if (data.status === 3) {
        pollNotice('투표가 마감되었습니다.');
      }
    } catch (error) {
      status(error.message);
    }
  });
  $('chat-poll-form').addEventListener('submit', async event => {
    event.preventDefault();

    const selected = $('chat-poll-list').querySelector('input:checked');

    if (
      voting
      || !selected
      || !state.login
      || state.poll?.status !== 1
      || survey !== state.poll?.surveyNo
    ) {
      return;
    }

    voting = true;
    $('chat-poll-submit').disabled = true;

    try {
      await request('/api/poll', { survey, answer: Number(selected.value) });
      $('chat-poll').close();
      pollNotice('투표가 완료되었습니다.');
    } catch (error) {
      pollNotice(error.message);
      $('chat-poll-submit').disabled = !state.login || state.poll?.status !== 1;
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
    compose.focus();
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
  $('chat-history-log').addEventListener('scroll', () => {
    if ($('chat-history-log').scrollTop < 100) {
      collect(false).catch(error => status(error.message));
    }
  });

  const period = () => {
    const selected = $('logs-period').value;

    if (selected === 'custom') {
      return;
    }

    const start = new Date();
    const end = new Date(start);

    if (selected === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    }
    else if (selected === 'week') {
      start.setDate(start.getDate() - 6);
    }

    $('logs-start').value = start.toLocaleDateString('sv-SE');
    $('logs-end').value = end.toLocaleDateString('sv-SE');
  };

  const results = async initial => {
    if (!initial && (searching || !continuation)) {
      return;
    }

    if (initial) {
      search++;
      query = {
        start: $('logs-start').value,
        end: $('logs-end').value,
        type: $('logs-type').value,
        text: $('logs-query').value
      };
      continuation = '';
      $('logs-results').replaceChildren();
    }

    const version = search;
    const channel = epoch;
    const list = $('logs-results');
    const labels = {
      chat: '채팅',
      ogq: '채팅',
      manager: '매니저 채팅',
      system: '알림',
      subtitle: '자막',
      notice: '공지',
      gift: '후원',
      mute: '채금',
      kick: '강퇴'
    };

    searching = true;
    $('logs-status').textContent = '검색 중';

    try {
      do {
        const params = new URLSearchParams({ ...query, cursor: continuation });
        const data = await request(`/api/logs?${params}`);

        if (version !== search || channel !== epoch || !$('logs').open) {
          return;
        }

        continuation = data.cursor;

        for (const entry of data.entries.reverse()) {
          const node = document.createElement('div');
          const meta = document.createElement('div');
          const date = document.createElement('time');
          const type = document.createElement('span');

          node.className = 'logs-entry';
          meta.className = 'logs-meta';
          date.dateTime = entry.date;
          date.textContent = new Date(entry.date).toLocaleString('ko-KR');
          type.textContent = labels[entry.type] || '알림';
          meta.append(date, type);

          if (entry.user?.id) {
            const id = document.createElement('span');

            id.textContent = entry.user.id;
            meta.append(id);
          }

          if (entry.actor || entry.actorId) {
            const actor = document.createElement('span');

            actor.textContent = `처리자: ${entry.actor || entry.actorId}`;
            meta.append(actor);
          }

          if (entry.type === 'mute' && entry.count !== '') {
            const count = document.createElement('span');

            count.textContent = `${entry.count}회`;
            meta.append(count);
          }

          node.append(meta, row(entry));

          if (entry.remarks) {
            const remarks = document.createElement('div');

            remarks.className = 'logs-remarks';
            remarks.textContent = entry.remarks;
            node.append(remarks);
          }

          list.append(node);
        }

        if (data.entries.length) {
          break;
        }
      } while (continuation);

      $('logs-status').textContent = list.childElementCount
        ? `${list.childElementCount}건`
        : '검색 결과 없음';
    } catch (error) {
      if (version === search && channel === epoch) {
        $('logs-status').textContent =
          error instanceof TypeError ? '로그 검색 실패' : error.message;
      }
    } finally {
      if (version === search) {
        searching = false;
      }
    }
  };

  period();
  $('logs-period').addEventListener('change', period);

  for (const id of ['logs-start', 'logs-end']) {
    $(id).addEventListener('change', () => {
      $('logs-period').value = 'custom';
    });
  }

  $('logs-form').addEventListener('submit', event => {
    event.preventDefault();
    void results(true);
  });
  $('logs-open').addEventListener('click', () => {
    $('menu-items').hidden = true;
    $('logs').showModal();
    void results(true);
  });
  $('logs-results').addEventListener('scroll', () => {
    const list = $('logs-results');
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;

    if (remaining < 150) {
      void results(false);
    }
  });
  $('logs').addEventListener('close', () => {
    search++;
    searching = false;
  });

  $('kicks-open').addEventListener('click', async () => {
    const channel = epoch;
    const version = ++kicks;

    $('menu-items').hidden = true;
    $('kicks-results').replaceChildren();
    $('kicks-status').textContent = '불러오는 중';
    $('kicks').showModal();

    try {
      const list = await request('/api/kicks');

      if (version !== kicks || channel !== epoch || !$('kicks').open) {
        return;
      }

      for (const entry of list) {
        const node = document.createElement('div');
        const target = document.createElement('button');
        const meta = document.createElement('div');
        const date = document.createElement('span');
        const actor = document.createElement('span');
        const user = { id: entry.userId, name: entry.userNick };

        node.className = 'logs-entry';
        target.type = 'button';
        target.className = 'chat-identity';
        target.textContent = `${user.name || user.id} (${user.id})`;
        target.addEventListener('click', () => void open(user));
        meta.className = 'logs-meta';
        date.textContent = entry.date;
        actor.textContent = `처리자: ${entry.adminNick || entry.adminId}`;
        meta.append(date, actor);
        node.append(target, meta);
        $('kicks-results').append(node);
      }

      $('kicks-status').textContent = list.length ? `${list.length}명` : '목록 없음';
    } catch (error) {
      if (version === kicks && channel === epoch && $('kicks').open) {
        $('kicks-status').textContent =
          error instanceof TypeError ? '강제 퇴장 인원 요청 실패' : error.message;
      }
    }
  });
  $('kicks').addEventListener('close', () => {
    kicks++;
  });

  const participants = async reset => {
    if (reset) {
      members++;
      listing = false;
      memberCursor = '';
      memberRole = '';
      memberQuery = $('members-search').value;
      $('members-list').replaceChildren();
    }
    else if (listing || !memberCursor) {
      return;
    }

    const version = members;
    const channel = epoch;
    const params = new URLSearchParams({ query: memberQuery, cursor: memberCursor });

    listing = true;
    $('members-status').textContent = '불러오는 중';

    try {
      const data = await request(`/api/members?${params}`);

      if (version !== members || channel !== epoch || !$('members').open) {
        return;
      }

      memberCursor = data.cursor;
      $('members-title').textContent =
        `채팅 참여 인원 (${data.total.toLocaleString('ko-KR')}명)`;

      for (const user of data.entries) {
        const role = user.role || '일반';

        if (role !== memberRole) {
          const heading = document.createElement('h3');

          heading.textContent = role === '열혈' ? '열혈팬' : role;
          $('members-list').append(heading);
          memberRole = role;
        }

        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'member';
        button.dataset.role = role;

        if (role === '스트리머') {
          const avatar = image(user.image, '프로필');

          if (avatar) {
            avatar.className = 'member-avatar';
            button.append(avatar);
          }

          identify(button, { ...user, tier: 0 });
        }
        else {
          identify(button, user);
        }

        const id = document.createElement('span');

        id.className = 'member-id';
        id.textContent = `(${user.id})`;
        button.append(id);
        button.addEventListener('click', () => void open(user));
        $('members-list').append(button);
      }

      $('members-status').textContent = data.matches ? '' : '검색 결과 없음';
    } catch (error) {
      if (version === members && channel === epoch) {
        $('members-status').textContent =
          error instanceof TypeError ? '참여자 목록 요청 실패' : error.message;
      }
    } finally {
      if (version === members) {
        listing = false;
      }
    }
  };

  $('members-open').addEventListener('click', () => {
    $('members-search').value = '';
    $('members').showModal();
    void participants(true);
  });
  $('members-search').addEventListener('input', () => {
    clearTimeout(memberTimer);
    members++;
    memberTimer = setTimeout(() => void participants(true), 250);
  });
  $('members-list').addEventListener('scroll', () => {
    const list = $('members-list');
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;

    if (remaining < 100) {
      void participants(false);
    }
  });
  $('members').addEventListener('close', () => {
    clearTimeout(memberTimer);
    members++;
    listing = false;
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
      });
      $('chat-ogq-list').append(button);
    }
  };

  $('chat-sticker').addEventListener('click', () => {
    sticker = null;
    $('chat-sticker').hidden = true;
    compose.focus();
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
    dismissed = false;

    if (rules()) {
      return;
    }

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
        insert(icon.keyword, false);
      });
      $('chat-icons-list').append(node);
    }

    $('chat-icons').showModal();
  });

  $('login-logo').src = new URL('/images/svg/soop_logo.svg', DOMAIN.res).href;

  const signin = () => {
    if (state.login || $('login').open) {
      return;
    }

    $('login-error').hidden = true;

    try {
      const id = window.localStorage.getItem('soop-login-id') || '';

      $('login-id').value = id;
      $('login-save').checked = Boolean(id);
    } catch {}

    $('login').showModal();
    $('login-id').focus();
  };

  $('account').addEventListener('click', () => {
    if (state.login) {
      void open({ id: state.userId, name: state.userName || state.userId });

      return;
    }

    signin();
  });

  $('login').addEventListener('close', () => {
    $('login-password').value = '';
    $('login-second').value = '';
  });

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();

    if ($('login-submit').disabled) {
      return;
    }

    $('login-submit').disabled = true;
    $('login-error').hidden = true;

    try {
      const data = await request('/api/account', {
        action: 'login',
        id: $('login-id').value.trim(),
        password: $('login-password').value,
        second: $('login-second').value
      });

      try {
        if ($('login-save').checked) {
          window.localStorage.setItem('soop-login-id', $('login-id').value.trim());
        }
        else {
          window.localStorage.removeItem('soop-login-id');
        }
      } catch {}

      access(data.state);
      $('login').close();
    } catch (error) {
      $('login-error').textContent = error.message;
      $('login-error').hidden = false;
    } finally {
      $('login-password').value = '';
      $('login-second').value = '';
      $('login-submit').disabled = false;
    }
  });

  for (const id of [
    'login',
    'chat-person',
    'chat-manage',
    'chat-menu',
    'chat-display',
    'chat-entry',
    'chat-translation',
    'chat-size',
    'chat-multi',
    'chat-nickname',
    'chat-icons',
    'chat-history',
    'chat-communication',
    'chat-rule',
    'chat-poll',
    'chat-poll-notice',
    'logs',
    'kicks',
    'members'
  ]) {
    $(id + '-close').addEventListener('click', () => {
      if (id === 'chat-rule') {
        dismissed = true;
      }
      $(id).close();
    });
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
        if (id === 'chat-rule') {
          dismissed = true;
        }
        $(id).close();
      }
    });
  }

  $('chat-rule').addEventListener('cancel', () => {
    dismissed = true;
  });
  $('chat-rule-avatar').addEventListener('error', () => {
    $('chat-rule-avatar').hidden = true;
  });

  window.addEventListener('pagehide', () => {
    popup?.close();
    stopped = true;
    clearTimeout(memberTimer);
    members++;
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

      const portrait = image(data.profile?.image);
      const avatar = $('chat-rule-avatar');

      avatar.hidden = !portrait;

      if (portrait && avatar.src !== portrait.src) {
        avatar.src = portrait.src;
      }

      if (channel !== data.player) {
        epoch++;
        $('members').close();
        $('members-list').replaceChildren();
        $('kicks').close();
        $('kicks-results').replaceChildren();
        loading = false;
        search++;
        searching = false;
        continuation = '';
        $('logs-results').replaceChildren();
        $('logs-status').textContent = '';

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
