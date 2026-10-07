import Hls from '/hls.js';
import { DOMAIN } from '/config.js';
import { createChat, createPreview } from '/chat.js';

const $ = id => document.getElementById(id);
const emblems = {
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  emerald: '에메랄드',
  diamond: '다이아',
  prestige: '프레스티지'
};

const events = {
  enter: '자동인사',
  balloon: '별풍선',
  adcon: '애드벌룬',
  videoBalloon: '영상 별풍선',
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
const drafts = new WeakMap();
const sender = { name: '매니저', role: '매니저' };
let config;
let broadcaster;
let link = '';
let started = 0;
let saving = false;
let ceremonies = {};
let sampling = 0;
let sampleTimer;
let revision;
let selected = -1;
let dirty = false;
let busy = false;
let packs = [];
let pack = '';
let number = 1;
let emoticons = [];
let token = location.hash.slice(1);

try {
  if (token) {
    sessionStorage.setItem('editor', token);
    history.replaceState(null, '', location.pathname);
  }
  else {
    token = sessionStorage.getItem('editor') || '';
  }
} catch {
  token = location.hash.slice(1);
}

function status(message, error = false) {
  for (const id of ['status', 'macro-status']) {
    $(id).textContent = message;
    $(id).classList.toggle('error', error);
  }
}

async function request(method = 'GET', data, endpoint = '/api/config') {
  let response;

  try {
    response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
  } catch (error) {
    throw new Error('편집 화면에 연결할 수 없습니다.', { cause: error });
  }

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || '설정 요청 실패');
  }

  return result;
}

function changed() {
  dirty = true;
  $('save').disabled = busy;
  status('');
}

function lines(value) {
  const source = Array.isArray(value) ? value.join('\n') : value || '';

  return source.replace(/\\r\\n|\\n/g, '\n');
}

function list() {
  const position = $('list').scrollTop;

  $('list').replaceChildren();

  const search = $('search').value.toLowerCase();

  for (const [index, rule] of config.rules.entries()) {
    const name = rule.name || `규칙 ${index + 1}`;

    if (!name.toLowerCase().includes(search)) {
      continue;
    }

    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = name;
    button.classList.toggle('selected', index === selected);

    const reply = lines(rule.reply).trim();
    const action = rule.action || 'reply';
    const empty = action === 'reply' && !reply && !rule.ogq;
    const enabled = rule.enabled !== false && !empty;

    button.classList.toggle('disabled', !enabled);
    button.addEventListener('click', () => {
      selected = index;
      render();
      $('macros').dataset.page = 'edit';
      $('macros').querySelector('main').scrollTop = 0;
    });
    $('list').append(button);
  }

  $('list').scrollTop = position;
}

function scroll() {
  $('list').querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function picture(button, url, name) {
  const image = document.createElement('img');

  button.disabled = true;
  image.alt = name;
  image.loading = 'lazy';
  image.addEventListener('load', () => {
    button.disabled = false;
    button.classList.add('ready');
  });
  image.src = url;
  button.append(image);
}

function gallery() {
  if ($('picker').hidden) {
    return;
  }

  $('packs').replaceChildren();

  for (const item of packs) {
    if (!item.images[0]) {
      continue;
    }

    const button = document.createElement('button');

    button.type = 'button';
    button.title = item.name;
    button.classList.toggle('selected', item.name === pack);
    picture(button, item.images[0], item.name);
    button.addEventListener('click', () => {
      pack = item.name;
      number = 1;
      capture();
      gallery();
      stickers();
    });
    $('packs').append(button);
  }
}

function sample() {
  const version = ++sampling;

  clearTimeout(sampleTimer);

  const item = packs.find(item => item.name === pack);
  const url = $('output').value === 'manager' ? '' : item?.images[number - 1];
  const gifts = [];

  if ($('kind').value === 'event') {
    for (const input of $('events').querySelectorAll('input:checked')) {
      const image = ceremonies[input.value];

      if (image) {
        gifts.push({ name: events[input.value], url: image });
      }
    }
  }

  const reply = lines($('reply').value);

  if ($('action').value === 'roulette') {
    if (!$('default').value.trim()) {
      $('macro-preview').hidden = true;
      $('macro-preview').replaceChildren();

      return;
    }

    const rule = { action: 'roulette' };
    const draft = {};

    for (const key of ['title', 'default', 'index', 'ranges', 'numbers']) {
      draft[key] = $(key).value;
    }

    $('macro-preview').hidden = false;

    try {
      roulette(rule, draft);
    } catch (error) {
      $('macro-preview').textContent = error.message;

      return;
    }

    $('macro-preview').textContent = '불러오는 중';
    sampleTimer = setTimeout(async () => {
      try {
        const data = await request('POST', rule, '/api/roulette');

        if (version !== sampling) {
          return;
        }

        const node = createPreview(sender, data.message, url, emoticons, gifts);

        $('macro-preview').replaceChildren(node);
      } catch (error) {
        if (version === sampling) {
          $('macro-preview').textContent = error.message;
        }
      }
    }, 300);

    return;
  }

  $('macro-preview').hidden = !reply.trim() && !url && !gifts.length;

  if ($('macro-preview').hidden) {
    $('macro-preview').replaceChildren();

    return;
  }

  const node = createPreview(sender, reply, url, emoticons, gifts);

  $('macro-preview').replaceChildren(node);
}

function stickers() {
  const item = packs.find(item => item.name === pack);
  const url = item?.images[number - 1];

  $('ogq').title = pack ? `${pack} ${number}` : 'OGQ 선택';
  $('attachment').hidden = !url || $('output').value === 'manager';

  if (url) {
    $('ogq-image').src = url;
    $('ogq-image').alt = `${pack} ${number}`;
  }

  sample();

  $('stickers').replaceChildren();
  $('separator').hidden = !item;

  if (!item || $('picker').hidden) {
    return;
  }

  for (const [index, url] of item.images.entries()) {
    const position = index + 1;
    const button = document.createElement('button');

    button.type = 'button';
    button.title = `${pack} ${position}`;
    button.classList.toggle('selected', position === number);
    picture(button, url, `${pack} ${position}`);
    button.addEventListener('click', () => {
      number = position;
      capture();
      stickers();
      $('picker').hidden = true;
    });
    $('stickers').append(button);
  }
}

function emojis(more = false) {
  if ($('emoticon-picker').hidden) {
    return;
  }

  const search = $('emoticon-search').value.toLowerCase();
  const items = emoticons.filter(item => item.keyword.toLowerCase().includes(search));

  const list = $('emoticons');

  if (!more) {
    list.replaceChildren();
    list.scrollTop = 0;
  }

  const start = list.children.length;

  for (const item of items.slice(start, start + 120)) {
    const button = document.createElement('button');

    button.type = 'button';
    button.title = item.keyword;
    picture(button, item.smallUrl, item.keyword);
    button.addEventListener('click', () => {
      insert(item.keyword);
      $('emoticon-picker').hidden = true;
    });
    $('emoticons').append(button);
  }
}

let cursor = 0;
let composing = false;

function text(node) {
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
}

function caret() {
  const selection = window.getSelection();

  if (!selection.rangeCount || !$('message').contains(selection.anchorNode)) {
    return;
  }

  const range = selection.getRangeAt(0).cloneRange();

  range.selectNodeContents($('message'));
  range.setEnd(selection.focusNode, selection.focusOffset);
  cursor = text(range.cloneContents()).length;
}

function append(target, value) {
  const lines = value.split('\n');

  for (const [index, line] of lines.entries()) {
    if (index) {
      target.append(document.createElement('br'));
    }

    target.append(line);
  }
}

function message(focus = false) {
  const target = $('message');
  const icons = new Map(emoticons.map(item => [item.keyword, item]));
  const value = $('reply').value;
  let position = 0;

  target.replaceChildren();

  for (const match of value.matchAll(/\/[^/\n]+\//g)) {
    append(target, value.slice(position, match.index));

    const item = icons.get(match[0]);

    if (item) {
      const image = document.createElement('img');

      image.src = item.smallUrl;
      image.alt = item.keyword;
      image.title = item.keyword;
      image.contentEditable = 'false';
      target.append(image);
    }
    else {
      target.append(match[0]);
    }

    position = match.index + match[0].length;
  }

  append(target, value.slice(position));

  if (value.endsWith('\n')) {
    const tail = document.createElement('br');

    tail.dataset.tail = 'true';
    target.append(tail);
  }

  if (!focus) {
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  let offset = Math.min(cursor, value.length);

  range.selectNodeContents(target);
  range.collapse(false);

  for (const node of target.childNodes) {
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

  target.focus();
  selection.removeAllRanges();
  selection.addRange(range);
}

function insert(value) {
  const selection = window.getSelection();
  let end = cursor;

  if (selection.rangeCount && $('message').contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);

    const before = range.cloneRange();

    before.selectNodeContents($('message'));
    before.setEnd(range.startContainer, range.startOffset);
    cursor = text(before.cloneContents()).length;
    end = cursor + text(range.cloneContents()).length;
  }

  const reply = $('reply').value;

  $('reply').value = reply.slice(0, cursor) + value + reply.slice(end);
  cursor += value.length;
  message(true);
  capture();
}

function inline() {
  const icons = new Set(emoticons.map(item => item.keyword));
  const expected = [...$('reply').value.matchAll(/\/[^/\n]+\//g)]
    .map(match => match[0])
    .filter(keyword => icons.has(keyword));
  const current = [...$('message').querySelectorAll('img')].map(image => image.alt);

  if (JSON.stringify(expected) !== JSON.stringify(current)) {
    message(true);
  }
}

$('message').addEventListener('input', () => {
  $('reply').value = text($('message'));
  caret();

  if (!composing) {
    inline();
    capture();
  }
});
$('message').addEventListener('compositionstart', () => {
  composing = true;
});
$('message').addEventListener('compositionend', () => {
  composing = false;
  $('reply').value = text($('message'));
  caret();
  inline();
  capture();
});
$('message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    insert('\n');
  }
});
$('message').addEventListener('paste', event => {
  event.preventDefault();
  insert(event.clipboardData.getData('text/plain').replace(/\r\n/g, '\n'));
});
for (const event of ['copy', 'cut']) {
  $('message').addEventListener(event, action => {
    const selection = window.getSelection();

    if (!selection.rangeCount || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    const value = text(range.cloneContents());

    action.preventDefault();
    action.clipboardData.setData('text/plain', value);

    if (event === 'cut') {
      insert('');
    }
  });
}

document.addEventListener('selectionchange', caret);

function visibility() {
  const kind = $('kind').value;
  const action = $('action').value;

  $('pattern-field').hidden = ['interval', 'event'].includes(kind);
  $('events-field').hidden = kind !== 'event';
  $('count-field').hidden = action !== 'mute';
  $('roulette').hidden = action !== 'roulette';
  $('cooldown-field').hidden = kind === 'interval';
  $('interval-field').hidden = kind !== 'interval';
  $('access-field').hidden = kind === 'interval';
  $('flags-field').hidden = kind !== 'regex';
  $('edit-field').hidden = kind !== 'command' || action !== 'reply';
  $('commands-field').hidden = action !== 'reply';
  $('output').closest('label').hidden = action === 'notify';

  for (const option of $('action').options) {
    const moderation = ['mute', 'kick', 'warn'].includes(option.value);
    const command = ['multi', 'notify'].includes(option.value) && kind !== 'command';

    option.hidden = command || (moderation && ['interval', 'event'].includes(kind));
    option.disabled = option.hidden;
  }

  const direct = $('output').querySelector('option[value="direct"]');

  direct.hidden = kind === 'interval';
  direct.disabled = direct.hidden;
  $('ogq-field').hidden = action === 'notify' || $('output').value === 'manager';
  $('divider').hidden = $('ogq-field').hidden;
  $('attachment').hidden =
    $('ogq-field').hidden || !packs.some(item => item.name === pack);

  if ($('ogq-field').hidden) {
    $('picker').hidden = true;
  }

  $('pattern-label').textContent = kind === 'command' ? '명령어' : '단어';
}

function render() {
  list();

  const rule = config.rules[selected];

  $('empty').hidden = Boolean(rule);
  $('form').hidden = !rule;

  if (!rule) {
    return;
  }

  $('heading').textContent = rule.name || '설정';
  $('name').value = rule.name || '';
  $('kind').value = rule.kind === 'timer' ? 'interval' : rule.kind || 'command';
  $('action').value = rule.action || 'reply';
  $('active').checked = rule.enabled !== false;
  $('pattern').value = lines(rule.pattern);
  $('events').replaceChildren();

  const patterns = Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern];
  const choices = { ...events };

  if (rule.kind === 'event') {
    for (const pattern of patterns) {
      choices[pattern] ??= pattern;
    }
  }

  for (const [value, name] of Object.entries(choices)) {
    const label = document.createElement('label');
    const input = document.createElement('input');

    label.className = 'switch';
    input.type = 'checkbox';
    input.value = value;
    input.checked = patterns.includes(value);
    label.append(input, name);
    $('events').append(label);
  }
  $('reply').value = lines(rule.reply);
  cursor = $('reply').value.length;
  message();
  $('count').value = rule.count ?? 0;
  $('cooldown').value = rule.cooldown ?? 5;
  $('interval').value = rule.interval ?? 300;
  $('output').value = rule.output || 'chat';
  $('access').value = rule.access || 'all';
  $('flags').value = rule.flags || '';
  $('edit').checked = rule.edit === true;
  $('commands').checked = rule.commands === true;
  $('title').value = rule.title || '';
  $('default').value = rule.default ?? '';
  if (rule.index && typeof rule.index === 'object') {
    $('index').value = Object.entries(rule.index)
      .map(([count, index]) => `${count}: ${index}`)
      .join('\n');
  }
  else {
    $('index').value = rule.index ?? '';
  }
  $('ranges').value = (rule.ranges || []).map(range => range.join('~')).join('\n');

  const numbers = rule.numbers || [];

  $('numbers').value = numbers
    .map(value => {
      return Array.isArray(value) ? value.join(', ') : String(value);
    })
    .join(Array.isArray(numbers[0]) ? '\n' : ', ');

  const ogq = /^(.+?)\s+([1-9]\d*)$/.exec(rule.ogq || '');

  pack = ogq?.[1] || '';
  number = Number(ogq?.[2] || 1);
  $('picker').hidden = true;
  $('emoticon-picker').hidden = true;

  const draft = drafts.get(rule);

  if (draft) {
    for (const [key, value] of Object.entries(draft)) {
      $(key).value = value;
    }
  }

  visibility();
  gallery();
  stickers();
}

function groups(value, range = false) {
  const result = [];

  for (const line of value.split('\n').filter(line => line.trim())) {
    const parts = line.trim().split(range ? /\s*[~–-]\s*/ : /\s*,\s*/);
    const numbers = parts.map(Number);
    const invalid = numbers.some(number => !Number.isSafeInteger(number) || number < 1);

    if (invalid || (range && numbers.length !== 2)) {
      throw new Error(range ? '개수 범위를 확인해주세요.' : '관련 번호를 확인해주세요.');
    }

    result.push(numbers);
  }

  return result;
}

function capture() {
  const rule = config.rules[selected];

  if (!rule) {
    return;
  }

  rule.name = $('name').value;
  rule.kind = $('kind').value;
  rule.action = $('action').value;
  rule.enabled = $('active').checked;

  let patterns;

  if (rule.kind === 'event') {
    patterns = [...$('events').querySelectorAll('input:checked')].map(
      input => input.value
    );
  }
  else {
    patterns = $('pattern')
      .value.split('\n')
      .map(value => value.trim())
      .filter(Boolean);
  }

  rule.pattern = patterns.length === 1 ? patterns[0] : patterns;
  if (Array.isArray(rule.reply)) {
    rule.reply = $('reply').value.split('\n');
  }
  else {
    rule.reply = $('reply').value;
  }

  if (pack) {
    rule.ogq = `${pack} ${number}`;
  }
  else {
    rule.ogq = '';
  }

  rule.cooldown = Number($('cooldown').value);
  rule.interval = Number($('interval').value);
  rule.output = $('output').value;
  rule.access = $('access').value;
  rule.flags = $('flags').value;
  rule.edit = $('edit').checked;
  rule.commands = $('commands').checked;

  if (rule.action === 'mute') {
    rule.count = Number($('count').value);
  }

  const draft = {};

  for (const key of ['title', 'default', 'index', 'ranges', 'numbers']) {
    draft[key] = $(key).value;
  }

  drafts.set(rule, draft);
  changed();
  list();
  visibility();
  $('heading').textContent = rule.name || '설정';
  sample();
}

function roulette(rule, draft = drafts.get(rule)) {
  if (!draft || rule.action !== 'roulette') {
    return;
  }

  for (const key of ['title', 'default', 'index', 'ranges', 'numbers']) {
    const value = draft[key].trim();

    if (!value) {
      delete rule[key];
      continue;
    }

    if (key === 'title') {
      rule[key] = value;
    }
    else if (key === 'ranges') {
      rule[key] = groups(value, true);
    }
    else if (key === 'numbers') {
      const result = groups(value);

      rule[key] = result.length === 1 ? result[0] : result;
    }
    else if (key === 'index' && value.includes(':')) {
      const indices = {};

      for (const line of value.split('\n').filter(line => line.trim())) {
        const parts = /^\s*([1-9]\d*)\s*:\s*(\d+)\s*$/.exec(line);

        if (!parts) {
          throw new Error('룰렛 번호를 확인해주세요.');
        }

        indices[parts[1]] = Number(parts[2]);
      }

      rule[key] = indices;
    }
    else {
      const number = Number(value);
      const minimum = key === 'default' ? 1 : 0;

      if (!Number.isSafeInteger(number) || number < minimum) {
        throw new Error(
          `${key === 'default' ? '기본 개수' : '룰렛 번호'}를 확인해주세요.`
        );
      }

      rule[key] = number;
    }
  }
}

function apply(data) {
  config = structuredClone(data.config);
  revision = data.revision;
  dirty = false;
  selected = Math.max(0, Math.min(selected, config.rules.length - 1));
  $('enabled').checked = config.enabled;
  $('menu-enabled').checked = config.enabled;
  $('save').disabled = true;
  render();
}

let player = '';
let media = null;
let attached = '';
let playback = 0;
let watching;
let live = true;
let notice = '';
let moving = false;
let saved;
let fetching = false;
let pending;
let paused = false;

function position() {
  const video = $('video');

  if (media?.liveSyncPosition != null) {
    return media.liveSyncPosition;
  }

  if (video.seekable.length) {
    return Math.max(0, video.seekable.end(video.seekable.length - 1) - 4);
  }

  return null;
}

function overlay(message = notice) {
  const video = $('video');
  const history = Boolean(attached) && video.readyState >= 2 && !live;
  const loading = message === '로딩 중';
  const state = $('video-state');

  notice = message;
  state.classList.toggle('loading', loading);
  state.textContent = loading ? '' : message;
  state.hidden = !message || history;
}

function remember() {
  const video = $('video');

  if (!attached || !video.readyState) {
    return;
  }

  saved = {
    url: attached,
    time: video.currentTime,
    live,
    paused: video.paused,
    muted: video.muted,
    quality: $('quality').dataset.value,
    volume: video.volume
  };

  try {
    sessionStorage.setItem(`video:${player}`, JSON.stringify(saved));
  } catch {}
}

function sync() {
  const target = position();
  const video = $('video');

  if (target !== null && video.readyState && target > video.currentTime) {
    video.currentTime = target;
  }

  live = true;
  video.playbackRate = 1;
  $('live').classList.add('active');
  overlay();
}

function stop(reset = true) {
  resetPreview();
  playback++;
  media?.destroy();
  media = null;
  attached = '';
  $('video').removeAttribute('src');
  $('video').load();

  if (reset) {
    $('timeline').max = 0;
    $('timeline').value = 0;
    fill($('timeline'));
  }

  for (const id of ['pause', 'rewind', 'live', 'timeline']) {
    $(id).disabled = true;
  }
}

function clock(value) {
  const seconds = Math.max(0, Math.floor(value || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');

  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
  }

  return `${String(minutes).padStart(2, '0')}:${remainder}`;
}

function fill(input) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const value = Number(input.value);
  const progress =
    maximum > minimum ? ((value - minimum) / (maximum - minimum)) * 100 : 0;

  input.style.setProperty('--progress', `${progress}%`);
}

function controls() {
  const video = $('video');
  const target = position();

  $('clock').textContent = clock(video.currentTime);
  $('player').classList.toggle('paused', video.paused);

  const action = video.paused ? '재생' : '일시정지';

  $('pause').title = `${action} (Space / K)`;
  $('pause')
    .querySelector('path')
    .setAttribute('d', video.paused ? 'M8 5v14l11-7z' : 'M6 5h4v14H6zm8 0h4v14h-4z');

  const sound = video.muted ? '음소거 해제' : '음소거';

  $('volume').title = `${sound} (M)`;
  $('loudness').value = video.muted ? 0 : video.volume;
  fill($('loudness'));
  $('volume')
    .querySelector('path')
    .setAttribute(
      'd',
      video.muted
        ? 'M3 9v6h4l5 4V5L7 9zm13 0 5 6m0-6-5 6'
        : 'M3 9v6h4l5 4V5L7 9zm13-2a7 7 0 0 1 0 10m-2-7a3 3 0 0 1 0 4'
    );

  for (const id of ['pause', 'rewind', 'live', 'timeline']) {
    $(id).disabled = !video.readyState;
  }

  if (!video.paused && !video.seeking && target !== null) {
    if (live) {
      const delay = target - video.currentTime;

      if (delay > 6) {
        sync();
      }
      else {
        video.playbackRate = delay > 1.5 ? 1.05 : 1;
      }
    }
    else if (video.currentTime >= target - 1) {
      live = true;
    }
  }

  if (target !== null) {
    const maximum = Math.max(target, video.currentTime, Number($('timeline').max));

    $('timeline').max = Math.ceil(maximum * 10) / 10;

    if (!moving) {
      $('timeline').value = live ? $('timeline').max : video.currentTime;
    }

    fill($('timeline'));
  }

  $('live').classList.toggle('active', live);
  overlay();
  remember();
}

function attach(data) {
  stop(Boolean(attached) && attached !== data.url);
  attached = data.url;

  const current = playback;
  const video = $('video');
  const restore = saved?.url === data.url && !saved.live;

  paused = saved?.url === data.url && saved.paused;

  const start = restore ? Math.min(saved.time, Math.max(0, data.duration - 4)) : -1;

  live = !restore;

  if (saved) {
    video.muted = saved.muted;
    video.volume = saved.volume ?? 1;
  }

  if (Hls.isSupported()) {
    media = new Hls({
      startPosition: start,
      maxBufferLength: 15,
      backBufferLength: 120,
      liveDurationInfinity: true,
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: Infinity,
      maxLiveSyncPlaybackRate: 1,
      liveSyncOnStallIncrease: 0
    });
    media.on(Hls.Events.ERROR, (event, error) => {
      if (current === playback && error.fatal) {
        remember();

        if (error.type === Hls.ErrorTypes.NETWORK_ERROR) {
          media.startLoad();
          overlay('로딩 중');
        }
        else if (error.type === Hls.ErrorTypes.MEDIA_ERROR) {
          media.recoverMediaError();
          overlay('로딩 중');
        }
        else {
          stop(false);
          overlay('영상 연결에 실패했습니다');
        }
      }
    });
    media.attachMedia(video);
    media.loadSource(data.url);
  }
  else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = data.url;

    if (restore) {
      video.addEventListener(
        'loadedmetadata',
        () => {
          if (current === playback) {
            video.currentTime = start;
          }
        },
        { once: true }
      );
    }
  }
  else {
    overlay('영상 재생 미지원');
  }
}

async function play(quality) {
  if (fetching) {
    if (quality) {
      pending = quality;
    }

    return;
  }

  if (!player) {
    return;
  }

  const channel = player;

  fetching = true;

  try {
    let endpoint = '/api/stream';

    if (quality) {
      endpoint += `?quality=${encodeURIComponent(quality)}`;
    }

    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (channel !== player) {
      return;
    }

    if (!response.ok) {
      throw new Error(data.error || '영상 연결 실패');
    }

    chat.support(Boolean(data.captions));

    const available = data.qualities || [];
    const current = [...$('qualities').children].map(item => ({
      name: item.dataset.value,
      label: item.textContent,
      disabled: item.disabled
    }));

    if (JSON.stringify(current) !== JSON.stringify(available)) {
      $('qualities').replaceChildren();

      for (const item of available) {
        const option = document.createElement('button');

        option.type = 'button';
        option.dataset.value = item.name;
        option.textContent = item.label;
        option.disabled = Boolean(item.disabled);
        option.addEventListener('click', () => {
          remember();
          $('qualities').hidden = true;
          void play(item.name);
        });
        $('qualities').append(option);
      }
    }

    $('quality').dataset.value = data.quality;

    const resolution = available.find(item => item.name === data.quality);

    if (resolution?.label) {
      $('quality').textContent = resolution.label;
    }

    for (const option of $('qualities').children) {
      option.classList.toggle('selected', option.dataset.value === data.quality);
    }
    $('quality').disabled = !available.length;
    let message = data.message || '';

    if (data.state === 'live') {
      const buffering = $('video').readyState < 3 && !paused;

      message = buffering ? '로딩 중' : '';
    }
    else if (data.state === 'loading' && !message) {
      message = '로딩 중';
    }

    overlay(message);
    $('video-save').dataset.url = data.download || '';
    $('video-save').disabled = saving || !data.download;

    if (data.url && attached !== data.url) {
      attach(data);
    }
  } catch {
    if (!attached) {
      overlay('로딩 중');
    }
  } finally {
    fetching = false;

    if (pending) {
      const quality = pending;

      pending = undefined;
      void play(quality);
    }
  }
}

$('quality').addEventListener('click', () => {
  $('qualities').hidden = !$('qualities').hidden;
});
document.addEventListener('click', event => {
  if (!event.target.closest('.resolution')) {
    $('qualities').hidden = true;
  }
});
$('loudness').addEventListener('input', () => {
  const video = $('video');

  video.volume = Number($('loudness').value);
  video.muted = video.volume === 0;
});

let volumeTimer;

const volume = () => {
  clearTimeout(volumeTimer);
  $('video-volume').classList.add('expanded');
  volumeTimer = setTimeout(() => {
    if (document.activeElement !== $('loudness')) {
      $('video-volume').classList.remove('expanded');
    }
  }, 2000);
};

for (const event of ['pointerenter', 'pointermove', 'pointerdown', 'focusin']) {
  $('video-volume').addEventListener(event, volume);
}
$('loudness').addEventListener('input', volume);
$('loudness').addEventListener('blur', volume);

const caption = async index => {
  $('subtitle-menu').hidden = true;
  $('settings-menu').hidden = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'subtitle', index })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '자막 설정 실패');
    }
  } catch (error) {
    chat.system(error.message);
  }
};

$('captions').addEventListener('click', () => {
  const active = Number($('captions').dataset.subtitle) >= 0;

  void caption(active ? -1 : 0);
});
$('settings').addEventListener('click', () => {
  $('settings-menu').hidden = !$('settings-menu').hidden;
  $('subtitle-menu').hidden = true;
  $('qualities').hidden = true;
});
$('subtitle-settings').addEventListener('click', () => {
  $('settings-menu').hidden = true;
  $('subtitle-menu').hidden = false;
});
$('subtitle-back').addEventListener('click', () => {
  $('subtitle-menu').hidden = true;
  $('settings-menu').hidden = false;
});
$('subtitle-options').addEventListener('click', event => {
  const button = event.target.closest('[data-subtitle]');

  if (button) {
    void caption(Number(button.dataset.subtitle));
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.video-settings')) {
    $('settings-menu').hidden = true;
    $('subtitle-menu').hidden = true;
  }
});
$('pip').disabled = !document.pictureInPictureEnabled;
$('pip').addEventListener('click', async () => {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
    else {
      await $('video').requestPictureInPicture();
    }
  } catch {
    chat.system('PIP 실행 실패');
  }
});
$('theater').addEventListener('click', () => {
  document.body.classList.toggle('theater');
});

const thumbnail = document.createElement('video');
const canvas = $('timeline-image');
let thumbnails;
let source = '';
let desired = 0;
let previewTimer;

thumbnail.muted = true;
thumbnail.playsInline = true;
thumbnail.preload = 'metadata';

function resetPreview() {
  clearTimeout(previewTimer);
  thumbnails?.destroy();
  thumbnails = null;
  source = '';
  thumbnail.removeAttribute('src');
  thumbnail.load();
  $('timeline-preview').hidden = true;
  canvas.hidden = true;
  $('timeline-placeholder').hidden = false;
}

const draw = () => {
  if (thumbnail.readyState < 2 || Math.abs(thumbnail.currentTime - desired) > 1) {
    return;
  }

  canvas.getContext('2d').drawImage(thumbnail, 0, 0, canvas.width, canvas.height);
  canvas.hidden = false;
  $('timeline-placeholder').hidden = true;
  thumbnails?.stopLoad();
};

const seekPreview = () => {
  if (!thumbnail.readyState) {
    return;
  }

  if (Math.abs(thumbnail.currentTime - desired) < 0.1 && thumbnail.readyState >= 2) {
    draw();

    return;
  }

  thumbnails?.startLoad(desired);
  thumbnail.currentTime = desired;
};

thumbnail.addEventListener('loadedmetadata', seekPreview);
thumbnail.addEventListener('loadeddata', draw);
thumbnail.addEventListener('seeked', draw);

const frame = time => {
  desired = time;

  if (source !== attached) {
    resetPreview();
    source = attached;
    $('timeline-preview').hidden = false;

    if (!source) {
      return;
    }

    if (Hls.isSupported()) {
      thumbnails = new Hls({
        autoStartLoad: false,
        startPosition: desired,
        maxBufferLength: 4,
        maxMaxBufferLength: 8,
        backBufferLength: 0
      });
      thumbnails.on(Hls.Events.MANIFEST_PARSED, () => thumbnails?.startLoad(desired));
      thumbnails.on(Hls.Events.ERROR, (event, error) => {
        if (error.fatal) {
          thumbnails?.stopLoad();
        }
      });
      thumbnails.attachMedia(thumbnail);
      thumbnails.loadSource(source);
    }
    else if (thumbnail.canPlayType('application/vnd.apple.mpegurl')) {
      thumbnail.src = source;
    }
  }

  seekPreview();
};

const preview = event => {
  const timeline = $('timeline');

  if (timeline.disabled) {
    return;
  }

  const bounds = timeline.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const maximum = Number(timeline.max);
  const offset = maximum * (1 - ratio);
  const time = Math.max(0, Math.min(maximum - 0.5, maximum * ratio));
  const panel = $('timeline-preview');
  const width = $('player').clientWidth;
  const left = Math.max(100, Math.min(width - 100, event.clientX - bounds.left + 16));

  panel.style.setProperty('--position', `${left}px`);
  $('timeline-offset').textContent = offset < 1 ? '라이브' : `-${clock(offset)}`;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => frame(time), 120);
  panel.hidden = false;
};

$('timeline').addEventListener('pointermove', preview);
$('timeline').addEventListener('pointerdown', preview);
$('timeline').addEventListener('pointerleave', () => {
  clearTimeout(previewTimer);
  thumbnails?.stopLoad();
  $('timeline-preview').hidden = true;
});
$('timeline').addEventListener('blur', () => {
  $('timeline-preview').hidden = true;
});
$('pause').addEventListener('click', () => {
  const video = $('video');

  if (video.paused) {
    video.play().catch(() => {});
  }
  else {
    live = false;
    video.pause();
  }
});
$('volume').addEventListener('click', () => {
  $('video').muted = !$('video').muted;
  controls();
});

async function save() {
  const button = $('video-save');
  const url = button.dataset.url;

  if (saving || !url) {
    return;
  }

  const date = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  const title = broadcaster?.station?.user_nick || player || 'SOOP';
  const suggested = `${title}_${date}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') + '.ts';
  let name = suggested;
  let handle;

  saving = true;
  button.disabled = true;

  try {
    if (typeof window.showSaveFilePicker === 'function') {
      handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: '동영상', accept: { 'video/mp2t': ['.ts'] } }]
      });
    }
    else {
      name = window.prompt('파일 이름', suggested);

      if (!name?.trim()) {
        return;
      }
    }

    const address = new URL(url, location.href);

    address.searchParams.set('name', name);

    if (handle) {
      const response = await fetch(address);

      if (!response.ok) {
        const data = await response.json();

        throw new Error(data.error || '영상 저장 실패');
      }

      if (!response.body) {
        throw new Error('영상 저장 실패');
      }

      let writable;

      try {
        writable = await handle.createWritable();
      } catch (error) {
        await response.body.cancel();

        throw error;
      }

      await response.body.pipeTo(writable);
    }
    else {
      const link = document.createElement('a');

      link.href = address.href;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      status(error instanceof TypeError ? '영상 저장 실패' : error.message, true);
    }
  } finally {
    saving = false;
    button.disabled = !button.dataset.url;
  }
}

$('video-save').addEventListener('click', save);
$('video-clip').addEventListener('click', () => {
  const button = $('video-clip');
  const url = new URL('/vodclip/index.php/', DOMAIN.clip);

  url.search = new URLSearchParams({
    bj_id: button.dataset.streamer,
    broad_no: button.dataset.broad,
    type: 'catch',
    system: 'html5',
    second: '0',
    midroll: '0'
  });
  window.open(url.href, 'soop-clip', 'popup,width=900,height=760');
});
$('fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  else {
    $('player')
      .requestFullscreen()
      .catch(() => {});
  }
});
$('rewind').addEventListener('click', () => {
  live = false;
  $('video').playbackRate = 1;
  $('video').currentTime = Math.max(0, $('video').currentTime - 10);
  controls();
});
$('live').addEventListener('click', () => {
  sync();
  $('video')
    .play()
    .catch(() => {});
});
$('timeline').addEventListener('input', () => {
  moving = true;
  fill($('timeline'));
  $('clock').textContent = clock(Number($('timeline').value));
});
$('timeline').addEventListener('change', () => {
  const target = Number($('timeline').value);
  const edge = position();

  live = edge !== null && target >= edge - 3;
  $('video').playbackRate = 1;
  $('video').currentTime = target;
  moving = false;
  overlay();
});
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.target.closest('#conversation')) {
    return;
  }

  const editing = event.target.closest('input, textarea, select, [contenteditable]');

  if (editing || event.ctrlKey || event.altKey || event.metaKey || $('screen').hidden) {
    return;
  }

  const video = $('video');
  const key = event.key.toLowerCase();

  if (
    [
      ' ',
      'k',
      'm',
      'f',
      'l',
      's',
      'arrowleft',
      'arrowright',
      'arrowup',
      'arrowdown',
      'escape'
    ].includes(key)
  ) {
    event.preventDefault();
  }
  else {
    return;
  }

  if (key === ' ' || key === 'k') {
    $('pause').click();
  }
  else if (key === 'm') {
    $('volume').click();
  }
  else if (key === 'f') {
    $('fullscreen').click();
  }
  else if (key === 'l') {
    $('live').click();
  }
  else if (key === 's') {
    $('theater').click();
  }
  else if (key === 'escape') {
    $('qualities').hidden = true;
  }
  else if (key === 'arrowup' || key === 'arrowdown') {
    const step = key === 'arrowup' ? 0.05 : -0.05;

    video.volume = Math.max(0, Math.min(1, video.volume + step));
    video.muted = video.volume === 0;
  }
  else if (video.readyState) {
    const step = key === 'arrowleft' ? -10 : 10;
    const edge = position() ?? video.currentTime;

    live = false;
    video.playbackRate = 1;
    video.currentTime = Math.max(0, Math.min(edge, video.currentTime + step));
  }

  controls();
});
$('video').addEventListener('timeupdate', controls);
$('video').addEventListener('seeked', controls);
$('video').addEventListener('pause', controls);
$('video').addEventListener('volumechange', controls);
for (const event of ['waiting', 'stalled']) {
  $('video').addEventListener(event, () => {
    const video = $('video');

    if (attached && !video.paused && video.readyState < 3) {
      overlay('로딩 중');
    }
  });
}
$('video').addEventListener('playing', () => {
  if (notice === '로딩 중') {
    overlay('');
  }
});
$('video').addEventListener('loadeddata', () => {
  if (paused) {
    $('video').pause();
  }
  else {
    const current = playback;

    $('video')
      .play()
      .catch(() => {
        if (current === playback) {
          $('video').muted = true;
          $('video')
            .play()
            .catch(() => {});
        }
      });
  }

  controls();
});
$('video').addEventListener('play', () => {
  if (live) {
    sync();
  }

  controls();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && live && !$('video').paused) {
    sync();
  }
});
window.addEventListener('pagehide', () => {
  remember();
  clearInterval(watching);
  stop();
});

function avatar(id, value) {
  const image = $(id);
  let url;

  try {
    url = new URL(value, DOMAIN.soop);
  } catch {}

  const valid = value && url?.protocol === 'https:';

  image.hidden = !valid;

  if (valid) {
    if (image.src !== url.href) {
      image.src = url.href;
    }
  }
  else {
    image.removeAttribute('src');
  }
}

function details(profile) {
  const station = profile?.station || {};
  const stats = profile?.status || {};
  const updates = station.upd || {};
  const subscription = profile?.subscription || {};
  const dashboard = profile?.dashboard || {};
  const number = value => {
    if (value === undefined || value === null || value === '') {
      return '';
    }

    const result = Number(value);

    if (!Number.isFinite(result)) {
      return '';
    }

    return result.toLocaleString('ko-KR');
  };
  const count = value => {
    const result = number(value);

    return result ? `${result}명` : '';
  };
  const time = station.total_broad_time;
  const hours = time === undefined ? '' : number(Math.floor(Number(time) / 3600));
  const ranks = [];

  for (const rank of dashboard.rank || []) {
    if (Number(rank.totalRank) > 0) {
      ranks.push([rank.rankName, `${number(rank.totalRank)}위`]);
    }
  }

  const groups = [
    ['순위', ranks],
    [
      '방송 정보',
      [
        ['방송국 개설일', station.jointime?.slice(0, 10)],
        ['총 방송 시간', hours ? `${hours}시간` : ''],
        ['누적 유저', count(stats.total_view_cnt ?? updates.total_view_cnt)],
        ['누적 UP 수', number(stats.total_ok_cnt ?? updates.total_ok_cnt)],
        ['오늘의 UP', number(stats.today_ok_cnt ?? updates.today0_ok_cnt)],
        ['누적 방문 수', number(stats.total_visit_cnt ?? updates.total_visit_cnt)],
        ['오늘 방문 수', number(stats.today_visit_cnt ?? updates.today0_visit_cnt)],
        ['최근 방송일', station.broad_start?.slice(0, 16)]
      ]
    ],
    [
      '후원 정보',
      [
        ['애청자 수', count(stats.fan_cnt ?? updates.fan_cnt)],
        ['구독팬 수', count(subscription.total ?? stats.total_sub_cnt)],
        ['베이직', count(subscription.tier1)],
        ['플러스', count(subscription.tier2)],
        ['팬클럽 수', count(dashboard.fanclubCnt)],
        ['서포터 수', count(dashboard.supporterCnt)]
      ]
    ]
  ];

  $('profile-details').replaceChildren();

  const left = document.createElement('div');
  const right = document.createElement('div');

  for (const [title, rows] of groups) {
    const section = document.createElement('div');
    const heading = document.createElement('h3');
    const list = document.createElement('dl');

    heading.textContent = title;

    for (const [label, value] of rows) {
      if (!value) {
        continue;
      }

      const term = document.createElement('dt');
      const description = document.createElement('dd');

      term.textContent = label;
      description.textContent = value;
      list.append(term, description);
    }

    if (list.children.length) {
      section.append(heading, list);

      if (title === '방송 정보') {
        right.append(section);
      }
      else {
        left.append(section);
      }
    }
  }

  for (const column of [left, right]) {
    if (column.children.length) {
      $('profile-details').append(column);
    }
  }
}

function inspect(profile) {
  avatar('profile-portrait', profile?.image);
  $('profile-name').textContent = profile?.station?.user_nick || profile?.id || '';
  $('profile-id').textContent = profile?.id || '';
  $('profile-description').textContent = profile?.station?.description || '';
  $('profile-description').hidden = !$('profile-description').textContent;
  details(profile);

  if (!$('profile').open) {
    $('profile').showModal();
  }
}

function duration() {
  if (!started) {
    $('video-duration').textContent = '';

    return;
  }

  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');

  $('video-duration').textContent = `${hours}:${minutes}:${remainder} 방송 중`;
}

function statistics(data) {
  const profile = data.profile;
  const active = Boolean(profile?.broad);
  const broadcast = data.broadcast || {};

  $('video-broadcast').textContent = active
    ? broadcast.title || profile.broad.broad_title || ''
    : '';

  const streamer = profile?.id || data.player;
  const number = broadcast.number || profile?.broad?.broad_no;

  $('video-broadcast').removeAttribute('href');

  if (active && streamer && number) {
    $('video-broadcast').href = new URL(
      `/${encodeURIComponent(streamer)}/${encodeURIComponent(number)}`,
      DOMAIN.play
    ).href;
  }

  const tags = $('video-tags');

  tags.replaceChildren();
  $('video-clip').disabled = !active || !broadcast.number;
  $('video-clip').dataset.broad = broadcast.number || '';
  $('video-clip').dataset.streamer = profile?.id || data.player || '';

  if (active) {
    const hashtags = String(broadcast.hashtag || '')
      .split(/[,#]/)
      .map(tag => tag.trim())
      .filter(Boolean);
    const categories = broadcast.categories?.length
      ? broadcast.categories
      : [broadcast.category];
    const groups = [
      ['language', broadcast.languages || []],
      ['category', categories],
      ['tag', hashtags]
    ];

    for (const [kind, values] of groups) {
      for (const value of new Set(values.filter(Boolean))) {
        const link = document.createElement('a');
        const route =
          kind === 'category'
            ? `/directory/category/${encodeURIComponent(value)}/live`
            : '/search';
        const url = new URL(route, DOMAIN.soop);

        if (kind !== 'category') {
          url.search = new URLSearchParams({
            hash: 'hashtag',
            tagname: value,
            hashtype: 'live',
            stype: 'hash',
            acttype: 'total',
            location: 'live'
          });
        }

        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = value;
        tags.append(link);
      }
    }
  }

  const values = {
    subscription: profile?.subscription?.total,
    favorite: profile?.status?.fan_cnt,
    up: profile?.status?.today_ok_cnt
  };

  for (const [id, value] of Object.entries(values)) {
    const number = Number(value);
    const valid =
      active && value !== undefined && value !== null && Number.isFinite(number);
    const element = $(`video-${id}-count`);

    element.textContent = valid ? number.toLocaleString('ko-KR') : '';
  }

  $('video-name').textContent = data.name || profile?.station?.user_nick || '';
  $('video-password').hidden = !active || !data.restricted?.password;
  $('video-adult').hidden = !active || !data.restricted?.adult;
  avatar('video-portrait', profile?.image);
  $('video-station').href = new URL(
    `/station/${encodeURIComponent(profile?.id || data.player || '')}`,
    DOMAIN.soop
  ).href;

  $('video-name').href = $('video-station').href;

  $('video-subscription').classList.toggle('active', profile?.subscribed === true);
  $('video-favorite').classList.toggle('active', profile?.favorite === true);
  $('members-count').textContent = Number(data.viewers || 0).toLocaleString('ko-KR');

  const date = active && profile.station?.broad_start;
  const time = date ? Date.parse(date.replace(' ', 'T') + '+09:00') : NaN;

  started = Number.isFinite(time) ? time : 0;
  duration();
}

function assets(data) {
  chat.update(data);
  statistics(data);
  ceremonies = data.ceremonies || {};

  const origin = data.origins?.[0];

  link = origin ? new URL(`/#${token}`, origin).href : '';
  $('link-copy').hidden = !link;

  const name = data.name || '';

  $('broadcaster').textContent = name;
  document.title = name || '매크로';

  const profile = data.profile;

  broadcaster = profile;

  const station = profile?.id || data.player;

  if (station) {
    $('station').href = new URL(
      `/station/${encodeURIComponent(station)}`,
      DOMAIN.soop
    ).href;
  }
  else {
    $('station').removeAttribute('href');
  }

  const emblem = profile?.status?.emblem_img_url;
  const grade = String(profile?.status?.emblem_grade || '').toLowerCase();
  const level = String(profile?.status?.emblem_level || '').toLowerCase();
  let title = emblems[grade] || '';

  if (title && grade !== 'prestige' && ['lv1', 'lv2', 'lv3'].includes(level)) {
    title += level.slice(2);
  }

  avatar('portrait', profile?.image);
  avatar('emblem', emblem);
  $('emblem').title = title;
  avatar('video-emblem', emblem);
  $('video-emblem').title = title;
  $('information').disabled = !profile;

  const channel = data.player || '';

  $('screen').hidden = !channel;

  if (player !== channel) {
    player = channel;
    live = true;
    clearInterval(watching);
    saved = undefined;

    try {
      saved = JSON.parse(sessionStorage.getItem(`video:${player}`));
    } catch {}

    if (player) {
      void play();
      watching = setInterval(() => void play(), 3000);
    }
    else {
      stop();
    }
  }

  const icons = data.emoticons || [];

  if (JSON.stringify(emoticons) !== JSON.stringify(icons)) {
    emoticons = icons;
    emojis();
    message(document.activeElement === $('message'));
  }

  const changed = JSON.stringify(packs) !== JSON.stringify(data.packs);

  if (changed) {
    packs = data.packs;
    gallery();

    if (config.rules[selected]) {
      stickers();
    }
  }

  if (config.rules[selected]) {
    sample();
  }
}

async function load() {
  if (busy) {
    return;
  }

  busy = true;

  try {
    const data = await request();

    if (!config || (!dirty && revision !== data.revision)) {
      apply(data);
      status('');
    }
    else if (dirty && revision !== data.revision) {
      status('파일이 변경되었습니다. 화면을 새로고침해주세요.', true);
    }

    assets(data);
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    $('save').disabled = !dirty;
  }
}

$('form').addEventListener('submit', event => event.preventDefault());
$('form').addEventListener('input', event => {
  if (['emoticon-search', 'message'].includes(event.target.id)) {
    return;
  }

  capture();
});
$('form').addEventListener('change', event => {
  if (['emoticon-search', 'message'].includes(event.target.id)) {
    return;
  }

  if (event.target.id === 'kind') {
    const kind = $('kind').value;
    const moderation = ['mute', 'kick', 'warn'].includes($('action').value);
    const command = ['multi', 'notify'].includes($('action').value) && kind !== 'command';

    if (command || (moderation && ['interval', 'event'].includes(kind))) {
      $('action').value = 'reply';
    }

    if (kind === 'interval' && $('output').value === 'direct') {
      $('output').value = 'chat';
    }
  }

  capture();
});
$('ogq').addEventListener('click', () => {
  $('picker').hidden = !$('picker').hidden;
  $('emoticon-picker').hidden = true;
  gallery();
  stickers();
});
$('emoticon').addEventListener('click', () => {
  $('emoticon-picker').hidden = !$('emoticon-picker').hidden;
  $('picker').hidden = true;
  emojis();
});
$('emoticon-search').addEventListener('input', () => {
  emojis();
});
$('emoticons').addEventListener('scroll', () => {
  const list = $('emoticons');
  const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;

  if (remaining < 96) {
    emojis(true);
  }
});
$('attachment').addEventListener('click', () => {
  pack = '';
  number = 1;
  capture();
  gallery();
  stickers();
  $('picker').hidden = true;
});
$('search').addEventListener('input', () => {
  if (config) {
    list();
  }
});
$('enabled').addEventListener('change', () => {
  if (config) {
    config.enabled = $('enabled').checked;
    $('menu-enabled').checked = config.enabled;
    changed();
  }
});
$('add').addEventListener('click', () => {
  if (!config) {
    return;
  }

  config.rules.push({
    name: '새 명령어',
    enabled: false,
    kind: 'command',
    pattern: '!인사',
    reply: ['{이름}님 안녕하세요!']
  });
  selected = config.rules.length - 1;
  $('search').value = '';
  changed();
  render();
  scroll();
  $('macros').dataset.page = 'edit';
});
$('duplicate').addEventListener('click', () => {
  const original = config.rules[selected];
  const rule = structuredClone(original);
  const draft = drafts.get(original);

  if (draft) {
    drafts.set(rule, { ...draft });
  }

  delete rule.id;
  rule.name = `${rule.name || '규칙'} 복사`;
  rule.enabled = false;
  config.rules.splice(selected + 1, 0, rule);
  selected++;
  $('search').value = '';
  changed();
  render();
  scroll();
});
$('remove').addEventListener('click', () => {
  if (!confirm('이 규칙을 삭제할까요?')) {
    return;
  }

  config.rules.splice(selected, 1);
  selected = Math.min(selected, config.rules.length - 1);
  changed();
  render();
  scroll();
});
for (const [id, offset] of [
  ['up', -1],
  ['down', 1]
]) {
  $(id).addEventListener('click', () => {
    const target = selected + offset;

    if (target < 0 || target >= config.rules.length) {
      return;
    }

    const [rule] = config.rules.splice(selected, 1);

    config.rules.splice(target, 0, rule);
    selected = target;
    changed();
    render();
    scroll();
  });
}
$('save').addEventListener('click', async () => {
  if (busy || !config) {
    return;
  }

  busy = true;
  $('save').disabled = true;
  $('form').inert = true;
  $('list').inert = true;
  $('enabled').disabled = true;
  $('menu-enabled').disabled = true;
  $('add').disabled = true;

  try {
    for (const rule of config.rules) {
      roulette(rule);
    }

    const data = await request('PUT', { config, revision });

    apply(data);
    assets(data);
    status('저장했습니다.');
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    $('form').inert = false;
    $('list').inert = false;
    $('enabled').disabled = false;
    $('menu-enabled').disabled = false;
    $('add').disabled = false;
    $('save').disabled = !dirty;
  }
});

async function watch() {
  try {
    const response = await fetch('/api/editor', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream'
      }
    });

    if (response.ok) {
      const reader = response.body.getReader();

      while (true) {
        const result = await reader.read();

        if (result.done) {
          break;
        }
      }
    }
  } catch {}

  setTimeout(watch, 2000);
}

window.addEventListener('beforeunload', event => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

$('information').addEventListener('click', () => {
  inspect(broadcaster);
});

$('profile-close').addEventListener('click', () => {
  $('profile').close();
});

function popup() {
  $('menu-items').hidden = true;
  $('macros').dataset.page = 'list';

  if (!$('macros').open) {
    $('macros').showModal();
  }
}

$('menu').addEventListener('click', () => {
  $('menu-items').hidden = !$('menu-items').hidden;
});

document.addEventListener('click', event => {
  if (!event.target.closest('.menu')) {
    $('menu-items').hidden = true;
  }
});

$('macro-open').addEventListener('click', popup);

function notification(data) {
  const config = data.config;
  const groups = new Map();

  $('notify-enabled').checked = config.enabled;
  $('notify-server').value = config.server;
  $('notify-topic').value = config.topic;
  $('notify-token').value = '';
  $('notify-token').placeholder = data.authenticated ? '기존 토큰 유지' : '';
  $('notify-clear').checked = false;
  $('notify-clear').parentElement.hidden = !data.authenticated;
  $('notify-keywords').value = config.keywords.join('\n');
  $('notify-nicknames').value = config.nicknames.join('\n');
  $('notify-events').replaceChildren();

  for (const [key, [group, name]] of Object.entries(data.events)) {
    if (!groups.has(group)) {
      const field = document.createElement('fieldset');
      const title = document.createElement('legend');

      title.textContent = group;
      field.append(title);
      groups.set(group, field);
      $('notify-events').append(field);
    }

    const label = document.createElement('label');
    const input = document.createElement('input');
    const text = document.createElement('span');

    label.className = 'switch';
    input.type = 'checkbox';
    input.dataset.event = key;
    input.checked = config.events[key];
    text.textContent = name;
    label.append(input, text);
    groups.get(group).append(label);
  }
}

function notifications() {
  const events = Object.fromEntries(
    [...$('notify-events').querySelectorAll('input')].map(input => {
      return [input.dataset.event, input.checked];
    })
  );
  const config = {
    enabled: $('notify-enabled').checked,
    server: $('notify-server').value.trim(),
    topic: $('notify-topic').value.trim(),
    keywords: $('notify-keywords').value.split('\n').map(value => value.trim()).filter(Boolean),
    nicknames: $('notify-nicknames').value.split('\n').map(value => value.trim()).filter(Boolean),
    events
  };
  const token = $('notify-token').value.trim();

  if ($('notify-clear').checked) {
    config.token = '';
  }
  else if (token) {
    config.token = token;
  }

  return config;
}

$('notify-open').addEventListener('click', async () => {
  $('menu-items').hidden = true;
  $('notify-open').disabled = true;

  try {
    const data = await request('GET', undefined, '/api/notify');

    notification(data);
    $('notify-connection').open = !data.connected;
    $('notify-status').hidden = true;
    $('notify').showModal();
  } catch (error) {
    status(error.message, true);
  } finally {
    $('notify-open').disabled = false;
  }
});

$('notify-close').addEventListener('click', () => $('notify').close());

async function notify(method) {
  $('notify-test').disabled = true;
  $('notify-save').disabled = true;
  $('notify-status').hidden = true;

  try {
    const data = await request(method, notifications(), '/api/notify');

    if (method === 'PUT') {
      notification(data);
    }

    $('notify-status').textContent = method === 'PUT' ? '저장되었습니다.' : '알림을 전송했습니다.';
    $('notify-status').classList.remove('error');
  } catch (error) {
    $('notify-status').textContent = error.message;
    $('notify-status').classList.add('error');
  } finally {
    $('notify-status').hidden = false;
    $('notify-test').disabled = false;
    $('notify-save').disabled = false;
  }
}

$('notify-form').addEventListener('submit', event => {
  event.preventDefault();
  void notify('PUT');
});

$('notify-test').addEventListener('click', () => void notify('POST'));

$('link-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link);
    $('link-copy').textContent = '복사되었습니다';
    setTimeout(() => {
      $('link-copy').textContent = '접속 주소 복사';
    }, 2000);
  } catch {
    status('접속 주소를 복사할 수 없습니다.', true);
  }
});

$('menu-enabled').addEventListener('change', () => {
  if (!config) {
    return;
  }

  $('enabled').checked = $('menu-enabled').checked;
  config.enabled = $('enabled').checked;
  changed();

  if (config.enabled) {
    popup();
  }
});

$('macro-close').addEventListener('click', () => {
  $('macros').close();
});

$('macro-back').addEventListener('click', () => {
  $('macros').dataset.page = 'list';
});

for (const id of ['profile', 'macros', 'notify']) {
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

for (const id of [
  'portrait',
  'emblem',
  'profile-portrait',
  'video-portrait',
  'video-emblem'
]) {
  $(id).addEventListener('error', () => {
    $(id).hidden = true;
  });
}

const chat = createChat(() => token, inspect);
const broadcastTimer = setInterval(duration, 1000);

window.addEventListener('pagehide', () => clearInterval(broadcastTimer));

watch();
await load();
setInterval(() => load(), 5000);
