import { WebSocket } from 'ws';

export class Bridge {
    constructor(client) {
        this.client = client;
        this.ws = null;
        this.cert = null;
        this.ping = null;
    }

    get url() {
        return (`wss://bridge.sooplive.com/`
            + `Websocket/${this.client.bjId}`
        );
    }

    isOpen() {
        return (
            this.ws
            && this.ws.readyState === WebSocket.OPEN
        );
    }

    async connect() {
        if (this.isOpen()) {
            return false;
        }

        this.ws = new WebSocket(this.url, 'bridge');

        await this.open();

        return true;
    }

    async open() {
        return new Promise((resolve, reject) => {

        const timeout = setTimeout(() => {
            reject(new Error('bridge timeout'));
        }, 10000);

        this.ws.on('open', () => {
            clearTimeout(timeout);
            this.startPing();
            this.send(this.makeInitGw());
            resolve(true);
        });

        this.ws.on('message', data => {
            this.handler(
                this.parse(data)
            );
        });

        this.ws.on('error', error => {
            clearTimeout(timeout);
            reject(error);
        });

        this.ws.on('close', (code, reason) => {
            clearTimeout(timeout);
            this.stopPing();
        });

        });
    }

    close() {
        this.stopPing();

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
            return {
                SVC: 'UNKNOWN',
                DATA: text
            };
        }
    }

    send(data) {
        if (!this.isOpen()) {
            return false;
        }

        this.ws.send(
            typeof data === 'string'
                ? data
                : JSON.stringify(data)
        );

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

        case 'GETCHINFOEX':
            this.onInfo(DATA);
            break;
        
        case 'SETCHINFO':
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
            break;

        case 'GETBJADCON':
            break;

        case 'GETITEM_SELL':
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
            broadNo: Number(data.uiBroadId),
        };

        this.send(
            this.makeInitBroad()
        );
    }

    onJoin(data = {}) {
        const info = {
            broadNo: Number(data.uiBroadNo),
            advCnt: Number(data.uiAdvCnt),
            advTime: Number(data.uiAdvTime),
            addInfo: data.pAddInfo
        };

        this.client.emit('bridgeJoin', info);
    }

    onInfo(data = {}) {
        this.client.updateBroadcast(data);
    }

    onSet(data = {}) {
        this.client.updateBroadcast(data);
    }

    onClose(data = {}) {
        if (data.pcEndingMsg) {
            this.client.endingMsg(
                data.pcEndingMsg
            );
        }
    }

    makeInitGw() {
        const c = this.client.channel;

        return {
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
                addinfo: this.makeAddInfo(),
            }
        };
    }

    makeInitBroad() {
        const c = this.client.channel;
        const cert = this.cert;

        return {
            SVC: 'INIT_BROAD',
            RESULT: 0,
            DATA: {
                center_ip: c.CTIP,
                center_port: Number(c.CTPT),
                passwd: this.client.broadPw,
                QUALITY: 'normal',
                cli_type: 41,
                cc_cli_type: 19,
                guid: this.client.guid,
                append_data: cert.append,
                gw_ticket: cert.ticket,
                JOINLOG: this.makePlayLog(),
            }
        };
    }

    makePing() {
        return {
            SVC: 'KEEPALIVE',
            RESULT: 0,
            DATA: {}
        };
    }

    makeAddInfo() {
        const DC1 = '\x11';
        const DC2 = '\x12';

        return (`ad_lang${DC1}ko${DC2}`
            + `is_auto${DC1}0${DC2}`
        );
    }

    makeJoinLog() {
        const c = this.client.channel;

        return this.makeLog({
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
                subscription_type: 'basic',
            },
            liveualog: {
                is_clearmode: true,
                lowlatency: c.LOWLAYTENCYBJ,
                is_streamer: false,
                os: 'win',
            }
        });
    }

    makePlayLog() {
        const c = this.client.channel;

        const cateTag = Array.isArray(c.CATEGORY_TAGS)
            ? c.CATEGORY_TAGS.join(',')
            : '';

        const hashtag = Array.isArray(c.HASH_TAGS)
            ? c.HASH_TAGS.join(',')
            : '';

        return this.makeLog({
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
                is_embed: false,
            },
            liveualog: {
                is_clearmode: true,
                lowlatency: c.LOWLAYTENCYBJ,
                is_streamer: false,
                os: 'win',
            }
        });
    }

    makeLog({ log = {}, liveualog = {} } = {}) {
        const DC1 = '\x11';
        const DC2 = '\x12';
        const SEP = '\x06&\x06';
        const EQ = '\x06=\x06';

        const make = object => {
            return Object.entries(object)
                .filter(([, value]) =>
                    value !== undefined
                    && value !== null
                    && value !== ''
                )
                .map(([key, value]) => {
                    return `${SEP}${key}${EQ}${value}`;
                })
                .join('');
        };

        return (`log${DC1}${make(log)}${DC2}`
            + `liveualog${DC1}${make(liveualog)}${DC2}`
        );
    }
}