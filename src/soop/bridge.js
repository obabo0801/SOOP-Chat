import { WebSocket } from 'ws';

export class Bridge {
  constructor(client) {
    this.client = client;
    this.ws = null;
    this.cert = null;
    this.ping = null;
    this.viewer = null;
  }

  get url() {
    const result = `wss://bridge.sooplive.com/` + `Websocket/${this.client.bjId}`;

    return result;
  }

  isOpen() {
    const result = this.ws && this.ws.readyState === WebSocket.OPEN;

    return result;
  }

  async connect() {
    if (this.isOpen()) {
      return false;
    }

    this.ws = new WebSocket(this.url, 'bridge', this.client.network.socketOptions);
    this.viewer = null;

    await this.open();

    return true;
  }

  async open() {
    const ws = this.ws;
    const signal = this.client.cancellation ?? this.client.signal;

    await new Promise((resolve, reject) => {
      let settled = false;

      const finish = error => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', aborted);

        if (error) {
          reject(error);
        }
        else {
          resolve(true);
        }
      };

      const timeout = setTimeout(() => {
        finish(new Error('브릿지 연결 시간 초과'));
      }, 10000);
      const aborted = () => finish(new Error('연결 취소'));

      signal?.addEventListener('abort', aborted, { once: true });

      ws.on('open', () => {
        if (this.ws !== ws || signal?.aborted) {
          finish(new Error('연결 취소'));

          return;
        }

        this.startPing();
        this.send(this.makeInitGw());
        finish();
      });

      ws.on('message', data => {
        if (this.ws !== ws || signal?.aborted) {
          return;
        }

        try {
          this.handler(this.parse(data));
        } catch (error) {
          this.client.emit('error', error);
        }
      });

      ws.on('error', error => {
        finish(error);

        if (this.ws === ws && !signal?.aborted) {
          this.client.emit('error', error);
        }
      });

      ws.on('close', () => {
        if (this.ws === ws) {
          this.stopPing();

          if (!signal?.aborted) {
            this.client.emit('connectionClose', { source: 'bridge' });
          }
        }

        finish(new Error('브릿지 연결 종료'));
      });

      if (signal?.aborted) {
        aborted();
      }
    });
  }

  close() {
    this.stopPing();
    this.viewer = null;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    return true;
  }

  parse(data) {
    const text = data.toString();

    try {
      return JSON.parse(text);
    } catch {
      const result = {
        SVC: 'UNKNOWN',
        DATA: text
      };

      return result;
    }
  }

  send(data) {
    if (!this.isOpen()) {
      return false;
    }

    this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));

    return true;
  }

  startPing() {
    this.stopPing();

    this.ping = setInterval(() => {
      this.send(this.makePing());
    }, 20000);
  }

  stopPing() {
    if (!this.ping) {
      return false;
    }

    clearInterval(this.ping);
    this.ping = null;

    return true;
  }

  handler(packet = {}) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
      return;
    }

    const { SVC, DATA } = packet;

    switch (SVC) {
      case 'FLASH_LOGIN':
        break;

      case 'CERTTICKETEX':
        this.onCert(DATA);
        break;

      case 'JOINCH_COMMON':
        this.onJoin(DATA);
        break;

      case 'CCP_SVC_JOINCH_COMMON':
        this.onFail(DATA);
        break;

      case 'GETCHINFO':
        break;

      case 'GETCHINFOEX':
        break;

      case 'SETCHINFO':
        break;

      case 'SETCHINFOEX':
        this.onSet(DATA);
        break;

      case 'CLOSECH':
        this.onClose(DATA);
        break;

      case 'BCONT_STATE':
        break;

      case 'GETUSERCNT':
        break;

      case 'GETUSERCNTEX':
        if (packet.RESULT === 0) {
          this.onViewer(DATA);
        }

        break;

      case 'GETBJADCON':
        break;

      case 'GETITEM_SELL':
        break;

      case 'TRANSLATED_TITLES':
        break;

      case 'WAITBJSESS':
        break;

      default:
        const json = JSON.stringify(packet, null, 2);

        this.client.emit('bridge', json);
        break;
    }
  }

  onCert(data = {}) {
    this.cert = {
      append: data.pcAppendDat,
      ticket: data.pcTicket,
      len: Number(data.iTicketLen),
      port: Number(data.iPort),
      ip: Number(data.uiIpAddr),
      broadNo: Number(data.uiBroadId)
    };

    this.send(this.makeInitBroad());
  }

  onJoin(data = {}) {
    const info = {
      broad: this.client.broadcast,
      bjId: this.client.bjId,
      bjNick: this.client.bjNick
    };

    this.client.emit('open', info);
  }

  onFail(data = {}) {
    const text = data?.acErrMesg;

    this.client.emit('error', text);
    this.client.broadPw = null;
    this.client.disconnect(false);
  }

  onSet(data = {}) {
    this.client.updateBroadcast(data);
  }

  onViewer(data = {}) {
    const values = [
      data?.uiMainChPCUser,
      data?.uiSubChPCUser,
      data?.uiMainChMBUser,
      data?.uiSubChMBUser
    ];

    if (
      values.some(
        value => value === null || value === undefined || String(value).trim() === ''
      )
    ) {
      return;
    }

    const counts = values.map(Number);

    if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) {
      return;
    }

    const pc = counts[0] + counts[1];
    const mobile = counts[2] + counts[3];
    const broadNo = Number(data.uiBroadNo);

    if (!Number.isSafeInteger(broadNo) || broadNo <= 0) {
      return;
    }

    const prev = this.viewer;

    if (prev?.broadNo === broadNo && prev.pc === pc && prev.mobile === mobile) {
      return;
    }

    this.viewer = { broadNo, pc, mobile };

    this.client.emit('viewer', {
      bjId: this.client.bjId,
      broadNo,
      total: pc + mobile,
      pc,
      mobile
    });
  }

  onClose(data = {}) {
    if (data.pcEndingMsg) {
      this.client.endingMsg(data.pcEndingMsg);
    }

    this.client.emit('broadcastEnd', {
      bjId: this.client.bjId,
      broadNo: this.client.channel?.BNO,
      message: this.client.ending
    });
  }

  makeInitGw() {
    const c = this.client.channel;

    const result = {
      SVC: 'INIT_GW',
      RESULT: 0,
      DATA: {
        gate_ip: c.GWIP,
        gate_port: Number(c.GWPT),
        broadno: Number(c.BNO),
        category: c.CATE,
        QUALITY: 'normal',
        cli_type: 41,
        cc_cli_type: 19,
        cookie: c.TK || '',
        fanticket: c.FTK,
        guid: this.client.guid,
        update_info: 0,
        BJID: c.BJID,
        JOINLOG: this.makeJoinLog(),
        addinfo: this.makeAddInfo()
      }
    };

    return result;
  }

  makeInitBroad() {
    const c = this.client.channel;
    const cert = this.cert;

    const result = {
      SVC: 'INIT_BROAD',
      RESULT: 0,
      DATA: {
        center_ip: c.CTIP,
        center_port: Number(c.CTPT),
        passwd: this.client.broadPw || '',
        QUALITY: 'normal',
        cli_type: 41,
        cc_cli_type: 19,
        guid: this.client.guid,
        append_data: cert.append,
        gw_ticket: cert.ticket,
        JOINLOG: this.makePlayLog()
      }
    };

    return result;
  }

  makePing() {
    const result = {
      SVC: 'KEEPALIVE',
      RESULT: 0,
      DATA: {}
    };

    return result;
  }

  makeAddInfo() {
    const DC1 = '\x11';
    const DC2 = '\x12';

    const result = `ad_lang${DC1}ko${DC2}` + `is_auto${DC1}0${DC2}`;

    return result;
  }

  makeJoinLog() {
    const c = this.client.channel;

    const result = this.makeLog({
      log: {
        uuid: this.client.uuid,
        geo_cc: c.geo_cc,
        geo_rc: c.geo_rc,
        acpt_lang: c.acpt_lang,
        svc_lang: c.svc_lang,
        is_iframeapi: false,
        content_lang: c.STRM_LANG_TYPE,
        os: 'win',
        is_streamer: false,
        is_rejoin: false,
        is_auto: false,
        is_support_adaptive: true,
        uuid_3rd: this.client.uuid,
        subscribe: -1,
        player_mode: 'landing',
        sub_view_type: 'non_sub',
        subscription_type: 'basic'
      },
      liveualog: {
        is_clearmode: true,
        lowlatency: c.LOWLAYTENCYBJ,
        is_streamer: false,
        os: 'win'
      }
    });

    return result;
  }

  makePlayLog() {
    const c = this.client.channel;

    const cateTag = Array.isArray(c.CATEGORY_TAGS) ? c.CATEGORY_TAGS.join(',') : '';

    const hashtag = Array.isArray(c.HASH_TAGS) ? c.HASH_TAGS.join(',') : '';

    const result = this.makeLog({
      log: {
        uuid: this.client.uuid,
        geo_cc: c.geo_cc,
        geo_rc: c.geo_rc,
        acpt_lang: c.acpt_lang,
        svc_lang: c.svc_lang,
        is_iframeapi: false,
        content_lang: c.STRM_LANG_TYPE,
        os: 'win',
        is_streamer: false,
        is_rejoin: false,
        is_auto: false,
        is_support_adaptive: true,
        uuid_3rd: this.client.uuid,
        subscribe: 0,
        player_mode: 'landing',
        sub_view_type: 'non_sub',
        category_tag: cateTag,
        tag: hashtag,
        is_embed: false
      },
      liveualog: {
        is_clearmode: true,
        lowlatency: c.LOWLAYTENCYBJ,
        is_streamer: false,
        os: 'win'
      }
    });

    return result;
  }

  makeLog({ log = {}, liveualog = {} } = {}) {
    const DC1 = '\x11';
    const DC2 = '\x12';
    const SEP = '\x06&\x06';
    const EQ = '\x06=\x06';

    const make = object => {
      return Object.entries(object)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => {
          const result = `${SEP}${key}${EQ}${value}`;

          return result;
        })
        .join('');
    };

    const result =
      `log${DC1}${make(log)}${DC2}` + `liveualog${DC1}${make(liveualog)}${DC2}`;

    return result;
  }
}
