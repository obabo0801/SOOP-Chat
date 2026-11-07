import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as native from '../src/soop/editor/native.js';

function fixture(available = true) {
  const messages = [];
  const returned = [];
  const video = Object.assign(new EventTarget(), { currentTime: 12, muted: false, volume: .7,
    videoWidth: 1280, videoHeight: 720, paused: false, ended: false,
    seekable: { length: 1, start: () => 10, end: () => 100 },
    getBoundingClientRect: () => ({ left: 12, top: 80, width: 320, height: 180 }),
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); } });
  const previous = { window: globalThis.window, location: globalThis.location, document: globalThis.document };
  const window = new EventTarget();
  window.innerWidth = 360;
  if (available) window.SoopAndroid = { postMessage: value => messages.push(JSON.parse(value)) };
  globalThis.window = window;
  globalThis.location = new URL('https://example.com/2/');
  const state = { url: '/2/media/stream/0?media=ticket', title: '테스트 방송',
    artist: '테스트 스트리머', artwork: 'http://example.com/profile.jpg',
    live: true, enabled: true, paused: false };
  const bridge = native.createNative(video, () => state, value => returned.push(value));
  return { video, bridge, messages, returned, state,
    theme(dark) {
      globalThis.document = { documentElement: { classList: { contains: () => dark } } };
      window.dispatchEvent(new Event('theme'));
    },
    event(detail) { window.dispatchEvent(Object.assign(new Event('soopnative'), { detail })); },
    close() {
      globalThis.window = previous.window;
      globalThis.location = previous.location;
      globalThis.document = previous.document;
    } };
}

test.test('native bars follow the initial theme and subsequent theme changes', () => {
  const f = fixture();
  try {
    f.theme(true);
    native.syncTheme();
    assert.deepEqual(f.messages.at(-1), { type: 'theme', dark: true });
    f.theme(false);
    assert.deepEqual(f.messages.at(-1), { type: 'theme', dark: false });
  } finally { f.close(); }
});

test.test('ordinary browsers keep their existing player', () => {
  const f = fixture(false);
  try {
    f.bridge.publish(true);
    f.video.dispatchEvent(new Event('playing'));
    assert.equal(f.bridge.available, false);
    assert.equal(f.messages.length, 0);
    assert.equal(f.video.paused, false);
  } finally { f.close(); }
});

test.test('native playback receives a usable HTTPS source and current playback state', () => {
  const f = fixture();
  try {
    f.bridge.enter();
    assert.equal(f.messages.length, 2);
    assert.equal(f.messages[0].url, 'https://example.com/2/media/stream/0?media=ticket');
    assert.equal(f.messages[0].playing, true);
    assert.equal(f.messages[0].position, 12);
    assert.equal(f.messages[0].start, 10);
    assert.equal(f.messages[0].end, 100);
    assert.deepEqual(f.messages[0].bounds, { x: 12, y: 80, width: 320, height: 180, viewport: 360 });
    assert.equal(f.messages[0].title, '테스트 방송');
    assert.equal(f.messages[0].artist, '테스트 스트리머');
    assert.equal(f.messages[0].artwork, 'https://example.com/profile.jpg');
    assert.equal(f.messages[1].type, 'pip');
    f.state.enabled = false;
    f.bridge.publish(true);
    assert.equal(f.messages.at(-1).playing, false);
  } finally { f.close(); }
});

test.test('handoff pauses the web decoder without publishing a user pause', () => {
  const f = fixture();
  try {
    f.event({ type: 'pip', active: true });
    assert.equal(f.bridge.active(), true);
    assert.equal(f.video.paused, true);
    assert.equal(f.messages.length, 0);
    f.video.dispatchEvent(new Event('timeupdate'));
    assert.equal(f.messages.length, 0);
    f.event({ type: 'pip', active: false, playing: false, position: 15 });
    assert.equal(f.bridge.active(), false);
    assert.equal(f.returned[0].playing, false);
    assert.equal(f.returned[0].position, 15);
  } finally { f.close(); }
});

test.test('incomplete events cannot switch playback ownership', () => {
  const f = fixture();
  try {
    for (const detail of [null, {}, { type: 'pip', active: 'true' }, { type: 'other', active: true }]) f.event(detail);
    assert.equal(f.bridge.active(), false);
    assert.equal(f.video.paused, false);
    assert.equal(f.returned.length, 0);
  } finally { f.close(); }
});

test.test('system media controls pause the inline video without entering PiP', () => {
  const f = fixture();
  try {
    f.event({ type: 'playback', playing: false });
    assert.equal(f.video.paused, true);
    assert.equal(f.bridge.active(), false);
    assert.equal(f.returned.at(-1).playing, false);
  } finally { f.close(); }
});

test.test('media seeks clamp to available video without changing pause state', () => {
  const f = fixture();
  try {
    f.video.paused = true;
    f.event({ type: 'seek', position: -10 });
    assert.deepEqual(f.returned.at(-1), { type: 'seek', position: 10 });
    f.event({ type: 'seek', position: 500 });
    assert.equal(f.returned.at(-1).position, 100);
    f.video.seekable = { length: 2, start: index => index ? 70 : 10, end: index => index ? 100 : 50 };
    f.event({ type: 'seek', position: 60 });
    assert.equal(f.returned.at(-1).position, 70);
    assert.equal(f.video.paused, true);
    f.video.seekable.length = 0;
    const count = f.returned.length;
    f.event({ type: 'seek', position: 25 });
    f.event({ type: 'seek', position: NaN });
    assert.equal(f.returned.length, count);
  } finally { f.close(); }
});
