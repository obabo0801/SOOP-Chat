import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

function segments(text, source) {
  const result = [];
  let sequence = 0;
  let duration = 0;
  let tags = [];
  let key = '';
  let map = '';
  let date;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.split(':')[1]);
    }
    else if (line.startsWith('#EXT-X-KEY:')) {
      key = line;
    }
    else if (line.startsWith('#EXT-X-MAP:')) {
      map = line;
    }
    else if (line.startsWith('#EXTINF:')) {
      duration = Number.parseFloat(line.slice(8));
      tags.push(line);
    }
    else if (/^#EXT-X-(DISCONTINUITY|PROGRAM-DATE-TIME|BYTERANGE)(:|$)/.test(line)) {
      tags.push(line);

      if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
        date = Date.parse(line.slice(25));
      }
    }
    else if (line && !line.startsWith('#') && duration > 0) {
      const url = new URL(line, source).href;
      const content = [key, map, ...tags].filter(Boolean);

      result.push({ sequence, duration, url, content, date });
      date += duration * 1000;
      sequence++;
      duration = 0;
      tags = [];
    }
  }

  return result;
}

function manifest(stream, link) {
  const duration = stream.segments.reduce((value, item) => {
    return Math.max(value, Math.ceil(item.duration));
  }, 1);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    '#EXT-X-MEDIA-SEQUENCE:0',
    `#EXT-X-TARGETDURATION:${duration}`
  ];

  for (const item of stream.segments) {
    lines.push(...item.content.map(line => line.replace(/URI="([^"]+)"/g,
      (_, uri) => `URI="${link(uri)}"`)), link(item.url));
  }

  if (stream.ended) {
    lines.push('#EXT-X-ENDLIST');
  }

  return lines.join('\n') + '\n';
}

export function createVideo(provider, options = {}) {
  const streams = new Map();
  const requests = new Set();
  const lifetime = new AbortController();
  const folder = fs.mkdtemp(path.join(options.directory || os.tmpdir(), 'soop-video-'));
  let generation = 0;
  let transition = new AbortController();
  let active;
  let recorded;
  let quality = 'best';
  let automatic = true;
  let upgrade = 0;
  let qualities = [];
  let state = 'loading';
  let message = '';
  let next = 0;
  let timer;
  let job;
  let closed = false;
  let paused = false;
  let closing;
  let available = true;
  let checked = 0;

  const refresh = async () => {
    if (!options.available || Date.now() < checked) {
      return;
    }

    available = await options.available(active?.transport, active?.source);
    checked = Date.now() + 5000;
  };

  const selectable = () => {
    const result = qualities.map(item => {
      const disabled = !available && Number.parseInt(item.label, 10) > 540;

      return { ...item, disabled };
    });

    return result;
  };

  const fetchVideo = async (url, source) => {
    if (new URL(url).origin !== new URL(source.url).origin) {
      throw new Error('주소 오류');
    }

    const controller = new AbortController();

    requests.add(controller);

    try {
      const response = await fetch(url, {
        headers: source.headers,
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
      });

      if (!response.ok) {
        await response.body?.cancel();

        throw new Error('연결 실패');
      }

      const chunks = [];
      let size = 0;

      for await (const chunk of response.body) {
        size += chunk.length;

        if (size > 16777216) {
          throw new Error('용량 초과');
        }

        chunks.push(chunk);
      }

      return {
        content: Buffer.concat(chunks),
        type: response.headers.get('content-type') || 'application/octet-stream'
      };
    } finally {
      requests.delete(controller);
    }
  };

  const write = async (stream, data) => {
    const id = stream.index++;
    const directory = await folder;
    const file = path.join(directory, `${stream.key}-${id}`);
    const space = await fs.statfs(directory);

    if (space.bavail * space.bsize < 67108864) {
      const error = new Error('녹화 공간 부족');

      error.code = 'ENOSPC';

      throw error;
    }

    await fs.writeFile(file, data.content, { flag: 'wx', mode: 0o600 });
    stream.files.set(id, { file, type: data.type, size: data.content.length });

    const address = `/media/${stream.key}/${id}`;

    return address;
  };

  const save = async (stream, url) => {
    if (stream.paths.has(url)) {
      return stream.paths.get(url);
    }

    const data = await fetchVideo(url, stream.source);
    const address = await write(stream, data);

    stream.paths.set(url, address);

    return address;
  };

  const receive = async stream => {
    if (!stream.transport) {
      stream.transport = options.connect(stream.source);

      const info = await stream.transport.open();

      stream.width = info.width;
      stream.height = info.height;
      stream.discontinuity = stream.segments.length > 0;
    }

    const segment = await stream.transport.read();
    const previous = stream.segments.at(-1);
    const date = previous && !stream.discontinuity
      ? previous.date + previous.duration * 1000 : Date.now() - segment.duration * 1000;
    const url = await write(stream, { content: segment.content, type: 'video/mp2t' });
    const content = [`#EXT-X-PROGRAM-DATE-TIME:${new Date(date).toISOString()}`, `#EXTINF:${segment.duration},`];

    if (stream.discontinuity) {
      content.unshift('#EXT-X-DISCONTINUITY');
      stream.discontinuity = false;
    }

    stream.segments.push({
      sequence: stream.segments.length,
      duration: segment.duration,
      date,
      content,
      url
    });
    stream.duration += segment.duration;
  };

  const record = async stream => {
    if (stream.source.native) {
      await receive(stream);

      return;
    }

    let url = stream.source.url;
    let data = await fetchVideo(url, stream.source);
    let text = data.content.toString('utf8');

    if (text.includes('#EXT-X-STREAM-INF:')) {
      const variant = text.split(/\r?\n/).find(line => line && !line.startsWith('#'));

      if (!variant) {
        throw new Error('목록 오류');
      }

      url = new URL(variant, url).href;
      data = await fetchVideo(url, stream.source);
      text = data.content.toString('utf8');
    }

    if (!text.startsWith('#EXTM3U')) {
      throw new Error('목록 오류');
    }

    const items = segments(text, url);
    const last = stream.segments.at(-1);
    let date = Date.now() - items.reduce((sum, item) => sum + item.duration * 1000, 0);

    for (const item of items) {
      const previous = stream.segments.find(segment => segment.sequence === item.sequence);

      item.date = Number.isFinite(item.date) ? item.date : previous?.date ?? date;
      date = item.date + item.duration * 1000;

      if (!item.content.some(line => line.startsWith('#EXT-X-PROGRAM-DATE-TIME:'))) {
        item.content.unshift(`#EXT-X-PROGRAM-DATE-TIME:${new Date(item.date).toISOString()}`);
      }
    }

    if (last && items.at(-1)?.sequence < last.sequence) {
      stream.seen.clear();
    }

    const pending = items.filter(item => !stream.seen.has(item.sequence));
    const previous = stream.segments.length;

    for (let index = 0; index < pending.length; index += 3) {
      const results = await Promise.allSettled(
        pending.slice(index, index + 3).map(async item => {
          const content = [];

          for (const line of item.content) {
            const match = /URI="([^"]+)"/.exec(line);

            if (match) {
              const address = new URL(match[1], url).href;
              const local = await save(stream, address);

              content.push(line.replace(match[0], `URI="${local}"`));
            }
            else {
              content.push(line);
            }
          }

          const local = await save(stream, item.url);

          return { ...item, content, url: local };
        })
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') {
          continue;
        }

        const item = result.value;
        const previous = stream.segments.at(-1);
        const gap = previous && previous.sequence + 1 !== item.sequence;

        if (gap && !item.content.includes('#EXT-X-DISCONTINUITY')) {
          item.content.unshift('#EXT-X-DISCONTINUITY');
        }

        stream.segments.push(item);
        stream.seen.add(item.sequence);
      }
    }

    if (!stream.segments.length) {
      throw new Error('저장 실패');
    }

    if (pending.length && stream.segments.length === previous) {
      throw new Error('저장 실패');
    }

    stream.ended = text.includes('#EXT-X-ENDLIST');
    stream.duration = stream.segments.reduce((sum, item) => sum + item.duration, 0);
  };

  const update = async () => {
    const current = generation;
    const signal = AbortSignal.any([lifetime.signal, transition.signal]);

    try {
      await refresh();

      if (current !== generation) {
        return;
      }

      if (automatic && available && Date.now() >= upgrade) {
        const highest = [...qualities].sort((a, b) =>
          (Number.parseInt(b.label, 10) || 0) - (Number.parseInt(a.label, 10) || 0))[0];
        const resolution = Number.parseInt(qualities.find(item => item.name === quality)?.label, 10) || 0;
        if (highest && Number.parseInt(highest.label, 10) > resolution) quality = highest.name;
        else if (!qualities.length) quality = 'best';
      }

      if (!available && (quality === 'best'
        || Number.parseInt(qualities.find(item => item.name === quality)?.label, 10) > 540)) {
        quality = 'hd';
      }

      if (!active || Date.now() >= next || active.source.quality !== quality) {
        const source = await provider(quality, signal);

        if (current !== generation) {
          return;
        }

        next = Date.now() + 15000;

        if (closed) {
          return;
        }

        if (!source) {
          if (active) {
            active.transport?.close();
            active.transport = null;
            active.ended = true;
          }

          recorded = active || recorded;
          active = null;
          state = 'offline';
          message = '오프라인';

          return;
        }

        qualities = source.qualities || [];
        quality = source.quality;

        const identity = `${source.bjId}/${source.broadNo}/${source.quality}`;
        let stream = streams.get(identity);

        if (!stream) {
          stream = {
            key: crypto.randomBytes(24).toString('hex'),
            source,
            index: 1,
            files: new Map(),
            paths: new Map(),
            segments: [],
            seen: new Set(),
            duration: 0,
            ended: false
          };
          streams.set(identity, stream);
        }

        if (active && active !== stream) {
          active.transport?.close();
          active.transport = null;
        }

        if (recorded && recorded.source.bjId !== source.bjId) {
          recorded = null;
        }

        stream.source = source;
        stream.ended = false;
        active = stream;
      }

      const stream = active;

      await record(stream);

      if (current !== generation) {
        return;
      }

      recorded = stream;
      state = 'live';
      message = '';
    } catch (error) {
      if (!closed && current === generation) {
        if (active?.transport) {
          active.transport.close(error);
          active.transport = null;
        }

        next = 0;
        state = 'loading';
        if (error.code === 'SOOP_BUSY' || error.message === '패키지 연결 실패') {
          quality = 'hd';
          upgrade = Date.now() + 30000;
          available = false;
          checked = Date.now() + 5000;
          message = '';
        }
        else if (error.code === 'ENOSPC') {
          message = '녹화 공간 부족';
        }
        else if (error.code === 'SOOP_STREAM') {
          message = error.message;
        }
        else {
          message = '로딩 중';
        }
      }
    }
  };

  const run = () => {
    if (closed || paused) {
      return Promise.resolve();
    }

    if (job) {
      return job;
    }

    clearTimeout(timer);
    job = update().finally(() => {
      job = null;

      if (!closed && !paused) {
        const delay = state === 'live' ? 1500 : 5000;

        timer = setTimeout(() => void run(), delay);
        timer.unref();
      }
    });

    return job;
  };

  const snapshot = () => {
    const stream = active?.segments.length ? active : recorded;
    const timing = [];
    let time = 0;
    let expected;

    for (const segment of stream?.segments || []) {
      if (expected === undefined || Math.abs(segment.date - expected) > 250) {
        timing.push({ date: segment.date, time });
      }

      expected = segment.date + segment.duration * 1000;
      time += segment.duration;
    }

    return {
      state,
      message,
      quality,
      qualities: selectable(),
      captions: Boolean(active?.source.captions),
      url: stream?.segments.length ? `/media/${stream.key}/0` : '',
      download: stream?.segments.length ? `/media/${stream.key}/save` : '',
      duration: stream?.duration || 0,
      date: stream?.segments[0]?.date || null,
      timing,
      width: stream?.width || null,
      height: stream?.height || null
    };
  };

  const open = async selected => {
    await refresh();

    if (selected && !available) {
      const preset = qualities.find(item => item.name === selected);

      if (Number.parseInt(preset?.label, 10) > 540) {
        selected = 'hd';
      }
    }

    if (selected) {
      if (qualities.length && !qualities.some(item => item.name === selected)) {
        throw new Error('화질 오류');
      }
      automatic = false;
    }

    if (selected && selected !== quality) {
      quality = selected;
      next = 0;
      await job;
      await run();
    }

    return snapshot();
  };

  const download = async (stream, response, name) => {
    const segments = stream.segments.slice();
    const unsupported = segments.some(item =>
      item.content.some(line => {
        return (
          line.startsWith('#EXT-X-MAP:')
          || (line.startsWith('#EXT-X-KEY:') && !line.includes('METHOD=NONE'))
        );
      })
    );

    if (!segments.length || unsupported) {
      throw new Error('영상 저장 형식 오류');
    }

    const files = segments.map(item => {
      const id = Number(item.url.split('/').at(-1));

      return stream.files.get(id);
    });

    if (files.some(file => !file)) {
      throw new Error('녹화 파일 없음');
    }

    const first = await fs.readFile(files[0].file);

    if (first.length < 188 || first[0] !== 0x47) {
      throw new Error('영상 저장 형식 오류');
    }

    const filename =
      String(name || 'SOOP')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\.ts$/i, '')
        .replace(/[. ]+$/g, '') || 'SOOP';
    const trimmed = Array.from(filename).slice(0, 100).join('');
    const encoded = encodeURIComponent(trimmed + '.ts').replace(/['()*]/g, character => {
      const code = character.charCodeAt(0).toString(16).toUpperCase();

      return `%${code}`;
    });
    const length = files.reduce((sum, file) => sum + file.size, 0);

    response.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Content-Length': length,
      'Content-Disposition': `attachment; filename="SOOP.ts"; filename*=UTF-8''${encoded}`
    });

    async function* chunks() {
      yield first;

      for (const file of files.slice(1)) {
        yield await fs.readFile(file.file);
      }
    }

    await pipeline(Readable.from(chunks()), response);
  };

  const send = async (request, response, link = value => value) => {
    const address = new URL(request.url, 'http://localhost');
    const match = /^\/media\/([a-f0-9]{48})\/(\d+|save)$/.exec(address.pathname);
    const stream = [...streams.values()].find(item => item.key === match?.[1]);

    if (!stream || closed) {
      response.writeHead(404);
      response.end();

      return;
    }

    if (match[2] === 'save') {
      await download(stream, response, address.searchParams.get('name'));

      return;
    }

    const id = Number(match[2]);

    if (id === 0) {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end(manifest(stream, link));

      return;
    }

    const file = stream.files.get(id);

    if (!file) {
      response.writeHead(404);
      response.end();

      return;
    }

    const content = await fs.readFile(file.file);
    const headers = { 'Content-Type': file.type, 'Accept-Ranges': 'bytes' };
    let start = 0;
    let end = content.length - 1;
    let status = 200;

    if (request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);

      if (!range || (!range[1] && !range[2])) {
        response.writeHead(416, { 'Content-Range': `bytes */${content.length}` });
        response.end();

        return;
      }

      start = Number(range[1] || 0);
      end = Math.min(Number(range[2] || end), end);

      if (!range[1]) {
        start = Math.max(0, content.length - Number(range[2]));
        end = content.length - 1;
      }

      if (start > end || start >= content.length) {
        response.writeHead(416, { 'Content-Range': `bytes */${content.length}` });
        response.end();

        return;
      }

      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${content.length}`;
    }

    headers['Content-Length'] = end - start + 1;
    response.writeHead(status, headers);
    response.end(content.subarray(start, end + 1));
  };

  const reset = async () => {
    paused = true;
    generation++;
    transition.abort();
    transition = new AbortController();
    clearTimeout(timer);

    for (const stream of streams.values()) {
      stream.transport?.close();
      stream.transport = null;
    }

    for (const request of requests) {
      request.abort();
    }

    active = null;
    recorded = null;
    streams.clear();
    quality = 'best';
    automatic = true;
    upgrade = 0;
    qualities = [];
    available = true;
    checked = 0;
    next = 0;
    state = 'loading';
    message = '';
    await job?.catch(() => {});

    const directory = await folder;
    const files = await fs.readdir(directory);

    await Promise.all(files.map(file => fs.rm(path.join(directory, file), { force: true })));
  };

  const close = () => {
    if (closing) {
      return closing;
    }

    closed = true;
    lifetime.abort();
    clearTimeout(timer);

    for (const stream of streams.values()) {
      stream.transport?.close();
      stream.transport = null;
    }

    for (const request of requests) {
      request.abort();
    }

    closing = Promise.resolve(job).finally(async () => {
      const directory = await folder;

      streams.clear();
      await fs.rm(directory, { recursive: true, force: true });
    });

    return closing;
  };

  const start = async () => {
    paused = false;
    await job;

    return run();
  };

  return { open, snapshot, send, reset, close, start };
}
