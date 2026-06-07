import crypto from 'crypto';

import {
    DOMAIN
} from '#soop/config';

export const CONTENT_TYPE = (
    'application/x-www-form-urlencoded'
);

export const AGENT = (
    'application/json, text/javascript, */*; q=0.01'
);

export const ACCEPT_LANGUAGE = (
    'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
)

export const USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/148.0.0.0 Safari/537.36'
);

export async function getStation(userId, options = {}) {
    const url = new URL(
        `/api/${encodeURIComponent(userId)}/station`,
        DOMAIN.chapi
    );

    const json =  await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return json;
}

export async function getStatus(userId, options = {}) {
    const url = new URL(
        `/api/get_station_status.php`,
        DOMAIN.st
    );

    url.searchParams.set('szBjId', userId);

    const json =  await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return json;
}

export async function postLiveInfo(bjId, options = {}) {
    const url = new URL(
        '/afreeca/player_live_api.php',
        DOMAIN.live
    );

    url.searchParams.set('bjid', bjId);

    const body = new URLSearchParams({
        bid: bjId,
        bno: 0,
        type: 'live',
        pwd: '',
        player_type: 'html5',
        stream_type: 'common',
        quality: 'HD',
        mode: 'landing',
        from_api: 0,
        is_revive: false,
    });

    const json =  await requestJson(url, {
        ...options,
        method: 'POST',
        body
    });

    return json?.CHANNEL;
}

export async function getPrivateInfo(options = {}) {
    const url = new URL(
        '/api/get_private_info.php',
        DOMAIN.event
    );

    url.searchParams.set('_', Date.now());

    const data = await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return data?.CHANNEL;
}

export async function getCategory(locale, options = {}) {
    const url = new URL(
        `/script/locale/${locale}/broad_category.js`,
        DOMAIN.live
    );

    const text = await requestText(url, {
        ...options,
        method: 'GET'
    });

    const json = parseCategory(text);

    return json?.CHANNEL?.BROAD_CATEGORY;
}

export function parseCategory(text = '') {
    const match = String(text).match(
        /var\s+szBroadCategory\s*=\s*(\{[\s\S]*?\});?\s*$/
    );

    if (!match) {
        return null;
    }

    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

export async function getSessionAllow(options = {}) {
    const url = new URL(
        '/app/session_allow.php',
        DOMAIN.member
    );

    const raw =  await requestRaw(url, {
        ...options,
        method: 'GET'
    });

    return !!raw;
}

export async function postChatRule(bjId, options = {}) {
    const url = new URL(
        '/api/broad_chat_rule.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        bj_id: bjId,
        szAction: 'get'
    });

    const json =  await requestJson(url, {
        ...options,
        method: 'POST',
        body
    });

    return json?.DATA;
}

export async function getMyPlus(options = {}) {
    const url = new URL(
        '/api/myplus/preferbjOnLnbController.php',
        DOMAIN.live
    );

    url.searchParams.set('isForce', 'n');
    url.searchParams.set('szType', 'all');

    const json = await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return json?.DATA;
}

export async function getSection(bjId, chip, options = {}) {
    const url = new URL(
        `/v1.1/channel/${encodeURIComponent(bjId)}`
        + `/home/section/${chip}`,
        DOMAIN.channel
    );

    const json = await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return json;
}

export async function getBoard(bjId, {
    page = 1,
    perPage = 20,
    startDate = '',
    endDate = '',
    field = 'title,contents,user_nick,user_id,hashtags',
    keyword = '',
    type = 'all',
    orderBy = 'reg_date',
    boardNumber = '',
} = {},
    options = {}
) {
    const url = new URL(
        `/api/${encodeURIComponent(bjId)}/board/`,
        DOMAIN.chapi
    );

    url.searchParams.set('per_page', perPage);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('field', field);
    url.searchParams.set('keyword', keyword);
    url.searchParams.set('type', type);
    url.searchParams.set('order_by', orderBy);
    url.searchParams.set('board_number', boardNumber);
    url.searchParams.set('page', page);

    const json = await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return json;
}

export async function getPoll(bjId, surveyNo, options = {}) {
    const url = new URL(
        '/api/survey/Controllers/'
        + 'SurveyListController.php',
        DOMAIN.live
    );

    url.searchParams.set('szBjId', bjId);
    url.searchParams.set('nSurveyNo', surveyNo);

    const json =  await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return json;
}

export async function postPoll(
    bjId, surveyNo, index, options = {}
) {
    const url = new URL(
        '/api/survey/Controllers/'
        + 'SurveyAnswerController.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        szBjId: bjId,
        nSurveyNo: surveyNo,
        nAnswerNo: index
    });

    const json =  await requestJson(url, {
        ...options,
        method: 'POST',
        body
    });

    return json;
}

export async function postChatNotice(
    broadNo, message = '', state = 1, options = {}
) {
    const url = new URL(
        '/api/chat_notice.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        broad_no: broadNo,
        msg: message,
        state: state,
        store: 1,
    });

    const json = await requestJson(url, {
        ...options,
        method: 'POST',
        body,
    });

    return json;
}

export async function postIceMode(
    broadNo, userId, type, auth, options = {}
) {
    const url = new URL(
        '/api/chat_config_api.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        type: 'updateIceInfo',
        work: 'Ice',
        user_id: userId,
        broad_no: broadNo,
        ice_area_type: 0,
        ice_auth: auth,
        ice_relay_range: 0,
        ice_set_type: type,
        access_system: 'html5',
        is_ext_dashboard: 'false',
    });

    return requestJson(url, {
        ...options,
        method: 'POST',
        body,
    });
}

export async function postTopFan(
    userId, index = 1, options = {}
) {
    const url = new URL(
        '/api/topfan_setting_api.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        work: 'SET_JOIN_NOTICE',
        user_id: userId,
        join_notice_flag: index,
    });

    return requestJson(url, {
        ...options,
        method: 'POST',
        body,
    });
}

export async function postIceOption(
    count = 0, date = 1, options = {}
) {
    const url = new URL(
        '/api/chat_config_api.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        type: 'setIceSetting',
        work: 'Ice',
        gift_cnt: count,
        subscription_date: date,
        access_system: 'html5',
        is_ext_dashboard: 'false',
    });

    return requestJson(url, {
        ...options,
        method: 'POST',
        body
    });
}

export async function getEmoticon(options = {}) {
    const url = new URL(
        '/api/emoticons.php',
        DOMAIN.st
    );

    const json = await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return json?.data;
}

export async function getRecent(options = {}) {
    const url = new URL(
        '/api/recent_used_emoticon.php',
        DOMAIN.live
    );

    const json = await requestJson(url, {
        ...options,
        method: 'GET'
    });

    return json?.DATA;
}

export async function getSignature(bjId, options = {}) {
    const url = new URL(
        '/api/signature_emoticon_api.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        work: 'list',
        v: 'tier',
        szBjId: bjId
    });

    const json = await requestJson(url, {
        ...options,
        method: 'POST',
        body
    });

    return json?.data;
}

export async function postOgqList(bjId, options = {}) {
    const url = new URL(
        '/api/ogq.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        ogq_type: 'STICKER',
        bj_id: bjId,
        ogq_pay_type: 'A',
        sort: 'PURCHASE',
        work: 'ogq_list'
    });

    const json = await requestJson(url, {
        ...options,
        method: 'POST',
        body
    });

    return json;
}

export async function postOgqChat(
    channel, userId, message, ogqId, index = 1, options = {}
) {
    const url = new URL(
        '/api/ogq.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        chat_ip: channel.CHIP,
        chat_port: channel.CHPT,
        chat_no: channel.CHATNO,
        chat_id: channel.USERID,
        chat_message: message,
        bj_id: channel.BJID,
        ogq_id: ogqId,
        ogq_numbering: index,
        ogq_group_id: 0,
        gem_use: 'N',
        api_key: md5(`${userId}${channel.CHATNO}`),
        service_location: 'live',
        work: 'chat_send',
    });

    const json = await requestJson(url, {
        ...options,
        method: 'POST',
        body
    });

    return json;
}

export async function postChallenge(bjId, options = {}) {
    const url = new URL(
        '/api/challenge_funding_api.php',
        DOMAIN.live
    );

    const status = [
        "REQUEST",
        "PROGRESS",
        "SUCCESS",
        "FAIL",
        "CANCEL"
    ];

    const body = new URLSearchParams({
        szWork: 'getChallengeFunding',
        szBjId: bjId,
        szStatus: JSON.stringify(status)
    });

    const json =  await requestJson(url, {
        ...options,
        method: 'POST',
        body
    });

    return json;
}

export async function postMission(bjId, options = {}) {
    const url = new URL(
        '/api/mission_funding_api.php',
        DOMAIN.live
    );

    const body = new URLSearchParams({
        szWork: 'getMissionFunding',
        szBjId: bjId
    });

    const json =  await requestJson(url, {
        ...options,
        method: 'POST',
        body
    });

    return json;
}

export async function login(
    userId, password = '', options = {}
) {
    const body = new URLSearchParams({
        szWork: 'login',
        szType: 'json',
        szUid: userId,
        szPassword: password,
        isSaveId: false,
        szScriptVar: 'oLoginRet',
        szAction: '',
        isLoginRetain: 'N'
    });

    return postLogin(body, options);
}

export async function secondLogin(
    userId, secondPw = '', options = {}
) {
    const body = new URLSearchParams({
        szWork: 'second_login',
        szType: 'json',
        szUid: userId,
        szPassword: secondPw,
        isSaveId: false,
        szScriptVar: 'oLoginRet',
        isLoginRetain: 'N'
    });

    return postLogin(body, options);
}

export async function postLogin(body, options = {}) {
    const url = new URL(
        '/app/LoginAction.php',
        DOMAIN.login
    );

    const referer = new URL(
        '/afreeca/login.php',
        DOMAIN.login
    );

    const headers = {
        'Origin': DOMAIN.login,
        'Referer': referer.href,
    };

    const raw =  await requestRaw(url, {
        ...options,
        method: 'POST',
        headers,
        body
    });

    if (!raw) return false;

    const text = await raw.text();
    const data = JSON.parse(text);

    const cookie = cookieJson(
        cookieExtract(raw)
    );

    return { data, cookie };
}

export async function logout(options = {}) {
    const url = new URL(
        '/app/LogOut.php',
        DOMAIN.login
    );

    url.searchParams.set('szType', 'json');

    const raw = await requestRaw(url, {
        ...options,
        method: 'GET'
    });

    return true;
}

export function normalize(domain) {
    domain = String(domain || '').trim();

    domain = domain.replaceAll('\\', '/');

    if (domain.startsWith('//')) {
        return `https:${domain}`;
    }

    if (!/^https?:\/\//i.test(domain)) {
        return `https://${domain}`;
    }

    return domain;
}

export function md5(data) {
    return (crypto.createHash('md5')
        .update(data).digest('hex')
    );
}

export async function requestRaw(url, options = {}) {
    let {
        method = 'GET',
        headers = {},
        body,
        cookie = ''
    } = options;

    headers = {
        Accept: AGENT,
        'Accept-Language': ACCEPT_LANGUAGE,
        'User-Agent': USER_AGENT,

        ...(body ? {
            'Content-Type': CONTENT_TYPE
        } : {}),

        ...(cookie ? {
            Cookie: cookieString(cookie)
        } : {}),

        ...headers,
    }

    const res = await fetch(url, {
        method,
        headers,
        body
    });

    if (!res.ok) {
        return false;
    }

    return res;
}

export async function requestText(url, options = {}) {
    const res = await requestRaw(url, options);
    if (!res) return null;

    const text = await res.text();
    if (!text) return null;

    return text;
}

export async function requestJson(url, options = {}) {
    const text = await requestText(url, options);
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch (err) {
        return false;
    }
}

export function cookieExtract(data) {
    const cookies = data.headers.getSetCookie?.();

    if (Array.isArray(cookies) && cookies.length > 0) {
        return cookies;
    }

    const cookie = data.headers.get('set-cookie');
    
    return cookie ? [cookie] : [];
}

export function cookieString(cookie = {}) {
    if (!cookie) return '';

    if (typeof cookie === 'string') {
        return cookie;
    }

    return (Object.entries(cookie)
        .filter(([, value]) =>
            value !== undefined
            && value !== null)
        .map(([key, value]) =>
            `${key}=${value}`)
        .join('; ')
    );
}

export function cookieJson(cookie) {
    if (!cookie) return {};

    const result = {};
    const cookies = (
        Array.isArray(cookie)
        ? cookie : [cookie]
    );

    cookies
        .flatMap(v => String(v)
            .split(/,(?=\s*[^;,=\s]+=)/)
        )
        .map(v => v.split(';')[0].trim())
        .filter(Boolean)
        .forEach(v => {
            const index = v.indexOf('=');
            if (index <= 0) return;

            const key = v.slice(
                0, index
            ).trim();
            const value = v.slice(
                index + 1
            ).trim();

            result[key] = value;
        });

    return result;
}