import crypto from 'crypto';

import { DOMAIN } from '#soop/config';

export const CONTENT_TYPE = 'application/x-www-form-urlencoded';

export const AGENT = 'application/json, text/javascript, */*; q=0.01';

export const ACCEPT_LANGUAGE = 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/148.0.0.0 Safari/537.36';

export async function getStation(userId, options = {}) {
  const url = new URL(`/api/${encodeURIComponent(userId)}/station`, DOMAIN.chapi);

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  return json;
}

export async function getStatus(userId, options = {}) {
  const url = new URL(`/api/get_station_status.php`, DOMAIN.st);

  url.searchParams.set('szBjId', userId);

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  return json;
}

export async function getEmblem(userId, options = {}) {
  const json = await getStatus(userId, options);
  const data = json?.DATA;

  if (json?.RESULT !== 1 || !data?.emblem_img_url) {
    return null;
  }

  const result = {
    grade: data.emblem_grade,
    level: data.emblem_level,
    number: data.emblem_no,
    url: data.emblem_img_url
  };

  return result;
}

export async function getDashboard(userId, options = {}) {
  const url = new URL(
    `/v1.1/channel/${encodeURIComponent(userId)}/dashboard`,
    DOMAIN.channel
  );

  const result = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  return result;
}

export async function postLiveInfo(bjId, options = {}) {
  const url = new URL('/afreeca/player_live_api.php', DOMAIN.live);

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
    is_revive: false
  });

  const json = await requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  const result = json?.CHANNEL;

  return result;
}

function restriction(channel, cookie) {
  const result = Number(channel?.RESULT);

  if (result === 0) {
    return null;
  }

  let message = '영상 연결에 실패했습니다';

  if (result === -6 || result === -8) {
    const login = /(?:^|;\s*)AuthTicket=/.test(cookieString(cookie));

    message = login ? '성인 인증이 필요합니다' : '로그인이 필요합니다';
  }
  else if (result === -11) {
    message = '로그인이 필요합니다';
  }

  const error = new Error(message);

  error.code = 'SOOP_STREAM';

  return error;
}

export async function getStream(bjId, quality = 'hd', options = {}) {
  const referer = new URL(`/${encodeURIComponent(bjId)}`, DOMAIN.play);

  const headers = {
    Referer: referer.href,
    Origin: DOMAIN.play,
    'User-Agent': options.headers?.['User-Agent'] || USER_AGENT
  };

  const channel = await postLiveInfo(bjId, {
    ...options,
    headers: {
      ...options.headers,
      ...headers
    }
  });

  if (Number(channel?.RESULT) !== 1 || !channel?.BNO || !channel?.RMD) {
    const error = restriction(channel, options.cookie);

    if (error) {
      throw error;
    }

    return null;
  }

  const preset = channel.VIEWPRESET?.find(
    item => item.name === quality && item.name !== 'auto'
  );

  if (!preset) {
    throw new Error('화질 오류');
  }

  const url = new URL('/afreeca/player_live_api.php', DOMAIN.live);

  const body = new URLSearchParams({
    bid: bjId,
    bno: channel.BNO,
    type: 'aid',
    pwd: options.password || '',
    quality,
    from_api: 0,
    mode: 'landing',
    player_type: 'html5',
    stream_type: 'common'
  });

  const auth = await requestJson(url, {
    ...options,
    headers: {
      ...options.headers,
      ...headers
    },
    method: 'POST',
    body
  });

  if (Number(auth?.CHANNEL?.RESULT) !== 1 || !auth?.CHANNEL?.AID) {
    const error = restriction(auth?.CHANNEL, options.cookie);

    if (error) {
      throw error;
    }

    return null;
  }

  let cdn = channel.CDN;

  if (cdn?.includes('gs_cdn')) {
    cdn = 'gs_cdn_pc_web';
  }
  else if (cdn?.includes('lg_cdn')) {
    cdn = 'lg_cdn_pc_web';
  }

  if (!cdn) {
    return null;
  }

  const assign = new URL('/broad_stream_assign.html', channel.RMD);

  assign.search = new URLSearchParams({
    return_type: cdn,
    broad_key: `${channel.BNO}-common-${quality}-hls`
  }).toString();

  const stream = await requestJson(assign, {
    method: 'GET',
    headers
  });

  if (!stream?.view_url) {
    return null;
  }

  const source = new URL(stream.view_url);

  if (!['http:', 'https:'].includes(source.protocol)) {
    return null;
  }

  source.searchParams.set('aid', auth.CHANNEL.AID);

  const result = {
    bjId,
    broadNo: Number(channel.BNO),
    center: `${channel.CTIP}:${Number(channel.CTPT)}`,
    captions: Boolean(channel.SUBTITLE_FLAG),
    quality,
    qualities: channel.VIEWPRESET.filter(item => item.name !== 'auto').map(item => ({
      name: item.name,
      label: item.label
    })),
    url: source.href,
    headers
  };

  return result;
}

export async function getPrivateInfo(options = {}) {
  const url = new URL('/api/get_private_info.php', DOMAIN.event);

  url.searchParams.set('_', Date.now());

  const data = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  const result = data?.CHANNEL;

  return result;
}

export async function getCategory(locale, options = {}) {
  const url = new URL(`/script/locale/${locale}/broad_category.js`, DOMAIN.live);

  const text = await requestText(url, {
    ...options,
    method: 'GET'
  });

  const json = parseCategory(text);

  const result = json?.CHANNEL?.BROAD_CATEGORY;

  return result;
}

export function parseCategory(text = '') {
  const match = String(text).match(/var\s+szBroadCategory\s*=\s*(\{[\s\S]*?\});?\s*$/);

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
  const url = new URL('/app/session_allow.php', DOMAIN.member);

  const raw = await requestRaw(url, {
    ...options,
    method: 'GET'
  });

  const result = !!raw;

  return result;
}

export async function postChatRule(bjId, options = {}) {
  const url = new URL('/api/broad_chat_rule.php', DOMAIN.live);

  const body = new URLSearchParams({
    bj_id: bjId,
    szAction: 'get'
  });

  const json = await requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  const result = json?.DATA;

  return result;
}

export async function postRule(message, display, options = {}) {
  const url = new URL('/api/broad_chat_rule.php', DOMAIN.live);
  const body = new URLSearchParams({
    szAction: 'set',
    chat_rule: message,
    chat_rule_display: display
  });
  const result = await requestJson(url, { ...options, method: 'POST', body });

  return result;
}

export async function getMyPlus(options = {}) {
  const url = new URL('/api/myplus/preferbjOnLnbController.php', DOMAIN.live);

  url.searchParams.set('isForce', 'n');
  url.searchParams.set('szType', 'all');

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  const result = json?.DATA;

  return result;
}

export async function getChannel(bjId, chip, options = {}) {
  const url = new URL(
    `/v1.1/channel/${encodeURIComponent(bjId)}` + `/${chip}`,
    DOMAIN.channel
  );

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  return json;
}

export async function getSection(bjId, chip, options = {}) {
  const url = new URL(
    `/v1.1/channel/${encodeURIComponent(bjId)}` + `/home/section/${chip}`,
    DOMAIN.channel
  );

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  return json;
}

export async function getVod(bjId, chip = '', options = {}) {
  const result = getChannel(bjId, `vod/${chip}`, options);

  return result;
}

export async function getVodContent(titleNo, options = {}) {
  const url = new URL('/station/video/a/view', DOMAIN.mobile);
  const body = new URLSearchParams({
    nTitleNo: String(titleNo),
    nApiLevel: '11',
    nPlaylistIdx: '0'
  });
  const json = await requestJson(url, { ...options, method: 'POST', body });
  const valid = json?.result === 1 && String(json.data?.title_no) === String(titleNo);
  const removed = json?.result === -1 && Number(json.data?.code) === -6221;
  const result = { status: valid ? 200 : null, data: json?.data, removed };

  return result;
}

export async function getBoard(
  bjId,
  {
    page = 1,
    perPage = 20,
    startDate = '',
    endDate = '',
    field = 'title,contents,user_nick,user_id,hashtags',
    keyword = '',
    type = 'all',
    orderBy = 'reg_date',
    boardNumber = ''
  } = {},
  options = {}
) {
  const url = new URL(`/api/${encodeURIComponent(bjId)}/board/`, DOMAIN.chapi);

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

export async function getContent(bjId, titleNo, options = {}) {
  const url = new URL(
    `/api/${encodeURIComponent(bjId)}/title/${encodeURIComponent(titleNo)}`,
    DOMAIN.chapi
  );
  const request = fetch;
  const headers = {
    Accept: AGENT,
    'User-Agent': options.headers?.['User-Agent'] || USER_AGENT,
    ...options.headers,
    ...(options.cookie ? { Cookie: cookieString(options.cookie) } : {})
  };
  let signal;

  if (options.signal) {
    signal = AbortSignal.any([options.signal, AbortSignal.timeout(10000)]);
  }
  else {
    signal = AbortSignal.timeout(10000);
  }

  const response = await request(url, { headers, signal });
  const data = await response.json();

  const result = { status: response.status, data };

  return result;
}

export async function getComments(bjId, titleNo, page = 1, options = {}) {
  const url = new URL(
    `/api/${encodeURIComponent(bjId)}/title/${encodeURIComponent(titleNo)}/comment`,
    DOMAIN.chapi
  );

  url.searchParams.set('page', page);

  const result = requestJson(url, { ...options, method: 'GET' });

  return result;
}

export async function getReplies(bjId, titleNo, commentNo, options = {}) {
  const url = new URL(
    `/api/${encodeURIComponent(bjId)}/title/${encodeURIComponent(titleNo)}`
      + `/comment/${encodeURIComponent(commentNo)}/reply`,
    DOMAIN.chapi
  );

  const result = requestJson(url, { ...options, method: 'GET' });

  return result;
}

export async function getPoll(bjId, surveyNo, options = {}) {
  const url = new URL(
    '/api/survey/Controllers/' + 'SurveyListController.php',
    DOMAIN.live
  );

  url.searchParams.set('szBjId', bjId);
  url.searchParams.set('nSurveyNo', surveyNo);

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  return json;
}

export async function postPoll(bjId, surveyNo, index, options = {}) {
  const url = new URL(
    '/api/survey/Controllers/' + 'SurveyAnswerController.php',
    DOMAIN.live
  );

  const body = new URLSearchParams({
    szBjId: bjId,
    nSurveyNo: surveyNo,
    nAnswerNo: index
  });

  const json = await requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  return json;
}

export async function postChatNotice(broadNo, message = '', state = 1, options = {}) {
  const url = new URL('/api/chat_notice.php', DOMAIN.live);

  const body = new URLSearchParams({
    broad_no: broadNo,
    msg: message,
    state: state,
    store: 1
  });

  const json = await requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  return json;
}

export async function postIceMode(broadNo, userId, type, auth, options = {}) {
  const url = new URL('/api/chat_config_api.php', DOMAIN.live);

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
    is_ext_dashboard: 'false'
  });

  const result = requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  return result;
}

export async function postTopFan(userId, index = 1, options = {}) {
  const url = new URL('/api/topfan_setting_api.php', DOMAIN.live);

  const body = new URLSearchParams({
    work: 'SET_JOIN_NOTICE',
    user_id: userId,
    join_notice_flag: index
  });

  const result = requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  return result;
}

export async function postIceOption(count = 0, date = 1, options = {}) {
  const url = new URL('/api/chat_config_api.php', DOMAIN.live);

  const body = new URLSearchParams({
    type: 'setIceSetting',
    work: 'Ice',
    gift_cnt: count,
    subscription_date: date,
    access_system: 'html5',
    is_ext_dashboard: 'false'
  });

  const result = requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  return result;
}

export async function getEmoticon(options = {}) {
  const url = new URL('/api/emoticons.php', DOMAIN.st);

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  const result = json?.data;

  return result;
}

export async function getRecent(options = {}) {
  const url = new URL('/api/recent_used_emoticon.php', DOMAIN.live);

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  const result = json?.DATA;

  return result;
}

export async function getSignature(bjId, options = {}) {
  const url = new URL('/api/signature_emoticon_api.php', DOMAIN.live);

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

  const result = json?.data;

  return result;
}

export async function postOgqList(bjId, options = {}) {
  const url = new URL('/api/ogq.php', DOMAIN.live);

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
  channel,
  userId,
  message,
  ogqId,
  index = 1,
  options = {}
) {
  const chatId = String(userId || channel.USERID || '');

  userId = chatId.replace(/\(\d+\)$/, '');

  const url = new URL('/api/ogq.php', DOMAIN.live);

  const body = new URLSearchParams({
    chat_ip: channel.CHIP,
    chat_port: channel.CHPT,
    chat_no: channel.CHATNO,
    chat_id: chatId,
    chat_message: message,
    bj_id: channel.BJID,
    ogq_id: ogqId,
    ogq_numbering: index,
    ogq_group_id: 0,
    gem_use: 'N',
    api_key: md5(`${userId}${channel.CHATNO}`),
    service_location: 'live',
    work: 'chat_send'
  });

  const json = await requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  return json;
}

export async function postChallenge(bjId, options = {}) {
  const url = new URL('/api/challenge_funding_api.php', DOMAIN.live);

  const status = ['REQUEST', 'PROGRESS', 'SUCCESS', 'FAIL', 'CANCEL'];

  const body = new URLSearchParams({
    szWork: 'getChallengeFunding',
    szBjId: bjId,
    szStatus: JSON.stringify(status)
  });

  const json = await requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  return json;
}

export async function postMission(bjId, options = {}) {
  const url = new URL('/api/mission_funding_api.php', DOMAIN.live);

  const body = new URLSearchParams({
    szWork: 'getMissionFunding',
    szBjId: bjId
  });

  const json = await requestJson(url, {
    ...options,
    method: 'POST',
    body
  });

  return json;
}

export async function login(userId, password = '', options = {}) {
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

export async function secondLogin(userId, secondPw = '', options = {}) {
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
  const url = new URL('/app/LoginAction.php', DOMAIN.login);

  const referer = new URL('/afreeca/login.php', DOMAIN.login);

  const headers = {
    Origin: DOMAIN.login,
    Referer: referer.href
  };

  const raw = await requestRaw(url, {
    ...options,
    method: 'POST',
    headers: {
      ...options.headers,
      ...headers
    },
    body
  });

  if (!raw) {
    return false;
  }

  const text = await raw.text();
  const data = JSON.parse(text);

  const cookie = cookieJson(cookieExtract(raw));

  const result = { data, cookie };

  return result;
}

export async function logout(options = {}) {
  const url = new URL('/app/LogOut.php', DOMAIN.login);

  url.searchParams.set('szType', 'json');

  await requestRaw(url, {
    ...options,
    method: 'GET'
  });

  return true;
}

export function normalize(domain) {
  domain = String(domain || '').trim();

  domain = domain.replaceAll('\\', '/');

  if (domain.startsWith('//')) {
    const value = `https:${domain}`;

    return value;
  }

  if (!/^https?:\/\//i.test(domain)) {
    const result = `https://${domain}`;

    return result;
  }

  return domain;
}

export function md5(data) {
  return crypto.createHash('md5').update(data).digest('hex');
}

export async function requestRaw(url, options = {}) {
  const { method = 'GET', headers: source = {}, body, cookie = '' } = options;

  const headers = {
    Accept: AGENT,
    'Accept-Language': ACCEPT_LANGUAGE,
    'User-Agent': USER_AGENT,

    ...(body
      ? {
          'Content-Type': CONTENT_TYPE
        }
      : {}),

    ...(cookie
      ? {
          Cookie: cookieString(cookie)
        }
      : {}),

    ...source
  };

  const request = fetch;
  let signal;

  if (options.signal) {
    signal = AbortSignal.any([options.signal, AbortSignal.timeout(15000)]);
  }
  else {
    signal = AbortSignal.timeout(15000);
  }

  const res = await request(url, { signal, method, headers, body });

  if (!res.ok) {
    return false;
  }

  return res;
}

export async function requestText(url, options = {}) {
  const res = await requestRaw(url, options);

  if (!res) {
    return null;
  }

  const text = await res.text();

  if (!text) {
    return null;
  }

  return text;
}

export async function requestJson(url, options = {}) {
  const text = await requestText(url, options);

  if (!text) {
    return null;
  }

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

  const result = cookie ? [cookie] : [];

  return result;
}

export function cookieString(cookie = {}) {
  if (!cookie) {
    return '';
  }

  if (typeof cookie === 'string') {
    return cookie;
  }

  return Object.entries(cookie)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

export function cookieJson(cookie) {
  if (!cookie) {
    const output = {};

    return output;
  }

  const result = {};
  const cookies = Array.isArray(cookie) ? cookie : [cookie];

  cookies
    .flatMap(v => String(v).split(/,(?=\s*[^;,=\s]+=)/))
    .map(v => v.split(';')[0].trim())
    .filter(Boolean)
    .forEach(v => {
      const index = v.indexOf('=');

      if (index <= 0) {
        return;
      }

      const key = v.slice(0, index).trim();
      const value = v.slice(index + 1).trim();

      result[key] = value;
    });

  return result;
}
