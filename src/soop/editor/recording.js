import * as fs from 'fs/promises';
import * as path from 'path';
const clockModule = new URL('./mpegts.js', import.meta.url);
clockModule.search = new URL(import.meta.url).search;
const mpegts = await import(clockModule.href);

export function create(state, directory = 'videos') {
  let current;
  let job;
  let closed = false;
  const root = path.resolve(directory);
  const read = async url => {
    if (!/^\/media\/[a-f0-9]{48}\/\d+$/.test(url)) throw new Error('녹화 주소 오류');
    let status;
    let content;
    await state.video.send({ url, headers: {} }, {
      writeHead(value) { status = value; },
      end(value) { content = Buffer.from(value || ''); }
    });
    if (status !== 200) throw new Error('녹화 데이터를 읽지 못했습니다.');
    return content;
  };
  const finish = async () => {
    if (current?.mode === 'hls') {
      const file = path.join(current.directory, 'index.m3u8');
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      if (text && !text.includes('#EXT-X-ENDLIST')) await fs.appendFile(file, '#EXT-X-ENDLIST\n');
    }
    current = null;
  };
  const update = async () => {
    if (!state.recordingEnabled || state.videoEnabled === false || !state.macro.client.bjId) {
      await finish();
      return;
    }
    const snapshot = state.video.snapshot();
    if (!snapshot.url || !current && snapshot.state !== 'live') return;
    const text = (await read(snapshot.url)).toString('utf8');
    const urls = text.split(/\r?\n/).filter(line => /^\/media\/[a-f0-9]{48}\/\d+$/.test(line));
    if (!urls.length) return;
    const key = snapshot.url.split('/')[2];
    const encrypted = text.split(/\r?\n/).some(line => line.startsWith('#EXT-X-MAP:')
      || line.startsWith('#EXT-X-KEY:') && !line.includes('METHOD=NONE'));
    const first = !current || current.key !== key ? await read(urls[0]) : null;
    const mode = encrypted || first && first[0] !== 0x47 ? 'hls' : first ? 'ts' : current?.mode || 'ts';
    if (!current || current.key !== key || current.mode !== mode) {
      await finish();
      if (snapshot.state !== 'live') return;
      const id = state.macro.client.bjId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const folder = path.join(root, id);
      await fs.mkdir(folder, { recursive: true });
      let stamp = Date.now();
      let target;
      while (true) {
        const name = new Date(stamp + 9 * 3600000).toISOString()
          .replace('T', '_').replaceAll(':', '').replace('Z', '');
        target = path.join(folder, name);
        try {
          if (mode === 'hls') await fs.mkdir(target);
          else await fs.writeFile(target + '.ts', '', { flag: 'wx' });
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          stamp++;
        }
      }
      current = { key, mode, directory: target, file: target + '.ts', seen: new Set(), clock: mpegts.createClock() };
    }
    if (current.mode === 'ts') {
      const durations = new Map();
      let duration;
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('#EXTINF:')) duration = Number.parseFloat(line.slice(8));
        else if (/^\/media\/[a-f0-9]{48}\/\d+$/.test(line)) durations.set(line, duration);
      }
      for (const url of urls) {
        if (current.seen.has(url)) continue;
        const content = first && url === urls[0] ? first : await read(url);
        if (content[0] !== 0x47) throw new Error('자동 녹화 영상 형식이 변경되었습니다.');
        const pending = current.clock.prepare(content, durations.get(url));
        const size = (await fs.stat(current.file)).size;
        try {
          await fs.appendFile(current.file, pending.data);
        } catch (error) {
          await fs.truncate(current.file, size);
          throw error;
        }
        pending.commit();
        current.seen.add(url);
      }
    }
    else {
      const assets = new Set([...urls, ...[...text.matchAll(/URI="(\/media\/[a-f0-9]{48}\/\d+)"/g)].map(match => match[1])]);
      for (const url of assets) {
        if (current.seen.has(url)) continue;
        const file = path.join(current.directory, path.basename(url) + '.bin');
        await fs.writeFile(file + '.tmp', await read(url));
        await fs.rename(file + '.tmp', file);
        current.seen.add(url);
      }
      const playlist = text.replace(/\/media\/[a-f0-9]{48}\/(\d+)/g, '$1.bin');
      const file = path.join(current.directory, 'index.m3u8');
      await fs.writeFile(file + '.tmp', playlist);
      await fs.rename(file + '.tmp', file);
    }
    state.recordingError = '';
    if (snapshot.state === 'offline' && current) {
      await finish();
    }
  };
  const report = error => {
    const message = error.code === 'ENOSPC' ? '자동 녹화 저장 공간이 부족합니다.' : error.message;
    if (state.recordingError !== message) state.macro.client.emit('error', new Error(message));
    state.recordingError = message;
  };
  const enqueue = operation => {
    const pending = (job || Promise.resolve()).then(operation).catch(report).finally(() => {
      if (job === pending) job = null;
    });
    job = pending;
    return pending;
  };
  const poll = () => closed ? Promise.resolve() : job || enqueue(update);
  const timer = setInterval(() => void poll(), 1500);
  timer.unref();
  return {
    async flush() { if (!closed) await enqueue(update); },
    async finish() {
      if (!closed) await enqueue(async () => { try { await update(); } finally { await finish(); } });
    },
    async close() {
      if (closed) { await job; return; }
      closed = true;
      clearInterval(timer);
      await enqueue(async () => { try { await update(); } finally { await finish(); } });
    }
  };
}
