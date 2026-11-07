const wrap = 2 ** 33;

function readTime(data, offset) {
  return (data[offset] & 14) * 536870912 + data[offset + 1] * 4194304
    + (data[offset + 2] & 254) * 16384 + data[offset + 3] * 128 + (data[offset + 4] >> 1);
}

function writeTime(data, offset, value) {
  const time = ((Math.round(value) % wrap) + wrap) % wrap;
  data[offset] = (data[offset] & 240) | Math.floor(time / 536870912) & 14 | 1;
  data[offset + 1] = Math.floor(time / 4194304) & 255;
  data[offset + 2] = Math.floor(time / 16384) & 254 | 1;
  data[offset + 3] = Math.floor(time / 128) & 255;
  data[offset + 4] = time * 2 & 254 | 1;
}

export function createClock() {
  let elapsed = 0;
  let counters = new Map();
  const prepare = (source, duration) => {
    if (source.length % 188 || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('녹화 시간 정보를 확인할 수 없습니다.');
    }
    const data = Buffer.from(source);
    const nextCounters = new Map(counters);
    const headers = [];
    let first;
    let audio;
    for (let packet = 0; packet < data.length; packet += 188) {
      if (data[packet] !== 0x47) throw new Error('녹화 영상 형식을 확인할 수 없습니다.');
      const control = data[packet + 3] >> 4 & 3;
      if (!(control & 1) || !(data[packet + 1] & 64)) continue;
      let start = packet + 4;
      if (control & 2) start += data[start] + 1;
      if (start + 14 > packet + 188 || data[start] || data[start + 1] || data[start + 2] !== 1) continue;
      const kind = data[start + 3] & 240;
      const flags = data[start + 7] & 192;
      if (![192, 224].includes(kind) || ![128, 192].includes(flags)) continue;
      if (start + 9 + data[start + 8] > packet + 188 || data[start + 8] < (flags === 192 ? 10 : 5)) {
        throw new Error('녹화 시간 헤더를 확인할 수 없습니다.');
      }
      headers.push({ start, flags });
      const time = readTime(data, start + (flags === 192 ? 14 : 9));
      if (kind === 224) first ??= time;
      else audio ??= time;
    }
    const origin = first ?? audio;
    if (origin === undefined) throw new Error('녹화 재생 시간을 확인할 수 없습니다.');
    const offset = 90000 + Math.round(elapsed * 90000) - origin;
    for (const { start, flags } of headers) {
      writeTime(data, start + 9, readTime(data, start + 9) + offset);
      if (flags === 192) writeTime(data, start + 14, readTime(data, start + 14) + offset);
    }
    for (let packet = 0; packet < data.length; packet += 188) {
      const control = data[packet + 3] >> 4 & 3;
      const pid = (data[packet + 1] & 31) * 256 + data[packet + 2];
      const previous = nextCounters.get(pid);
      const counter = previous === undefined ? 0 : (previous + (control & 1 ? 1 : 0)) & 15;
      if (pid !== 8191) {
        data[packet + 3] = data[packet + 3] & 240 | counter;
        nextCounters.set(pid, counter);
      }
      if (!(control & 2) || data[packet + 4] < 7 || !(data[packet + 5] & 16)) continue;
      const start = packet + 6;
      const base = data[start] * 33554432 + data[start + 1] * 131072
        + data[start + 2] * 512 + data[start + 3] * 2 + (data[start + 4] >> 7);
      const time = ((base + offset) % wrap + wrap) % wrap;
      data[start] = Math.floor(time / 33554432) & 255;
      data[start + 1] = Math.floor(time / 131072) & 255;
      data[start + 2] = Math.floor(time / 512) & 255;
      data[start + 3] = Math.floor(time / 2) & 255;
      data[start + 4] = (time % 2) * 128 | data[start + 4] & 127;
    }
    const nextElapsed = elapsed + duration;
    return { data, commit() { elapsed = nextElapsed; counters = nextCounters; } };
  };
  const rewrite = (source, duration) => {
    const pending = prepare(source, duration);
    pending.commit();
    return pending.data;
  };
  rewrite.prepare = prepare;
  return rewrite;
}
