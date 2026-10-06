import crypto from 'crypto';
import { Package } from '#soop/package';

function checksum(data) {
  let value = 0xffffffff;

  for (const byte of data) {
    value ^= byte << 24;

    for (let bit = 0; bit < 8; bit++) {
      value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    }
  }

  const result = Buffer.alloc(4);

  result.writeUInt32BE(value >>> 0);

  return result;
}

function timestamp(value, prefix) {
  const clock = BigInt(Math.max(0, Math.round(value))) & 0x1ffffffffn;
  const result = Buffer.from([
    prefix | Number((clock >> 29n) & 14n) | 1,
    Number((clock >> 22n) & 255n),
    Number((clock >> 14n) & 254n) | 1,
    Number((clock >> 7n) & 255n),
    Number((clock << 1n) & 254n) | 1
  ]);

  return result;
}

export class Transport {
  constructor(client, quality) {
    this.package = new Package(
      { ...client, guid: crypto.randomBytes(16).toString('hex') },
      quality,
      { exclusive: true }
    );
    this.counters = new Map();
    this.buffers = [];
    this.queue = [];
    this.pending = null;
    this.error = null;
    this.start = null;
    this.origin = null;
    this.size = 0;
    this.sequence = 0;

    this.package.on('media', data => {
      try {
        this.write(data);
      } catch (error) {
        this.close(error);
      }
    });
    this.package.on('error', error => this.close(error));
    this.package.on('close', () => this.close(new Error('연결 종료')));
  }

  open() {
    return this.package.connect();
  }

  packet(pid, data, clock) {
    let offset = 0;

    while (offset < data.length) {
      const first = offset === 0;
      const pcr = first && clock !== undefined;
      const capacity = pcr ? 176 : 184;
      const length = Math.min(capacity, data.length - offset);
      const adaptation = 184 - length;
      const counter = this.counters.get(pid) || 0;
      const packet = Buffer.alloc(188, 0xff);

      packet[0] = 0x47;
      packet[1] = (pid >> 8) | (first ? 0x40 : 0);
      packet[2] = pid & 255;
      packet[3] = (adaptation ? 0x30 : 0x10) | counter;
      this.counters.set(pid, (counter + 1) & 15);

      if (adaptation) {
        packet[4] = adaptation - 1;

        if (adaptation > 1) {
          packet[5] = pcr ? 0x10 : 0;
        }

        if (pcr) {
          const base = BigInt(Math.max(0, Math.round(clock))) & 0x1ffffffffn;

          packet[6] = Number((base >> 25n) & 255n);
          packet[7] = Number((base >> 17n) & 255n);
          packet[8] = Number((base >> 9n) & 255n);
          packet[9] = Number((base >> 1n) & 255n);
          packet[10] = Number((base & 1n) << 7n) | 0x7e;
          packet[11] = 0;
        }
      }

      data.copy(packet, 4 + adaptation, offset, offset + length);
      this.buffers.push(packet);
      this.size += packet.length;
      offset += length;
    }
  }

  tables() {
    const pat = Buffer.from([0, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0]);
    const pmt = Buffer.from([
      2, 0xb0, 23, 0, 1, 0xc1, 0, 0, 0xe1, 0, 0xf0, 0, 0x1b, 0xe1, 0, 0xf0, 0, 0x0f, 0xe1,
      1, 0xf0, 0
    ]);

    this.packet(0, Buffer.concat([Buffer.from([0]), pat, checksum(pat)]));
    this.packet(4096, Buffer.concat([Buffer.from([0]), pmt, checksum(pmt)]));
  }

  flush(time) {
    if (!this.buffers.length || this.start === null || time <= this.start) {
      return;
    }

    const segment = {
      sequence: this.sequence++,
      duration: (time - this.start) / 10000000,
      content: Buffer.concat(this.buffers)
    };

    this.buffers = [];
    this.size = 0;

    if (this.pending) {
      const pending = this.pending;

      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(segment);
    }
    else {
      this.queue.push(segment);

      if (this.queue.length > 3) {
        throw new Error('저장 지연');
      }
    }
  }

  write(data) {
    if (this.error) {
      return;
    }

    if (data.length < 77 || !data.subarray(0, 8).every(byte => byte === 255)) {
      throw new Error('형식 오류');
    }

    const version = data.readUInt16LE(8);
    const offset = 8 + data.readUInt16LE(10) + data.readUInt32LE(12);
    const length = data.readUInt32LE(16);
    const type = String.fromCharCode(data[48]);
    const time = Number(data.readBigInt64LE(49));
    const composition = data.readInt32LE(65);
    const payload = data.subarray(offset);

    if (version >= 100 || offset < 77 || payload.length !== length) {
      throw new Error('코덱 미지원');
    }

    if (length > 16777216) {
      throw new Error('용량 초과');
    }

    if (type === 'I') {
      this.flush(time);
      this.start = time;
      this.origin ??= time;
      this.tables();
    }

    if (
      this.origin === null
      || time < this.origin
      || !['I', 'P', 'B', 'A'].includes(type)
    ) {
      return;
    }

    const audio = type === 'A';
    const dts = ((time - this.origin) * 90000) / 10000000;
    const pts = dts + (composition * 90000) / 10000000;
    const different = !audio && composition !== 0;
    const timing = [timestamp(pts, different ? 0x30 : 0x20)];

    if (different) {
      timing.push(timestamp(dts, 0x10));
    }

    const header = Buffer.from([
      0,
      0,
      1,
      audio ? 0xc0 : 0xe0,
      0,
      0,
      0x80,
      different ? 0xc0 : 0x80,
      different ? 10 : 5
    ]);

    if (audio) {
      if (
        payload.length + 8 > 65535
        || payload[0] !== 255
        || (payload[1] & 0xf6) !== 0xf0
      ) {
        throw new Error('오디오 형식 오류');
      }

      header.writeUInt16BE(payload.length + 8, 4);
    }

    const pes = Buffer.concat([header, ...timing, payload]);

    if (audio) {
      this.packet(257, pes);
    }
    else {
      this.packet(256, pes, dts);
    }

    if (this.size > 16777216) {
      throw new Error('용량 초과');
    }
  }

  read() {
    if (this.error) {
      return Promise.reject(this.error);
    }

    if (this.queue.length) {
      return Promise.resolve(this.queue.shift());
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('응답 시간 초과')), 10000);

      this.pending = { resolve, reject, timer };
    });
  }

  close(error = new Error('연결 중지')) {
    if (this.error) {
      return;
    }

    this.error = error;
    this.package.close(error);
    this.buffers = [];
    this.queue = [];

    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }
}
