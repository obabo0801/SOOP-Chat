import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import * as video from '../src/soop/video.js';

test.test('video resumes after its temporary folder disappears while disabled', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soop-video-test-'));
  const content = Buffer.alloc(188, 0x47);
  const server = http.createServer((request, response) => {
    if (request.url === '/live.m3u8') {
      response.end('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\nsegment.ts\n');
    } else {
      response.setHeader('Content-Type', 'video/mp2t');
      response.end(content);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const player = video.createVideo(async () => ({
    bjId: 'test', broadNo: '1', quality: 'best',
    url: `http://127.0.0.1:${server.address().port}/live.m3u8`
  }), { directory: root });
  t.after(async () => {
    await player.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('soop-video-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });

  await player.start();
  assert.equal(player.snapshot().state, 'live');
  await player.reset();
  const [name] = await fs.readdir(root);
  assert.ok(name.startsWith('soop-video-'));
  const directory = path.join(root, name);
  assert.equal(path.dirname(directory), root);
  await fs.rm(directory, { recursive: true });

  await assert.doesNotReject(player.reset());
  await player.start();
  assert.equal(player.snapshot().state, 'live');
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  assert.deepEqual(await fs.readFile(path.join(directory, files[0])), content);

  await player.reset();
  assert.deepEqual(await fs.readdir(directory), []);
  await player.start();
  assert.equal(player.snapshot().state, 'live');
  await player.close();
  await player.start();
  await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});
