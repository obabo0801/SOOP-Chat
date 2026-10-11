import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export function createPreviews(provider, streams = new Map()) {
  const remove = key => {
    const stream = streams.get(key);
    if (!stream) return;
    clearTimeout(stream.timer);
    stream.controller.abort();
    streams.delete(key);
  };
  const touch = (key, stream) => {
    clearTimeout(stream.timer);
    stream.timer = setTimeout(() => remove(key), 60000);
    stream.timer.unref();
  };
  const open = async id => {
    while (streams.size >= 8) remove(streams.keys().next().value);
    const key = crypto.randomBytes(24).toString('hex');
    const stream = { urls: new Map(), manifests: new Map(), previous: new Map(), index: 1, controller: new AbortController() };
    streams.set(key, stream);
    touch(key, stream);
    try {
      const source = await provider(id, stream.controller.signal);
      if (!source?.url || stream.controller.signal.aborted) {
        throw new Error('미리보기를 재생할 수 없습니다.');
      }
      stream.source = source;
      stream.urls.set(0, source.url);
      return { key, url: `/media/preview/${key}/0`, format: source.format || 'hls' };
    } catch (error) {
      remove(key);
      throw error;
    }
  };
  const send = async (request, response, delivery = value => value) => {
    const address = new URL(request.url, 'http://localhost');
    const match = /^\/media\/preview\/([a-f0-9]{48})\/(\d+)$/.exec(address.pathname);
    const stream = match && streams.get(match[1]);
    const url = stream?.urls.get(Number(match?.[2]));
    if (!url) {
      response.writeHead(404);
      response.end();
      return;
    }
    touch(match[1], stream);
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.once('close', disconnect);
    try {
      const upstream = await fetch(url, {
        headers: { ...stream.source.headers, ...(request.headers?.range ? { Range: request.headers.range } : {}) },
        signal: AbortSignal.any([stream.controller.signal, controller.signal, AbortSignal.timeout(15000)])
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        response.writeHead(upstream.status);
        response.end();
        return;
      }
      const type = upstream.headers.get('content-type') || 'application/octet-stream';
      const playlist = /mpegurl/i.test(type) || /\.m3u8(?:\?|$)/i.test(url);
      if (playlist) {
        const references = new Set();
        const link = value => {
          const target = new URL(value, upstream.url || url);
          if (!['http:', 'https:'].includes(target.protocol)) throw new Error('영상 주소 오류');
          let index;
          for (const [number, value] of stream.urls) {
            if (value === target.href) {
              index = number;
              break;
            }
          }
          if (index === undefined) {
            index = stream.index++;
            stream.urls.set(index, target.href);
          }
          references.add(index);
          return delivery(`/media/preview/${match[1]}/${index}`);
        };
        const content = (await upstream.text()).split(/\r?\n/).map(line => {
          if (!line || line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${link(uri)}"`);
          return link(line.trim());
        }).join('\n');
        const manifest = Number(match[2]);
        stream.previous.set(manifest, stream.manifests.get(manifest) || new Set());
        stream.manifests.set(manifest, references);
        const retained = new Set([0, ...[...stream.manifests.values(), ...stream.previous.values()].flatMap(value => [...value])]);
        for (const index of stream.urls.keys()) {
          if (!retained.has(index)) {
            stream.urls.delete(index);
            stream.manifests.delete(index);
            stream.previous.delete(index);
          }
        }
        response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
        response.end(content);
      } else {
        const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
        for (const name of ['content-length', 'content-range', 'accept-ranges']) {
          if (upstream.headers.has(name)) headers[name] = upstream.headers.get(name);
        }
        response.writeHead(upstream.status, headers);
        await pipeline(Readable.fromWeb(upstream.body), response);
      }
    } finally {
      response.off('close', disconnect);
    }
  };
  return { open, remove, send, streams, close: () => {
    for (const key of streams.keys()) remove(key);
  } };
}
