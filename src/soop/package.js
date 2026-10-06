import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DOMAIN, PACKAGE, QUALITY } from '#soop/config';
import * as http from '#soop/http';

const execute = promisify(execFile);

async function occupied(port, center, ignored) {
  if (process.platform !== 'win32') {
    return false;
  }

  const { stdout } = await execute('netstat.exe', ['-ano'], {
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 1048576
  });
  const address = new RegExp(`^(127\\.0\\.0\\.1|\\[::1\\]):${port}$`);
  const owners = new Set();
  const sockets = [];
  let busy = false;

  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);

    if (fields[0] === 'TCP' && fields[3] === 'ESTABLISHED') {
      const local = fields[1].split(':').at(-1);

      sockets.push(fields);

      if (address.test(fields[1])) {
        owners.add(fields[4]);
      }

      if (address.test(fields[2]) && local !== String(ignored)) {
        busy = true;
      }
    }
  }

  if (!busy) {
    return false;
  }

  if (!center) {
    return true;
  }

  const connected = sockets.some(fields => {
    return owners.has(fields[4]) && fields[2] === center;
  });

  return connected;
}

async function discover() {
  const ws = new WebSocket(DOMAIN.package, 'package', { origin: DOMAIN.play });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('패키지 응답 시간 초과')), 2000);
    const finish = (error, value) => {
      clearTimeout(timer);

      if (error) {
        reject(error);
      }
      else {
        resolve(value);
      }
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ SVC: 'CAPTION', RESULT: 1, DATA: { nCaption: 5 } }));
    });
    ws.on('message', data => {
      try {
        const packet = JSON.parse(data.toString());

        if (packet.SVC === 'HTMLPORT') {
          finish(null, Number(packet.DATA?.HTMLPLAYER_PORT));
        }
      } catch {}
    });
    ws.on('error', error => finish(error));
    ws.on('close', () => finish(new Error('패키지 연결 종료')));
  }).finally(() => {
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
    else {
      ws.close();
    }
  });

  return port;
}

export class Package extends EventEmitter {
  static async available(connection, center) {
    try {
      const socket = connection?.ws?._socket;
      const port = socket?.remotePort || (await discover());

      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return false;
      }

      if (connection?.ready && connection.ws?.readyState === WebSocket.OPEN) {
        return true;
      }

      const busy = await occupied(port, center, socket?.localPort);

      return !busy;
    } catch {
      return false;
    }
  }

  constructor(client, quality, options = {}) {
    super();
    this.network = client.network;
    this.bjId = client.bjId;
    this.password = client.broadPw || '';
    this.cookie = client.cookie;
    this.guid = client.guid;
    this.uuid = client.uuid;
    this.quality = quality;
    this.exclusive = options.exclusive ?? false;
    this.ws = null;
    this.manager = null;
    this.channel = null;
    this.info = null;
    this.pending = null;
    this.ping = null;
    this.closed = false;
    this.ready = false;
  }

  async connect() {
    this.channel = await http.postLiveInfo(this.bjId, {
      ...this.network.httpOptions,
      cookie: this.cookie
    });

    if (this.closed) {
      throw new Error('패키지 연결 취소');
    }

    if (this.channel?.RESULT !== 1 || !this.channel.BNO) {
      throw new Error('방송 정보 없음');
    }

    this.checkQuality(this.quality);

    const result = new Promise((resolve, reject) => {
      this.wait(resolve, reject);

      const ws = new WebSocket(DOMAIN.package, 'package', {
        ...this.network.socketOptions,
        origin: DOMAIN.play
      });

      this.manager = ws;

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            SVC: 'CAPTION',
            RESULT: 1,
            DATA: { nCaption: 5 }
          })
        );
      });
      ws.on('message', data => {
        if (this.closed || this.ws || this.manager !== ws) {
          return;
        }

        let packet;

        try {
          packet = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (packet.SVC !== 'HTMLPORT') {
          return;
        }

        const port = Number(packet.DATA?.HTMLPLAYER_PORT);

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          this.fail(new Error('패키지 정보 없음'));

          return;
        }

        this.manager = null;
        ws.close();
        void this.reserve(port);
      });
      ws.on('error', () => {
        if (this.manager === ws) {
          this.fail(new Error('패키지 연결 실패'));
        }
      });
      ws.on('close', () => {
        if (this.manager === ws) {
          this.fail(new Error('패키지 연결 종료'));
        }
      });
    });

    return result;
  }

  async reserve(port) {
    try {
      const center = `${this.channel.CTIP}:${Number(this.channel.CTPT)}`;

      if (this.exclusive && (await occupied(port, center))) {
        const error = new Error('고화질 사용 중');

        error.code = 'SOOP_BUSY';

        throw error;
      }

      if (!this.closed) {
        this.open(port);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  open(port) {
    const url = new URL(DOMAIN.package);

    url.port = String(port);
    url.pathname = `/Websocket/${encodeURIComponent(this.bjId)}`;

    const ws = new WebSocket(url, 'agent', {
      ...this.network.socketOptions,
      origin: DOMAIN.play
    });

    this.ws = ws;

    ws.on('open', () => {
      if (this.closed || this.ws !== ws) {
        return;
      }

      this.ping = setInterval(() => {
        this.send(PACKAGE.KEEPALIVE);
      }, 20000);
      this.send(PACKAGE.INIT_GW, this.makeInitGw());
    });
    ws.on('message', (data, binary) => {
      if (this.closed || this.ws !== ws) {
        return;
      }

      if (binary) {
        if (!this.ready && this.info) {
          const event = this.pending?.retry ? 'quality' : 'open';

          this.ready = true;
          this.finish();
          this.emit(event, this.result());
        }

        if (this.ready) {
          this.emit('media', data);
        }

        return;
      }

      let packet;

      try {
        packet = JSON.parse(data.toString());
      } catch {
        return;
      }

      this.handler(packet);
    });
    ws.on('error', () => {
      if (this.ws !== ws) {
        return;
      }

      this.fail(new Error('미디어 연결 실패'));
    });
    ws.on('close', () => {
      if (this.ws !== ws) {
        return;
      }

      this.fail(new Error('미디어 연결 종료'));
    });
  }

  handler(packet) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
      return;
    }

    const { SVC: svc, RESULT: result, DATA: data = {} } = packet;

    if (Number(data.ERRCODE ?? result) === -39998) {
      const error = new Error('고화질 사용 중');

      error.code = 'SOOP_BUSY';
      this.fail(error);

      return;
    }

    if (Number(result) === -1990 && this.ready && this.pending && !this.pending.retry) {
      this.retry();

      return;
    }

    if (Number(result) < 0 || svc === PACKAGE.ERROR) {
      this.fail(new Error(`패키지 요청 실패 (${result})`));

      return;
    }

    switch (svc) {
      case PACKAGE.CERTTICKET:
        if (!data.pcTicket) {
          this.fail(new Error('패키지 인증 오류'));

          return;
        }

        this.send(PACKAGE.INIT_BROAD, this.makeInitBroad(data));
        break;
      case PACKAGE.INIT_BROAD:
        this.send(PACKAGE.START);
        break;
      case PACKAGE.START:
        this.info = data;
        break;
      case PACKAGE.QUALITY: {
        const value = Number(data.QUALITY);
        const requested = this.pending?.quality || this.quality;
        let quality;

        if (QUALITY[requested] === value) {
          quality = requested;
        }
        else {
          quality = Object.keys(QUALITY).find(key => QUALITY[key] === value);
        }

        if (!quality) {
          break;
        }

        this.quality = quality;

        if (this.ready) {
          this.info = null;
          this.finish();
          this.emit('quality', this.result());
        }

        break;
      }
      case PACKAGE.BROADEND:
      case PACKAGE.CLOSECH:
      case PACKAGE.CENTER_CLOSE:
      case PACKAGE.NOTIFY:
        this.fail(new Error('패키지 방송 종료'));
        break;
    }
  }

  checkQuality(quality) {
    if (
      !Object.hasOwn(QUALITY, quality)
      || !this.channel.VIEWPRESET?.some(item => item.name === quality)
    ) {
      throw new Error(`화질 오류 (${quality})`);
    }
  }

  async change(quality) {
    if (this.pending || !this.ready || this.closed) {
      throw new Error('패키지 처리 중');
    }

    this.checkQuality(quality);

    if (this.quality === quality) {
      return this.result();
    }

    const value = new Promise((resolve, reject) => {
      this.wait(resolve, reject, quality);
      this.send(PACKAGE.QUALITY, {
        BNO: Number(this.channel.BNO),
        QUALITY: QUALITY[quality]
      });
    });

    return value;
  }

  retry() {
    const pending = this.pending;
    const ws = this.ws;
    const port = Number(new URL(ws.url).port);

    pending.retry = true;
    this.quality = pending.quality;
    this.ready = false;
    this.info = null;
    clearInterval(this.ping);
    this.ping = null;
    this.ws = null;

    ws.once('close', () => {
      if (!this.closed && this.pending === pending) {
        this.open(port);
      }
    });
    ws.close();
  }

  wait(resolve, reject, quality = this.quality) {
    const timer = setTimeout(() => {
      this.fail(new Error('패키지 응답 시간 초과'));
    }, 20000);

    this.pending = { resolve, reject, quality, timer };
  }

  finish(error) {
    const pending = this.pending;

    if (!pending) {
      return;
    }

    this.pending = null;
    clearTimeout(pending.timer);

    if (error) {
      pending.reject(error);
    }
    else {
      pending.resolve(this.result());
    }
  }

  result() {
    const result = {
      bjId: this.bjId,
      broadNo: Number(this.channel.BNO),
      quality: this.quality,
      width: Number(this.info?.WIDTH) || null,
      height: Number(this.info?.HEIGHT) || null
    };

    return result;
  }

  send(svc, data = {}) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.ws.send(JSON.stringify({ SVC: svc, RESULT: 0, DATA: data }));

    return true;
  }

  fail(error) {
    if (this.closed) {
      return;
    }

    this.close(error);
    this.emit('error', error);
  }

  close(error = new Error('패키지 연결 중지')) {
    if (this.closed) {
      return false;
    }

    this.closed = true;
    this.ready = false;
    clearInterval(this.ping);
    this.ping = null;
    this.finish(error);

    for (const ws of [this.manager, this.ws]) {
      if (!ws) {
        continue;
      }

      if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
      else {
        ws.close();
      }
    }

    this.manager = null;
    this.ws = null;
    this.emit('close', { bjId: this.bjId });

    return true;
  }

  makeInitGw() {
    const c = this.channel;

    const result = {
      gate_ip: c.GWIP,
      gate_port: Number(c.GWPT),
      center_ip: c.CTIP,
      center_port: Number(c.CTPT),
      broadno: Number(c.BNO),
      cookie: c.TK || '',
      guid: this.guid,
      cli_type: 42,
      passwd: this.password,
      category: c.CATE,
      JOINLOG: this.makeLog(),
      BJID: c.BJID,
      fanticket: c.FTK,
      addinfo: 'ad_lang\x11ko\x12is_auto\x110\x12',
      update_info: 0
    };

    return result;
  }

  makeInitBroad(cert) {
    const c = this.channel;

    const result = {
      CIP: c.CTIP,
      CPORT: Number(c.CTPT),
      BNO: Number(c.BNO),
      PARENTBNO: 0,
      SCRAPBJ: false,
      PASSWORD: this.password,
      GUID: this.guid,
      TICKETLEN: cert.pcTicket.length,
      TICKET: cert.pcTicket,
      QUALITY: QUALITY[this.quality],
      APPDATA: cert.pcAppendDat,
      JOINLOG: this.makeLog(),
      SIP: cert.uiIpAddr,
      SPORT: cert.iPort,
      SPROTOCOL: 2,
      BJID: c.BJID,
      SETBPS: Number(c.BPS) || null,
      SSBUF: 2,
      BROWSER: 'SOOP-Chat',
      PLAYERVERSION: '1.0.2'
    };

    return result;
  }

  makeLog() {
    const values = {
      uuid: this.uuid,
      os: 'win',
      is_streamer: true,
      is_auto: false,
      player_mode: 'landing'
    };
    const log = Object.entries(values)
      .map(([key, value]) => `\x06&\x06${key}\x06=\x06${value}`)
      .join('');

    const result = `log\x11${log}\x12liveualog\x11${log}\x12`;

    return result;
  }
}
