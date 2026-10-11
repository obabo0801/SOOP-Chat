import crypto from 'crypto';

import { DOMAIN } from '#soop/config';

export const CONTENT_TYPE = 'application/x-www-form-urlencoded';

export const AGENT = 'application/json, text/javascript, */*; q=0.01';

export const ACCEPT_LANGUAGE = 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/148.0.0.0 Safari/537.36';

const searchList = value => Array.isArray(value) ? value : [];

function searchBadges(item) {
  return {
    subscribed: Number(item.subs_flag) > 0,
    fan: Number(item.fan_flag) > 0,
    emblem: item.emblem_img_url || '',
    emblemGrade: item.emblem_grade || '',
    emblemLevel: item.emblem_level || ''
  };
}

export async function getStation(userId, options = {}) {
  const url = new URL(`/api/${encodeURIComponent(userId)}/station`, DOMAIN.chapi);

  const json = await requestJson(url, {
    ...options,
    method: 'GET'
  });

  if (json?.profile_image) json.profile_image = normalize(json.profile_image);
  return json;
}

export async function searchStreamers(keyword, page = 1, options = {}) {
  keyword = String(keyword || '').trim();

  if (!keyword || keyword.length > 100 || !Number.isInteger(page) || page < 1 || page > 100) {
    throw new Error('검색 설정 오류');
  }

  const search = method => {
    const url = new URL('/api.php', DOMAIN.search);

    url.search = new URLSearchParams({
      l: 'DF',
      m: method,
      v: method === 'bjSearch' ? '3.0' : '2.0',
      c: 'UTF-8',
      w: 'webk',
      szType: 'json',
      szOrder: 'score',
      szKeyword: encodeURIComponent(keyword),
      nPageNo: String(page),
      nListCnt: '12',
      onlyParent: '1',
      isMobile: '0',
      tab: method === 'bjSearch' ? 'bj' : 'live'
    });

    return requestJson(url, options);
  };
  const [streamers, live] = await Promise.all([search('bjSearch'), search('liveSearch')]);

  if (Number(streamers?.RESULT) !== 1 || !Array.isArray(streamers.DATA)) {
    throw new Error('스트리머 검색 실패');
  }

  const broadcasts = new Map(searchList(live?.REAL_BROAD).map(item => [item.user_id, item]));
  const items = await Promise.all(streamers.DATA.map(async item => {
    let broad = broadcasts.get(item.user_id);

    if (!broad && Number(item.broad_no) > 0) {
      const station = await getStation(item.user_id, options);

      broad = station?.broad;
    }

    const number = Number(broad?.broad_no) || 0;

    return {
      id: item.user_id,
      name: item.user_nick || item.user_id,
      image: item.station_logo || '',
      favorites: Number(item.favorite_cnt) || 0,
      medal: item.medal_url || '',
      ...searchBadges(item),
      live: number > 0,
      number,
      title: broad?.broad_title || '',
      viewers: Number(broad?.current_sum_viewer ?? broad?.total_view_cnt) || 0,
      languages: broad?.lang_tags || [],
      categories: broad?.category_tags || (broad?.broad_cate_name ? [broad.broad_cate_name] : []),
      tags: broad?.hash_tags || [],
      drops: Boolean(Number(broad?.is_drops))
    };
  }));

  return { items, more: page * 12 < Number(streamers.TOTAL_CNT) };
}

export async function searchContents(keyword, page = 1, type = 'all', options = {}) {
  if (!['all', 'live', 'vod', 'post', 'streamer'].includes(type)
    || !keyword.trim() || keyword.length > 100 || !Number.isInteger(page) || page < 1 || page > 100) {
    throw new Error('검색 설정 오류');
  }

  const search = (method, version, extra) => {
    const url = new URL('/api.php', DOMAIN.search);
    url.search = new URLSearchParams({
      l: 'DF', m: method, v: version, w: 'webk', c: 'UTF-8', szType: 'json',
      isMobile: '0', nPageNo: String(page), nListCnt: '12', szOrder: 'score',
      szKeyword: encodeURIComponent(keyword), ...extra
    });
    return requestJson(url, options);
  };
    const [streamers, theme, vod, posts, live] = await Promise.allSettled([
      ['all', 'streamer'].includes(type) ? searchStreamers(keyword, page, options) : null,
    type === 'all' && page === 1
      ? search('profileTheme', '6.0', { d: encodeURIComponent(keyword), pttype: 'all', tab: 'total', location: 'total_search' }) : null,
    ['all', 'vod'].includes(type)
      ? search('vodSearch', '5.0', { tab: type === 'all' ? 'TOTAL' : 'VOD', szFileType: 'ALL', szTerm: '1year', location: 'total_search' }) : null,
    ['all', 'post'].includes(type)
        ? search('postsSearch', '1.0', { tab: type === 'all' ? 'total' : 'post', szTerm: 'all', nUseFiltering: '1' }) : null,
      ['all', 'live'].includes(type)
        ? search('liveSearch', '2.0', { tab: type === 'all' ? 'total' : 'live', onlyParent: '1', location: 'total_search', isHashSearch: '0' }) : null
  ]);
  const value = result => result.status === 'fulfilled' ? result.value : null;
  const people = value(streamers)?.items || [];
  const themed = value(theme);
  const videos = value(vod);
  const articles = value(posts);
  const video = item => ({
    ...searchBadges(item),
    id: String(item.title_no || ''), userId: item.user_id || '', name: item.user_nick || '',
    title: item.title || '', image: item.thumbnail_path || item.mobile_thumbnail_path || '',
    vertical: item.vertical_thumbnail_path || '', duration: item.duration || '',
    views: Number(item.view_cnt) || 0, date: item.reg_date || '', type: item.file_type || '',
    originalName: item.original_user_nick || '', tags: item.hash_tags || [],
    languages: item.lang_tags || [], categories: item.category_tags || [],
    url: new URL(item.file_type === 'CATCH_STORY'
      ? `/player/${item.list_no}/catchstory` : `/player/${item.title_no}`, DOMAIN.vod).href
  });
    const related = item => item.recommend_type === 'BJ' ? ({
      kind: 'streamer', id: item.user_id, name: item.user_nick,
      ...searchBadges(item),
      image: item.station_logo || '', favorites: Number(item.favorite_cnt) || 0
    }) : (item.recommend_type === 'LIVE' || !item.recommend_type && !item.title_no && item.broad_no) ? ({
    id: item.user_id || '', name: item.user_nick || item.user_id || '',
    ...searchBadges(item),
    image: item.broad_img || item.thumbnail_path || '', title: item.broad_title || item.title || '',
    live: Boolean(item.broad_no), number: Number(item.broad_no) || 0,
    viewers: Number(item.current_sum_viewer ?? item.total_view_cnt) || 0,
    drops: Boolean(Number(item.is_drops)),
      languages: item.lang_tags || [], categories: item.category_tags || [], tags: item.hash_tags || [], url: ''
    }) : video(item);
  const profiles = searchList(themed?.PROFILE).map(item => ({
    id: item.user_id, name: item.user_nick, image: item.img_file,
    favorites: Number(item.fan_count) || 0, notice: item.notice || '',
    participants: item.view_count == null || item.view_count === '' ? null : Number(item.view_count),
    noticeUrl: item.title_no ? new URL(`/station/${item.user_id}/post/${item.title_no}`, DOMAIN.soop).href : '',
    medals: (Array.isArray(item.medal) ? item.medal : []).map(medal => ({
      image: medal.simple_url || medal.basic_url || '',
      name: medal.content || '', description: medal.description || ''
    })).filter(medal => medal.image),
    ...searchBadges(item)
  }));
  const banners = searchList(themed?.THEME).map(item => {
    const html = String(item.html || '').replaceAll('&quot;', '"').replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
    const links = [];
    for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
      const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)]
        .map(value => [value[1].toLowerCase(), value[3]]));
      let url;
      try { url = new URL(attributes.href); } catch { continue; }
      if (url.protocol !== 'https:' || !['sooplive.com', 'www.sooplive.com'].includes(url.hostname)
        || !/^\/station\/[a-z0-9_]+\/?$/i.test(url.pathname)) continue;
      const bounds = Object.fromEntries([...String(attributes.style || '').matchAll(/(?:^|;)\s*(top|left|width|height)\s*:\s*(\d+(?:\.\d+)?)%/gi)]
        .map(value => [value[1].toLowerCase(), Number(value[2])]));
      if (!['top', 'left', 'width', 'height'].every(key => Number.isFinite(bounds[key]) && bounds[key] >= 0)
        || bounds.width <= 0 || bounds.height <= 0
        || bounds.left + bounds.width > 100 || bounds.top + bounds.height > 100) continue;
      links.push({ url: url.href, title: attributes.title || item.title || '', ...bounds });
    }
    return { title: item.title || '', image: html.match(/src="([^"]+)"/)?.[1] || '', links };
  }).filter(item => item.image);
    const broadcasts = value(live);
    const more = type === 'live' ? Boolean(broadcasts?.HAS_MORE_LIST)
      : type === 'streamer' ? Boolean(value(streamers)?.more)
    : type === 'vod' ? Boolean(videos?.HAS_MORE_LIST)
      : type === 'post' ? page * 12 < Number(articles?.TOTAL_CNT) : false;
    if ([streamers, theme, vod, posts, live].every(result => result.status === 'rejected' || !result.value)) {
    throw new Error('검색 결과를 불러오지 못했습니다');
  }
  return {
      profiles, live: searchList(broadcasts?.REAL_BROAD).map(related), latest: searchList(themed?.LATEST_VOD).map(video),
    banners, related: searchList(themed?.RECOMMEND_CONTENTS).map(related),
    stories: searchList(videos?.CATCH_STORY_DATA).map(video), vod: searchList(videos?.DATA).map(video),
    posts: searchList(articles?.DATA).map(item => ({
      ...searchBadges(item),
      id: String(item.title_no), userId: item.user_id, name: item.user_nick,
      station: item.station_name || '', title: item.title || '', content: item.content || '',
      image: item.thumbnail || '', profile: item.station_logo || '', date: item.reg_date || '',
      views: Number(item.view_cnt) || 0,
      url: new URL(`/station/${item.station_user_id}/post/${item.title_no}`, DOMAIN.soop).href
    })), streamers: people, more
  };
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

export async function getUpStatus(bjId, broadNo, options = {}) {
  if (!options.cookie || !bjId || !broadNo) return null;
  const url = new URL('/api/ok_api.php', DOMAIN.live);
  url.search = new URLSearchParams({ szWork: 'createCode', szFileType: 'jsonp',
    szBjId: bjId, nBroadNo: String(broadNo), szCallBack: 'callback', _: String(Date.now()) });
  const text = await requestText(url, { ...options, method: 'GET',
    headers: { ...options.headers, Referer: `${DOMAIN.play}/${bjId}/${broadNo}` } });
  const value = text?.trim().replace(/^callback\s*\(/, '').replace(/\);?\s*$/, '');
  const data = JSON.parse(value || 'null');
  if (Number(data?.RESULT) === -3) return true;
  return null;
}

export async function postReaction(bjId, broadNo, action, options = {}) {
  const call = async (route, data, method = 'GET') => {
    const url = new URL(route, DOMAIN.live);
    const params = new URLSearchParams({ ...data, callback: 'callback', szCallBack: 'callback', _: String(Date.now()) });
    if (method === 'GET') url.search = params;
    const text = await requestText(url, {
      ...options, method, body: method === 'POST' ? params.toString() : undefined,
      headers: { ...options.headers, Referer: `${DOMAIN.play}/${bjId}/${broadNo || ''}` }
    });
    const value = text?.trim().replace(/^callback\s*\(/, '').replace(/\);?\s*$/, '');
    if (route === '/afreeca/favorite_list_api.php') {
      const result = value?.match(/"CHANNEL"\s*:\s*\{\s*"RESULT"\s*:\s*"?(-?\d+)"?\s*[,}]/);
      if (!result) throw new Error('즐겨찾기 응답을 확인할 수 없습니다.');
      return { CHANNEL: { RESULT: Number(result[1]) } };
    }
    return JSON.parse(value || 'null');
  };
  if (action === 'favorite') {
    const data = { szBjId: bjId, szFrom: 'html5', szLocation: 'live', szClub: 'y' };
    const route = '/afreeca/favorite_list_api.php';
    const checked = await call(route, { ...data, szWork: 'CHECKFAVORITE' });
    const remove = typeof options.active === 'boolean' ? !options.active : Number(checked?.CHANNEL?.RESULT) === -5;
    const result = await call(route, { ...data, szWork: remove ? 'DELFAVORITE' : 'ADDFAVORITE' }, remove ? 'POST' : 'GET');
    if (Number(result?.CHANNEL?.RESULT) !== 1) throw new Error('즐겨찾기를 변경하지 못했습니다.');
    return { active: !remove };
  }
  if (action === 'up' && broadNo) {
    const data = { szBjId: bjId, nBroadNo: String(broadNo), szFileType: 'jsonp' };
    const code = await call('/api/ok_api.php', { ...data, szWork: 'createCode' });
    if (Number(code?.RESULT) !== 1 && String(code?.MSG || '').includes('이미 UP')) return { active: true };
    if (Number(code?.RESULT) !== 1) throw new Error(code?.MSG || 'UP을 보낼 수 없습니다.');
    const result = await call('/api/ok_api.php', { ...data, szWork: 'sendOk', szData: code.MSG, szPlayerType: 'html5' });
    if (Number(result?.RESULT) !== 1 && String(result?.MSG || '').includes('이미 UP')) return { active: true };
    if (Number(result?.RESULT) !== 1) throw new Error(result?.MSG || 'UP을 보낼 수 없습니다.');
    return { active: true };
  }
  throw new Error('요청 오류');
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

  if (quality === 'best') {
    quality = channel.VIEWPRESET?.filter(item => item.name !== 'auto')
      .sort((a, b) => (Number.parseInt(b.label, 10) || 0) - (Number.parseInt(a.label, 10) || 0))[0]?.name || 'hd';
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

export async function getHome(options = {}) {
  const logged = Boolean(options.cookie?.BbsTicket);
  const live = new URL(logged
    ? '/api/myplus/preferbjLiveVodController.php'
    : '/pc/ko_KR/main_popular_list.js', logged ? DOMAIN.live : DOMAIN.static);
  const urls = logged ? [live,
    new URL('/api/myplus/myplusCatchController.php', DOMAIN.live),
    new URL('/api/myplus/myplusCatchStoryController.php', DOMAIN.live),
    new URL('/pc/ko_KR/main_popular_list.js', DOMAIN.static)
  ] : [live];
  const results = await Promise.allSettled(urls.map(url => requestJson(url, options)));
  const result = results[0].status === 'fulfilled' ? results[0].value : null;

  if (Number(result?.RESULT) !== 1) {
    throw new Error('방송 목록을 불러오지 못했습니다.');
  }

  const image = value => {
    if (!value) {
      return '';
    }

    try {
      const url = new URL(value, DOMAIN.soop);

      if (!['http:', 'https:'].includes(url.protocol)) {
        return '';
      }

      url.protocol = 'https:';

      return url.href;
    } catch {
      return '';
    }
  };
  const items = (list, kind) => {
    const seen = new Set();
    const identity = item => String((kind === 'live'
      ? item.user_id : item.original_user_id || item.user_id || item.bj_id) || '');

    return (list || []).filter(item => {
      const key = kind === 'live' ? item.broad_no : item.title_no || item.rep_title_no;

      if (!key || seen.has(key) || kind === 'live' && !identity(item)) {
        return false;
      }

      seen.add(key);

      return true;
    }).map(item => ({
      id: identity(item),
      number: kind === 'live' ? item.broad_no : item.title_no || item.rep_title_no,
      name: item.user_nick || item.original_user_nick || item.bj_nick || '',
      title: item.broad_title || item.title_name || item.title || item.original_user_nick || '',
      image: image(item.broad_thumb || item.thumb || item.thumbnail || ''),
      profile: image(item.profile_img || item.user_profile_img || (identity(item) ? new URL(
        `/LOGO/${identity(item).slice(0, 2)}/${encodeURIComponent(identity(item))}/m/`
        + `${encodeURIComponent(identity(item))}.webp`, DOMAIN.profile
      ).href : '')),
      emblem: image(item.emblem_img_url || ''),
      emblemGrade: item.emblem_grade || '',
      emblemLevel: item.emblem_level || '',
      viewers: Number(item.total_view_cnt || item.view_cnt || 0),
      languages: item.lang_tags || [],
      categories: item.category_tags || [],
      hashtags: item.hash_tags || [],
      tags: [...(item.lang_tags || []), ...(item.category_tags || []), ...(item.hash_tags || [])],
      drops: Boolean(Number(item.is_drops)),
      subtitle: Boolean(item.is_subtitle),
      adult: Number(item.broad_grade || item.grade) >= 19,
      password: item.is_password === 'Y',
      date: item.broad_date || ''
    }));
  };
  const extra = index => results[index]?.status === 'fulfilled'
    && Number(results[index].value?.RESULT) === 1
    ? results[index].value.DATA?.list || [] : [];
  const popular = logged ? results[3]?.status === 'fulfilled' ? results[3].value : null : result;

  return {
    personalized: logged,
    popular: items(Array.isArray(popular?.DATA) ? popular.DATA.flatMap(group => group.DATA || []) : [], 'live')
      .sort((left, right) => right.viewers - left.viewers),
    live: items(logged ? result.DATA.live_list : result.DATA.flatMap(group => group.DATA || []), 'live'),
    vod: items(logged ? result.DATA.vod_list : [], 'vod'),
    catch: items(extra(1), 'catch'),
    story: items(extra(2), 'story')
  };
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

export async function getVodStream(titleNo, options = {}) {
  const result = await getVodContent(titleNo, options);
  const file = result.status === 200 && result.data?.files?.find(item => item.hide !== 'Y' && item.file);
  if (!file) return null;
  const qualities = (file.quality_info || []).filter(item => item.file && item.name !== 'adaptive');
  const selected = qualities.find(item => item.name === 'hd')
    || qualities.sort((left, right) => (Number.parseInt(left.label) || Infinity)
      - (Number.parseInt(right.label) || Infinity))[0];
  const url = new URL(selected?.file || file.file);
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  return {
    url: url.href,
    format: /\.m3u8(?:\?|$)/i.test(url.href) ? 'hls' : 'video',
    headers: { Referer: new URL(`/player/${titleNo}`, DOMAIN.vod).href, 'User-Agent': USER_AGENT }
  };
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
