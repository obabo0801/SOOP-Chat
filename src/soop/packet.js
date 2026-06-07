import {
    DELIMITER,
    SVC
} from '#soop/config';

export function makePacket(service, fields = []) {
    const body = toBody(fields);

    const header = (
        DELIMITER.ESC
        + DELIMITER.TAB
        + makeSvcCode(service)
        + makeBodySize(body)
        + '00'
    );

    return Buffer.concat([
        Buffer.from(header, 'binary'),
        body
    ]);
}

export function makePayload(data) {
    const dc1 = DELIMITER.DC1;
    const dc2 = DELIMITER.DC2;

    return (Object.entries(data)
        .filter(([, value]) => (
            value !== undefined
            && value !== null
        ))
        .map(([key, value]) => (
            `${key}${dc1}`
            + `${value}${dc2}`
        ))
        .join('')
    );
}

export function makePlayLog(channel, uuid) {
    const ack = DELIMITER.ACK;

    return [
        ack,
        `&${ack}set_bps${ack}=`
            + `${ack}${channel.BPS}`,
        `${ack}&${ack}view_bps${ack}=`
            + `${ack}${channel.BPS}`,
        `${ack}&${ack}quality${ack}=`
            + `${ack}ori`,
        `${ack}&${ack}uuid${ack}=`
            + `${ack}${uuid}`,
        `${ack}&${ack}geo_cc${ack}=`
            + `${ack}${channel.geo_cc}`,
        `${ack}&${ack}geo_rc${ack}=`
            + `${ack}${channel.geo_rc}`,
        `${ack}&${ack}acpt_lang${ack}=`
            + `${ack}${channel.STRM_LANG_TYPE}`,
        `${ack}&${ack}svc_lang${ack}=`
            + `${ack}${channel.STRM_LANG_TYPE}`,
        `${ack}&${ack}is_iframeapi${ack}=`
            + `${ack}false`,
        channel.join_cc
            ? `${ack}&${ack}join_cc${ack}=`
                + `${ack}${channel.join_cc}`
            : '',
        `${ack}&${ack}subscribe${ack}=`
            + `${ack}${channel.SUB_PAY_CNT}`,
        `${ack}&${ack}lowlatency${ack}=`
            + `${ack}1`,
        `${ack}&${ack}mode${ack}=`
            + `${ack}landing`
    ].join('');
}

export function makeLogin(ticket, flag = 16) {
    const fields = [
        ticket,
        '',
        flag
    ];

    return makePacket(SVC.LOGIN, fields);
}

export function makeJoinChannel(channel, pver, password, uuid) {
    const mode = makePayload({
        log: makePlayLog(channel, uuid),
        pwd: password,
        auth_info: 'NULL',
        pver: pver,
        access_system: 'html5',
        nation_lang: channel.STRM_LANG_TYPE
    });

    const fields = [
        channel.CHATNO,
        channel.FTK,
        0,
        '',
        mode
    ];

    return makePacket(SVC.JOIN_CHANNEL, fields);
}

export function makeKeepAlive() {
    return makePacket(SVC.KEEPALIVE);
}

export function makeChat(message) {
    const fields = [
        message,
        0
    ];

    return makePacket(SVC.CHAT, fields);
}

export function makeManagerChat(message) {
    const fields = [
        message
    ];

    return makePacket(SVC.MANAGER_CHAT, fields);
}

export function makeDirectChat(message, targetId) {
    const fields = [
        message,
        targetId
    ];

    return makePacket(SVC.DIRECT_CHAT, fields);
}

export function makeSubBj(targetId, index = 0) {
    const fields = [
        targetId,
        index
    ];

    return makePacket(SVC.SET_SUB_BJ, fields);
}

export function makeUserFlag(flag) {
    const fields = [
        flag,
        0
    ];

    return makePacket(SVC.SET_USER_FLAG, fields);
}

export function makeClubColor(color) {
    const fields = [
        color
    ];

    return makePacket(SVC.CLUB_COLOR, fields);
}

export function makeTranslation(message, mode = 1) {
    const fields = [
        1,
        mode,
        message,
        3
    ];

    return makePacket(SVC.TRANSLATION, fields);
}

export function makeDumb(targetId, message) {
    const fields = [
        targetId,
        message
    ];

    return makePacket(SVC.SET_DUMB, fields);
}

export function makeKick(
    targetId, targetNick, adminId, broadNo, index = 0, message = ''
) {
    const fields = [
        targetId,
        targetNick,
        adminId,
        broadNo,
        index,
        message
    ]; 

    return makePacket(SVC.KICK_AND_CANCEL, fields);
}

export function makeBlack(broadNo, adminId, targetId) {
    const fields = [
        broadNo,
        adminId,
        targetId
    ]; 

    return makePacket(SVC.BDM_ADD_BLACK_INFO, fields);
}

export function makeKickList(broadNo) {
    const fields = [
        broadNo
    ];

    return makePacket(SVC.KICK_USER_LIST, fields);
}

export function makeSlowMode(chatNo, count = 0) {
    const fields = [
        chatNo,
        count
    ];

    return makePacket(SVC.SLOW_MODE, fields);
}

export function makeSubtitle(index = 0) {
    const fields = [
        index,
    ];

    return makePacket(SVC.USER_LANG_SET, fields);
}

export function makeUserList() {
    return makePacket(SVC.CHUSER);
}

export function makeSvcCode(value) {
    return String(value).padStart(4, '0');
}

export function makeBodySize(body) {
    return String(body.length).padStart(6, '0')
}

function toBuffer(data) {
    if (Buffer.isBuffer(data)) {
        return data;
    }

    if (data instanceof Uint8Array) {
        return Buffer.from(data);
    }

    return Buffer.from(String(data), 'utf8');
}

function toBody(fields = []) {
    const chunks = [];

    for (const field of fields) {
        chunks.push(toBuffer(DELIMITER.FF));
        chunks.push(toBuffer(field));
    }

    chunks.push(toBuffer(DELIMITER.FF));

    return Buffer.concat(chunks);
}

export function toVisible(data) {
    return (String(data)
        .replaceAll(DELIMITER.ESC, '<ESC>')
        .replaceAll(DELIMITER.TAB, '<TAB>')
        .replaceAll(DELIMITER.FF, '<FF>')
        .replaceAll(DELIMITER.DC1, '<DC1>')
        .replaceAll(DELIMITER.DC2, '<DC2>')
        .replaceAll(DELIMITER.ACK, '<ACK>')
    );
}

export function parse(data) {
    const raw = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : String(data);

    const head = (
        DELIMITER.ESC
        + DELIMITER.TAB
    );

    const offset = raw.startsWith(head)
        ? head.length
        : 0;

    const service = Number(
        raw.slice(offset, offset + 4)
    );

    const length = Number(
        raw.slice(offset + 4, offset + 10)
    );

    const flag = raw.slice(
        offset + 10,
        offset + 12
    );

    const body = raw.slice(offset + 12);

    const fields = body
        .split(DELIMITER.FF)
        .slice(1, -1);

    return { service, length, flag, fields, raw };
}