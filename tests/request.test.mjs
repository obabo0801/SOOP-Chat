import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as network from '../src/soop/editor/request.js';

function delayed(t) {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, timeout: AbortSignal.timeout };
  let calls = 0;
  globalThis.window = { location: new URL('https://example.com/') };
  AbortSignal.timeout = ms => previous.timeout(Math.ceil(ms / 1000));
  globalThis.fetch = (url, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve(new Response(JSON.stringify({ number: 4 }), { status: 200 }));
      }, 35);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  };
  t.after(() => {
    globalThis.fetch = previous.fetch;
    globalThis.window = previous.window;
    AbortSignal.timeout = previous.timeout;
  });
  return () => calls;
}

test.test('screen creation waits beyond the normal request deadline without submitting twice', async t => {
  const calls = delayed(t);
  assert.deepEqual(await network.request('/api/connect', { method: 'POST' }), { number: 4 });
  assert.equal(calls(), 1);
});

test.test('numbered screen connection uses the same startup deadline', async t => {
  const calls = delayed(t);
  assert.deepEqual(await network.request('/2/api/connect?mode=new', { method: 'POST' }), { number: 4 });
  assert.equal(calls(), 1);
});

test.test('ordinary writes keep their existing timeout and are not retried', async t => {
  const calls = delayed(t);
  await assert.rejects(network.request('/api/config', { method: 'POST' }), /연결이 지연되고 있습니다/);
  assert.equal(calls(), 1);
});

test.test('caller cancellation still interrupts a pending screen connection', async t => {
  const calls = delayed(t);
  const abort = new AbortController();
  const pending = network.request('/api/connect', { method: 'POST', signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls(), 1);
});
