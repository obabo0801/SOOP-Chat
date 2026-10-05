const $ = id => document.getElementById(id);
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
let config;
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
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

async function request(method = 'GET', data) {
  let response;

  try {
    response = await fetch('/api/config', {
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

function stickers() {
  const item = packs.find(item => item.name === pack);
  const url = item?.images[number - 1];

  $('ogq').title = pack ? `${pack} ${number}` : 'OGQ 선택';
  $('attachment').hidden = !url || $('output').value === 'manager';

  if (url) {
    $('ogq-image').src = url;
    $('ogq-image').alt = `${pack} ${number}`;
  }

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

  for (const option of $('action').options) {
    const moderation = ['mute', 'kick', 'warn'].includes(option.value);

    option.hidden = moderation && ['interval', 'event'].includes(kind);
    option.disabled = option.hidden;
  }

  const direct = $('output').querySelector('option[value="direct"]');

  direct.hidden = kind === 'interval';
  direct.disabled = direct.hidden;
  $('ogq-field').hidden = $('output').value === 'manager';
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
}

function roulette(rule) {
  const draft = drafts.get(rule);

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
  $('save').disabled = true;
  render();
}

function assets(data) {
  const name = data.name || '';

  $('broadcaster').textContent = name;
  document.title = name || '매크로';

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

    if (moderation && ['interval', 'event'].includes(kind)) {
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
watch();
await load();
setInterval(() => load(), 5000);
