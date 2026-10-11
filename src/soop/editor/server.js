import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as api from '#soop/http';
import * as control from '#soop/control';
import { DOMAIN } from '#soop/config';
import { Package } from '#soop/package';
import { Network } from '#soop/network';
import { Bridge } from '#soop/bridge';
import { SoopHistory } from '#soop/history';
import * as weflab from '#utils/weflab';
import { proxyScreen } from './proxy.js';
import * as visit from './visit.js';
import { upStatus } from './storage.js';
import * as push from './push.js';
import * as media from './media.js';

const previewsModule = new URL('./previews.js', import.meta.url);
previewsModule.search = new URL(import.meta.url).search;
const { createPreviews } = await import(previewsModule.href);

const launcher = new URL('./launch.js', import.meta.url);
launcher.search = new URL(import.meta.url).search;
const { launchSession } = await import(launcher.href);
const screens = new URL('./screens.js', import.meta.url);
const conversation = new URL('../chat.js', import.meta.url);
const macros = new URL('../macro.js', import.meta.url);
const notifications = new URL('../notify.js', import.meta.url);
const configuration = new URL('../config.js', import.meta.url);
const packages = new URL('../package.js', import.meta.url);
const clients = new URL('../client.js', import.meta.url);
screens.search = conversation.search = macros.search = notifications.search = launcher.search;
configuration.search = packages.search = clients.search = launcher.search;
const updated = await import(configuration.href);
DOMAIN.package = updated.DOMAIN.package;
const { Package: SoopPackage } = await import(packages.href);
const { SoopClient } = await import(clients.href);
const packageMethods = Object.getOwnPropertyDescriptors(SoopPackage.prototype);
delete packageMethods.constructor;
Object.defineProperties(Package.prototype, packageMethods);
Package.available = SoopPackage.available;
const [{ createScreens, screenSession }, { Chat }, { SoopMacro }, { SoopNotify }] = await Promise.all([
  import(screens.href), import(conversation.href), import(macros.href), import(notifications.href)
]);
import { useEnabled } from './usage.js';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/chat.html', ['chat.html', 'text/html']],
  ['/chatwindow.js', ['chatwindow.js', 'text/javascript']],
  ['/search', ['index.html', 'text/html']],
  ['/search/', ['index.html', 'text/html']],
  ['/index.js', ['index.js', 'text/javascript']],
  ['/device.js', ['device.js', 'text/javascript']],
  ['/broadcast.js', ['broadcast.js', 'text/javascript']],
  ['/worker.js', ['worker.js', 'text/javascript']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/app.svg', ['app.svg', 'image/svg+xml']],
  ['/app.png', ['app.png', 'image/png']],
  ['/theme.js', ['theme.js', 'text/javascript']],
  ['/popup.js', ['popup.js', 'text/javascript']],
  ['/identity.js', ['identity.js', 'text/javascript']],
  ['/inbox.js', ['inbox.js', 'text/javascript']],
  ['/search.js', ['search.js', 'text/javascript']],
  ['/scroll.js', ['scroll.js', 'text/javascript']],
  ['/pip.js', ['pip.js', 'text/javascript']],
  ['/subtitle.js', ['subtitle.js', 'text/javascript']],
  ['/quick.js', ['quick.js', 'text/javascript']],
  ['/home.js', ['home.js', 'text/javascript']],
  ['/preview.js', ['preview.js', 'text/javascript']],
  ['/connect.js', ['connect.js', 'text/javascript']],
  ['/config.js', ['../config.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/chat.js', ['chat.js', 'text/javascript']],
  ['/chat.css', ['chat.css', 'text/css']],
  ['/favicon.png', ['favicon.png', 'image/png']],
  ['/ntfy.png', ['ntfy.png', 'image/png']],
  ['/macro.png', ['macro.png', 'image/png']],
  ['/auto.svg', ['auto.svg', 'image/svg+xml']],
  ['/favicon.ico', ['favicon.png', 'image/png']]
]);

const shortcuts = ['!멤버', '!일정'];

function shortcut(config, command) {
  return config.rules.findIndex(rule =>
    (rule.kind || 'command') === 'command' && (rule.action || 'reply') === 'reply'
    && [rule.pattern].flat().includes(command)
  );
}

function describe(id, data) {
  const result = {
    id,
    image: data.profile_image,
    broad: data.broad,
    favorite: data.is_favorite,
    subscribed: data.is_subscription,
    station: {
      user_nick: data.station?.user_nick,
      description: data.station?.display?.profile_text,
      jointime: data.station?.jointime,
      broad_start: data.station?.broad_start,
      total_broad_time: data.station?.total_broad_time,
      upd: data.station?.upd
    },
    subscription: data.subscription
  };

  return result;
}

function snapshot(macro) {
  const source = macro.file
    ? fs.readFileSync(macro.file, 'utf8')
    : JSON.stringify(macro.config);
  const config = JSON.parse(source);
  config.enabled = macro.enabled;
  const revision = crypto.createHash('sha256').update(source).digest('hex');

  return { config, revision };
}

function packs(client) {
  const result = [];

  for (const [index, item] of (client.ogq?.data || []).entries()) {
    const pack = client.findOgq(index);

    if (!pack || !Number.isSafeInteger(pack.max) || pack.max < 1) {
      continue;
    }

    const images = [];

    for (let number = 1; number <= Math.min(pack.max, 200); number++) {
      const url = client.makeOgqUrl(index, number);

      if (url.startsWith('https://')) {
        images.push(url);
      }
    }

    result.push({ id: pack.id, name: item.ogq_title || '', max: pack.max, images });
  }

  return result;
}

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function ceremonies(client) {
  const balloon = client.makeBalloonUrl({ count: 100 });
  const adcon = new URL('/images/mobile/adb.png', DOMAIN.res).href;
  const follow = client.makeGudokUrl(1);
  const result = {
    balloon,
    adcon,
    videoBalloon: new URL('/new_player/items/m_video_balloon.png', DOMAIN.res).href,
    vodBalloon: balloon,
    vodAdcon: adcon,
    stationAdcon: adcon,
    sticker: client.makeStickerUrl(),
    quickview: new URL('/ceremony/quickview.png', DOMAIN.res).href,
    subscription: new URL('/ceremony/basic_subscription.png', DOMAIN.res).href,
    follow,
    followEffect: follow,
    subCeremony: follow,
    challenge: balloon,
    battle: balloon,
    missionSettle: balloon
  };

  if (client.findOgq()) {
    result.ogqGift = client.makeOgqUrl();
  }

  return result;
}

async function body(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > 1048576) {
      throw new Error('설정 용량 초과');
    }

    chunks.push(chunk);
  }

  try {
    const source = Buffer.concat(chunks).toString('utf8');
    const result = JSON.parse(source);

    return result;
  } catch {
    throw new Error('설정 요청 오류');
  }
}

export function createHandler(state) {
  state.root ??= !state.stop;
  const { macro, account, allowed, chat, video, pages, key, origins } = state;
  state.videoEnabled ??= true;
  state.videoStart ??= video.start;
  video.start = () => state.videoEnabled ? state.videoStart() : Promise.resolve();
  const delivery = media.createMedia(state);
  const previewSource = (item, signal) => {
    const options = { ...macro.client.network?.httpOptions, cookie: macro.client.cookie, signal };
    return item.type === 'vod' ? api.getVodStream(item.id, options) : api.getStream(item.id, 'hd', options);
  };
  state.previews = createPreviews(previewSource, state.previews?.streams);
  const previews = state.previews;
  chat.basicAccount = state.basicAccount || account?.()?.userId || '';
  const upgrade = (target, source) => {
    const descriptors = Object.getOwnPropertyDescriptors(source.prototype);
    delete descriptors.constructor;
    Object.defineProperties(target, descriptors);
  };
  upgrade(macro.client, SoopClient);
  if (macro.client.network) upgrade(macro.client.network, Network);
  if (macro.client.bridge) upgrade(macro.client.bridge, Bridge);
  if (macro.client.package) upgrade(macro.client.package, SoopPackage);
  if (macro.history) upgrade(macro.history, SoopHistory);
  upgrade(chat, Chat);
  chat.watchViewer();
  if (chat.state().connected) {
    void chat.kicks().catch(() => {});
  }
  if (!state.accountUsage) {
    const enabled = 'enabled' in macro ? macro.enabled : macro.config.enabled;
    if (macro.file) useEnabled(macro.client, macro.file, macro.config.enabled, enabled);
    const notify = macro.client.notify;
    for (const current of notify?.state.clients || []) {
      if (current.file) {
        const enabled = 'enabled' in current ? current.enabled : current.state.config.enabled;
        useEnabled(current.client, current.file, current.state.config.enabled, enabled);
      }
      upgrade(current, SoopNotify);
      current.bind();
    }
    upgrade(macro, SoopMacro);
    state.accountUsage = true;
    if (macro.file) macro.load();
  } else {
    upgrade(macro, SoopMacro);
    for (const notify of macro.client.notify?.state.clients || []) {
      upgrade(notify, SoopNotify);
      notify.bind();
    }
  }

  chat.client.off('userExtend', chat.events.get('userExtend'));
  chat.on('userExtend', data => chat.extend(data));
  if (!state.accounts) {
    state.accounts = new Map();
  }
  const configuredAccount = account?.() || {};
  if (!macro.client.signedout && configuredAccount.userId && !state.accounts.has(configuredAccount.userId)) {
    state.accounts.set(configuredAccount.userId, {
      id: configuredAccount.userId, name: configuredAccount.userId, configured: true
    });
  }

  const remember = (cookie = macro.client.cookie, info = macro.client.info) => {
    const id = info?.LOGIN_ID;

    if (!cookie || info?.IS_LOGIN !== 1 || !id) {
      return;
    }

    state.accounts.set(id, {
      ...state.accounts.get(id), id, name: info.LOGIN_NICK || id, cookie, info
    });
  };
  remember();
  state.logins ||= new Map();
  const authenticate = async (login, options) => {
    for (const [key, value] of state.logins) {
      if (value.expires <= Date.now()) state.logins.delete(key);
    }
    let result, id, firstCookie;
    if (login?.challenge) {
      const pending = state.logins.get(login.challenge);
      if (!pending || typeof login.second !== 'string' || !login.second) {
        throw new Error('로그인을 다시 진행해주세요.');
      }
      id = pending.id;
      firstCookie = pending.cookie;
      result = await api.secondLogin(id, login.second, { ...options, cookie: firstCookie });
      if (result?.data?.RESULT !== 1) {
        if (++pending.attempts >= 5) state.logins.delete(login.challenge);
        throw new Error('2차 비밀번호를 확인해주세요.');
      }
      state.logins.delete(login.challenge);
    }
    else {
      id = login?.id || login?.userId;
      if (typeof id !== 'string' || !id.trim() || typeof login?.password !== 'string' || !login.password) {
        throw new Error('아이디와 비밀번호를 입력해주세요.');
      }
      id = id.trim();
      result = await api.login(id, login.password, options);
      if (result?.data?.RESULT === -11) {
        firstCookie = result.cookie;
        const second = login.second || login.secondPw;
        if (second) {
          result = await api.secondLogin(id, second, { ...options, cookie: firstCookie });
        }
        else {
          const challenge = crypto.randomBytes(32).toString('hex');
          if (state.logins.size >= 32) state.logins.delete(state.logins.keys().next().value);
          state.logins.set(challenge, { id, cookie: firstCookie, expires: Date.now() + 180000, attempts: 0 });
          return { second: true, challenge };
        }
      }
    }
    if (result?.data?.RESULT !== 1) {
      throw new Error('로그인에 실패했습니다. 계정 정보를 확인해주세요.');
    }
    const cookie = { ...firstCookie, ...result.cookie };
    const info = await api.getPrivateInfo({ ...options, cookie });
    if (info?.IS_LOGIN !== 1) throw new Error('로그인 상태를 확인할 수 없습니다.');
    return { cookie, info };
  };
  const client = macro.client;
  if (client.cookie && !client.signedout && !client.info) {
    const cookie = api.cookieString(client.cookie);
    const saved = [...state.accounts.values()].find(value => api.cookieString(value.cookie) === cookie);
    const restore = info => {
      if (api.cookieString(client.cookie) !== cookie || client.signedout || client.info) return;
      if (info?.IS_LOGIN === 1) client.info = info;
      else {
        client.cookie = undefined;
        client.info = null;
        client.signedout = true;
        if (saved) {
          saved.cookie = undefined;
          saved.info = null;
        }
      }
      remember();
      chat.broadcast('state', chat.state());
    };
    if (saved?.info) restore(saved.info);
    else {
      void api.getPrivateInfo({ ...client.network?.httpOptions, cookie: client.cookie })
        .then(restore).catch(() => {});
    }
  }
  if (state.screens) {
    state.screens.close();
    state.screens = createScreens(state);
  }

  const stickers = async () => {
    const options = { ...macro.client.network?.httpOptions };
    const user = macro.client.signedout ? {} : account?.() || {};
    let current = macro.client.cookie;

    if (!api.cookieString(current)) {
      current = user.cookie;
    }

    if (api.cookieString(current)) {
      options.cookie = current;
    }
    else {
      const identity = crypto
        .createHash('sha256')
        .update(JSON.stringify([user.userId, user.password, user.secondPw]))
        .digest('hex');

      if (state.attempted !== identity) {
        state.attempted = identity;
        state.cookie = null;

        if (user.userId && user.password) {
          let result = await api.login(user.userId, user.password, options);

          if (result?.data?.RESULT === -11 && user.secondPw) {
            result = await api.secondLogin(user.userId, user.secondPw, {
              ...options,
              cookie: result.cookie
            });
          }

          if (result?.data?.RESULT === 1 && !macro.client.signedout) {
            state.cookie = result.cookie;
          }
        }
      }

      options.cookie = state.cookie;
    }

    return api.postOgqList(macro.client.bjId, options);
  };

  const refresh = () => {
    if (!macro.client.bjId) {
      return Promise.resolve();
    }

    if (state.assets) {
      return state.assets;
    }

    if (state.loaded && Date.now() - state.loaded < 30000) {
      return Promise.resolve();
    }

    state.loaded = Date.now();

    const bjId = macro.client.bjId;
    const currentCookie = api.cookieString(macro.client.cookie);
    const account = macro.client.info?.LOGIN_ID;

    const options = { ...macro.client.network?.httpOptions, cookie: macro.client.cookie };

    state.assets = Promise.allSettled([
      api.getStation(bjId, options),
      stickers(),
      api.getEmoticon(options),
      api.getSignature(bjId, options),
      api.getStatus(bjId, options),
      api.getDashboard(bjId, options),
      api.getUpStatus(bjId, macro.client.channel?.BNO, options)
    ])
      .then(([station, ogq, emoticon, signature, status, dashboard, up]) => {
        if (
          macro.closed
          || macro.client.bjId !== bjId
          || api.cookieString(macro.client.cookie) !== currentCookie
        ) {
          state.loaded = 0;

          return;
        }

        if (station.status === 'fulfilled' && station.value) {
          const data = station.value;

          state.profile = describe(bjId, data);
          const completed = up.status === 'fulfilled' && up.value === true;
          const stored = upStatus(account, bjId);
          state.profile.up = stored === null && completed ? upStatus(account, bjId, true) : stored;
          macro.client.bjNick = data.station?.user_nick || macro.client.bjNick;
        }

        if (state.profile?.id === bjId && status.status === 'fulfilled') {
          state.profile.status = status.value?.DATA;
        }

        if (state.profile?.id === bjId && dashboard.status === 'fulfilled') {
          state.profile.dashboard = dashboard.value;
        }

        if (ogq.status === 'fulfilled' && Array.isArray(ogq.value?.data)) {
          macro.client.ogq = ogq.value;
        }

        if (
          emoticon.status === 'fulfilled'
          && emoticon.value
          && macro.client.mapEmoticon
        ) {
          const custom = signature.status === 'fulfilled' ? signature.value : [];

          macro.client.emoticon = macro.client.mapEmoticon(emoticon.value, custom);
        }
      })
      .finally(() => {
        state.assets = null;
      });

    return state.assets;
  };

  const reset = async (cookie, info) => {
    const client = macro.client;
    if ((await control.multiStatus(client)).running) {
      await control.stopMulti(client);
    }
    await video.reset();
    macro.generation++;

    const pending = client.connecting;

    await client.disconnect(false);
    await pending?.catch(() => {});
    client.stopLive();
    client.stopContent();
    client.broadPw = '';
    client.cookie = cookie || undefined;
    client.info = info || null;
    client.signedout = !cookie;
    client.userId = null;
    client.userFlag = null;
    client.userList?.clear();
    client.channel = null;
    client.auth = null;
    client.notice = null;
    client.rule = null;
    client.poll = null;
    client.iceMode = null;
    client.broadcast = {};
    state.cookie = null;
    state.profile = null;
    state.loaded = 0;
    chat.users.clear();
    chat.kicked.clear();
    chat.flag = null;
    chat.slow = 0;
    chat.frozen = false;
    chat.poll = null;
  };

  if (state.broadcastEnd) client.off('broadcastEnd', state.broadcastEnd);
  state.broadcastEnd = () => {
    if (client.auto || state.switching) return;
    state.switching = true;
    void Promise.resolve().then(async () => {
      await reset(client.cookie, client.info);
      client.bjId = '';
      macro.select();
      state.screens?.list();
      chat.broadcast('ended', {});
      if (state.stop) await state.stop();
    }).catch(error => client.emit('error', error)).finally(() => {
      state.switching = false;
    });
  };
  client.on('broadcastEnd', state.broadcastEnd);

  return (request, response) => {
    const day = String(Math.floor((Date.now() + 9 * 3600000) / 86400000));
    const signature = crypto.createHmac('sha256', state.accessHash).update(day).digest('hex');
    const verified = !state.accessPassword || request.headers.cookie?.split(';').some(value => {
      const cookie = value.trim();
      if (!cookie.startsWith('soop-access=')) return false;
      const stamp = cookie.slice('soop-access='.length).split('.')[0];
      const current = stamp === day;
      const time = /^t\d+$/.test(stamp) ? Number(stamp.slice(1)) : NaN;
      if (!current && !(time <= Date.now() && Date.now() - time < 86400000)) return false;
      const hash = crypto.createHmac('sha256', state.accessHash).update(stamp).digest('hex');
      const expected = `soop-access=${stamp}.${hash}`;
      return Buffer.byteLength(cookie) === Buffer.byteLength(expected)
        && crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
    });
    const home = Number(new URL(state.origin).port) === state.range?.start
      && (!request.headers['x-soop-screen'] || request.headers['x-soop-screen'] === '0');
    const password = home ? state.accessPassword : state.password;
    const passwordHash = home ? state.accessHash : state.passwordHash;
    const attempts = home ? state.accessAttempts : state.attempts;
    const token = home ? state.accessToken : state.token;

    const address = new URL(request.url, state.origin);
    const direct = Boolean(process.env.WEBORIGIN
      && visit.visitDetails(request).address.startsWith(`${new URL(process.env.WEBORIGIN).origin}/`));
    if (address.pathname === '/api/editor') void visit.notifyVisit(request, false).catch(() => {});
    if (verified && state.accessPassword) {
      const stamp = `t${Date.now()}`;
      const hash = crypto.createHmac('sha256', state.accessHash).update(stamp).digest('hex');
      const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https';
      response.setHeader('Set-Cookie', `soop-access=${stamp}.${hash}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}`);
    }
    if (address.pathname === '/' && !home && !request.headers['x-soop-screen'] && state.range) {
      const root = new URL(state.origin);
      root.port = String(state.range.start);
      root.pathname = `/${Number(new URL(state.origin).port) - state.range.start + 1}/`;
      root.search = address.search;
      response.writeHead(307, { Location: root.href });
      response.end();
      return;
    }
    const pathname = address.pathname.replace(/^\/\d+(?=\/)/, '');
    const signed = delivery.verify(address);
    if ((pathname.startsWith('/media/') || pathname === '/api/chat') && address.pathname !== pathname
      && proxyScreen(request, response, state)) return;
    const directChat = pathname === '/api/chat' && (request.method === 'OPTIONS'
      || request.headers.authorization === `Bearer ${token}`);
    if (!verified && !signed && !directChat && (pathname.startsWith('/media/') || pathname.startsWith('/api/')
      && !['/api/gate', '/api/entry', '/api/access'].includes(pathname))) {
      reply(response, 401, { error: '접속 비밀번호를 확인해주세요.' });
      return;
    }
    if (address.pathname === '/0' || address.pathname === '/0/') {
      response.writeHead(307, { Location: `/${address.search}` });
      response.end();
      return;
    }

    if (proxyScreen(request, response, state)) {
      return;
    }

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' https: data:",
        `connect-src 'self'${delivery.origin ? ` ${delivery.origin}` : ''}`,
        `media-src 'self' blob:${delivery.origin ? ` ${delivery.origin}` : ''}`,
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'"
      ].join('; ')
    );

    void Promise.resolve()
      .then(async () => {
        const hosts = [...allowed].map(value => new URL(value).host);

        if (!hosts.includes(request.headers.host)) {
          reply(response, 403, { error: '주소 오류' });

          return;
        }

        if (request.headers.origin && !allowed.has(request.headers.origin)) {
          reply(response, 403, { error: '주소 오류' });

          return;
        }

        const chatRequest = /^\/api\/chat(?:\?|$)/.test(request.url);
        if ((request.url.startsWith('/media/') || chatRequest) && request.method === 'OPTIONS') {
          response.writeHead(204, {
            'Access-Control-Allow-Origin': request.headers.origin || state.origin,
            'Access-Control-Allow-Methods': chatRequest ? 'GET, POST, OPTIONS' : 'GET, OPTIONS',
            'Access-Control-Allow-Headers': chatRequest ? 'Authorization, Content-Type' : 'Range',
            Vary: 'Origin'
          });
          response.end();
          return;
        }

        if (request.method === 'GET' && request.url.startsWith('/media/')) {
          const authenticated = signed || request.headers.authorization === `Bearer ${token}`
            || request.headers.cookie?.split(';').some(value =>
              value.trim() === `soop-editor=${token}`
            );

          if (!authenticated) {
            reply(response, 401, { error: '사이트를 다시 열어주세요' });

            return;
          }

          if (macro.closed) {
            reply(response, 410, { error: '프로그램 종료 됨' });

            return;
          }

          if (request.headers.origin) {
            response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
            response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
            response.setHeader('Vary', 'Origin');
          }
          const link = signed ? delivery.url : value => value;
          if (request.url.startsWith('/media/preview/')) await previews.send(request, response, link);
          else if (!state.videoEnabled) reply(response, 410, { error: '영상이 꺼져 있습니다.' });
          else await video.send(request, response, link);

          return;
        }

        if (request.method === 'GET' && request.url === '/hls.js') {
          const content = fs.readFileSync(new URL(import.meta.resolve('hls.js')));

          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          response.end(content);

          return;
        }

        const pathname = new URL(request.url, state.origin).pathname;

        if (request.method === 'GET' && /^\/ogq\/[\w-]+\/[1-9]\d*(?:_\d+)?\.(png|webp)$/.test(pathname)
          && pathname.length <= 200) {
          const sticker = await fetch(new URL(pathname.replace('/ogq/', '/sticker/'), DOMAIN.ogq), {
            redirect: 'error', signal: AbortSignal.timeout(10000)
          });
          const type = sticker.headers.get('content-type')?.split(';')[0];
          if (!sticker.ok || !['image/png', 'image/webp'].includes(type)
            || Number(sticker.headers.get('content-length')) > 2097152) {
            await sticker.body?.cancel();
            reply(response, 404, { error: '이미지를 불러오지 못했습니다.' });
            return;
          }
          const content = Buffer.from(await sticker.arrayBuffer());
          if (content.length > 2097152) {
            reply(response, 413, { error: '이미지 크기 초과' });
            return;
          }
          response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
          response.end(content);
          return;
        }

        const asset = files.get(pathname);

        if (request.method === 'GET' && asset) {
          const content = fs.readFileSync(
            new URL(`./${asset[0]}`, import.meta.url)
          );

          if (asset[0] === 'worker.js') {
            response.setHeader('Service-Worker-Allowed', '/');
          }

          response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
          response.end(content);

          if (asset[1] === 'text/html') void visit.notifyVisit(request);

          return;
        }

        const address = new URL(request.url, state.origin);

        if (address.pathname === '/api/gate' && request.method === 'GET' && home) {
          reply(response, 200, { password: !verified, ...(verified && { token }) });
          return;
        }

        if (address.pathname === '/api/entry' && request.method === 'GET') {
          const authenticated = verified && (home || request.headers.authorization === `Bearer ${token}`);
          reply(response, 200, {
            password: Boolean(password) && !authenticated,
            leavePassword: Boolean(state.password),
            fixed: Boolean(state.fixed),
            ...(verified && !home && { profile: {
              name: macro.client.bjNick || state.profile?.station?.user_nick || macro.client.bjId || '',
              image: (state.profile?.id === macro.client.bjId ? state.profile.image : '')
                || (macro.client.bjId ? new URL(
                  `/LOGO/${macro.client.bjId.slice(0, 2)}/${encodeURIComponent(macro.client.bjId)}/m/${encodeURIComponent(macro.client.bjId)}.webp`, DOMAIN.profile
                ).href : '')
            } }),
            ...((!password || authenticated) && verified && { token })
          });
          return;
        }

        if (address.pathname === '/api/access' || address.pathname === '/api/leave') {
          const leaving = address.pathname === '/api/leave';
          if (!home && !verified) {
            reply(response, 401, { error: '접속 비밀번호를 확인해주세요.' });
            return;
          }
          response.setHeader('Cache-Control', 'no-store');

          if (request.method !== 'POST') {
            reply(response, 405, { error: '요청 방식 오류' });

            return;
          }

          if (leaving && (home || request.headers.authorization !== `Bearer ${token}`)) {
            reply(response, 401, { error: '사이트를 다시 열어주세요' });
            return;
          }

          if (!password && !leaving) {
            reply(response, 403, { error: '비밀번호가 설정되지 않았습니다.' });

            return;
          }

          if (password) {
            const now = Date.now();

            for (const [key, value] of attempts) {
              if (now >= value.until) {
                attempts.delete(key);
              }
            }

            const key = request.socket.remoteAddress;
            const attempt = attempts.get(key) || { count: 0, until: now + 60000 };

            if (attempt.count >= 5 || !attempts.has(key) && attempts.size >= 1024) {
              response.setHeader('Retry-After', '60');
              reply(response, 429, { error: '잠시 후 다시 시도해주세요.' });

              return;
            }

            attempt.count++;
            attempts.set(key, attempt);
            const data = await body(request);
            const hash = crypto.createHash('sha256')
              .update(typeof data?.password === 'string' ? data.password : '')
              .digest();

            if (!crypto.timingSafeEqual(passwordHash, hash)) {
              reply(response, 401, { error: '비밀번호가 일치하지 않습니다.' });

              return;
            }

            attempts.delete(key);
          }

          if (leaving) {
            if (state.fixed) throw new Error('기본 연결은 삭제할 수 없습니다.');
            if (state.switching || state.signing) {
              throw new Error('잠시 후 다시 시도해주세요.');
            }

            state.switching = true;
            try {
              await reset(macro.client.cookie, macro.client.info);
              macro.client.bjId = '';
              macro.select();
              chat.broadcast('state', chat.state());
              state.screens?.list();
              if (state.stop) {
                response.once('finish', () => { setTimeout(() => state.stop(), 100); });
              }
              reply(response, 200, {});
            } finally {
              state.switching = false;
            }
            return;
          }
          if (home) {
            const expires = new Date((Number(day) + 1) * 86400000 - 9 * 3600000);
            const secure = request.socket.encrypted || [...allowed].some(value => {
              const url = new URL(value);
              return url.host === request.headers.host && url.protocol === 'https:';
            });
            response.setHeader('Set-Cookie', `soop-access=${day}.${signature}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`);
          }
          reply(response, 200, { token });

          return;
        }

        const routes = [
          '/api/search',
          '/api/home',
          '/api/connect',
          '/api/session',
          '/api/screens',
          '/api/config',
          '/api/macro',
          '/api/editor',
          '/api/account',
          '/api/stream',
          '/api/preview',
          '/api/chat',
          '/api/multi',
          '/api/notify',
          '/api/push',
          '/api/broadcast',
          '/api/inbox',
          '/api/logs',
          '/api/kicks',
          '/api/members',
          '/api/station',
          '/api/roulette',
          '/api/poll',
          '/api/reaction',
          '/api/user'
        ];

        if (!routes.includes(address.pathname)) {
          reply(response, 404, { error: '화면 없음' });

          return;
        }

        if (request.headers.authorization !== `Bearer ${token}`) {
          reply(response, 401, { error: '사이트를 다시 열어주세요' });

          return;
        }

        const secure = [...allowed].some(value => {
          const address = new URL(value);

          return address.host === request.headers.host && address.protocol === 'https:';
        });
        const session = `soop-editor=${token}; Path=/; HttpOnly; SameSite=Strict`;

        response.setHeader('Set-Cookie', session + (secure ? '; Secure' : ''));

        if (request.url === '/api/editor') {
          if (
            request.method === 'GET'
            && request.headers.accept === 'text/event-stream'
          ) {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write(': open\n\n');
            response.write(`event: style\ndata: ${JSON.stringify([...(state.styles || [])])}\n\n`);
            pages.set(response, request.headers.host);

            if (request.headers.host === new URL(state.origin).host) {
              state.seen = Date.now();
            }

            const timer = setInterval(() => response.write(': alive\n\n'), 15000);

            timer.unref();
            response.once('close', () => {
              clearInterval(timer);
              pages.delete(response);
            });

            return;
          }

          const status = request.method === 'GET' ? 200 : 405;

          const count = [...pages.values()].filter(host => host === request.headers.host).length;

          reply(response, status, { key, pages: count });

          return;
        }

        if (macro.closed) {
          reply(response, 410, { error: '프로그램 종료 됨' });

          return;
        }

        if (address.pathname === '/api/home') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const client = macro.client;
          const cookie = client.cookie;
          const data = await api.getHome({ ...client.network.httpOptions, cookie });

          if (client.cookie !== cookie) {
            throw new Error('로그인 상태가 변경되었습니다. 다시 불러와주세요.');
          }

          reply(response, 200, {
            ...data,
            name: client.info?.IS_LOGIN === 1 ? client.info.LOGIN_NICK || '' : ''
          });

          return;
        }

        if (address.pathname === '/api/search') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const query = address.searchParams.get('query') || '';
          const page = Number(address.searchParams.get('page') || 1);
          const type = address.searchParams.get('type') || 'all';
          const options = {
            ...macro.client.network?.httpOptions,
            cookie: macro.client.cookie,
            signal: AbortSignal.timeout(10000)
          };
          const data = type === 'suggest'
            ? await api.searchStreamers(query, page, options)
            : await api.searchContents(query, page, type, options);

          reply(response, 200, data);

          return;
        }

        if (address.pathname === '/api/screens' && request.method === 'GET') {
          reply(response, 200, { items: state.screens.list() });

          return;
        }

        if (address.pathname === '/api/session' && request.method === 'DELETE') {
          const data = await body(request);
          const item = state.accounts.get(data.id);
          if (!item || item.configured || data.id === (state.basicAccount || account?.()?.userId)) throw new Error('기본 계정은 로그아웃할 수 없습니다.');
          if (state.signing || state.switching) throw new Error('잠시 후 다시 시도해주세요.');
          state.signing = true;
          try {
            if (macro.client.info?.LOGIN_ID === data.id) {
              macro.client.signedout = true;
              state.cookie = null;
              state.attempted = undefined;
              await macro.client.logout();
              chat.broadcast('state', chat.state());
            }
            state.accounts.delete(data.id);
            state.screens?.list();
            reply(response, 200, {});
          } finally { state.signing = false; }
          return;
        }

        if (address.pathname === '/api/session' && request.method === 'GET') {
          remember();
          const accounts = await Promise.all([...state.accounts.values()].map(async item => {
            if (!item.image) {
              try {
                item.image = (await api.getStation(item.id))?.profile_image || '';
              } catch {}
            }

            const image = item.image?.startsWith('//') ? `https:${item.image}` : item.image || '';

            return { id: item.id, name: item.name, image, configured: Boolean(item.configured || item.id === (state.basicAccount || account?.()?.userId)) };
          }));

          reply(response, 200, { accounts, count: state.count, auto: Boolean(macro.client.auto), fixed: Boolean(state.fixed), password: Boolean(state.password), screens: state.screens?.list() || [] });

          return;
        }

        if (address.pathname === '/api/connect') {
          if (request.method !== 'POST') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const data = await body(request);
          const client = macro.client;

          if (data.mode === 'switch' && state.fixed && (data.number === undefined
            || data.number === Number(new URL(state.origin).port) - state.range.start + 1)) throw new Error('기본 연결은 전환할 수 없습니다.');
          if (data.auto !== undefined && typeof data.auto !== 'boolean') throw new Error('자동 연결 설정 오류');
          if (data.scheduled && (!Number.isSafeInteger(data.scheduled) || data.scheduled <= Date.now()
            || data.scheduled - Date.now() > 2147483647)) throw new Error('예약 시간을 확인해주세요.');
          if (data.number !== undefined && (!Number.isInteger(data.number) || data.mode !== 'switch')) throw new Error('연결 번호를 확인해주세요.');
          if (data.mode === 'switch' && (data.number === undefined || data.number === Number(new URL(state.origin).port) - state.range.start + 1) && state.password) {
            const key = request.socket.remoteAddress;
            const now = Date.now();
            const previous = state.attempts.get(key);
            const attempt = previous && previous.until > now ? previous : { count: 0, until: now + 60000 };
            if (attempt.count >= 5) throw new Error('잠시 후 다시 시도해주세요.');
            attempt.count++;
            state.attempts.set(key, attempt);
            const hash = crypto.createHash('sha256').update(typeof data.password === 'string' ? data.password : '').digest();
            if (!crypto.timingSafeEqual(state.passwordHash, hash)) throw new Error('비밀번호가 일치하지 않습니다.');
            state.attempts.delete(key);
          }
          let transferred;
          if (data.session) {
            const source = screenSession(state, Number(request.headers['x-soop-source']));
            if (request.headers['x-soop-source-token'] !== source.token) throw new Error('연결 전환 권한이 없습니다.');
            transferred = data.session;
          }

          if (data.id !== undefined && (typeof data.id !== 'string' || !/^[a-zA-Z0-9_]{0,50}$/.test(data.id))) {
            throw new Error('스트리머 아이디 오류');
          }

          if (!['existing', 'new', 'guest'].includes(data.account) || !['switch', 'new', 'login'].includes(data.mode)
            || data.mode === 'login' && data.account !== 'new') {
            throw new Error('열기 설정 오류');
          }

          if (data.access !== undefined && (typeof data.access !== 'string' || data.access.length > 128)) {
            throw new Error('접속 비밀번호 오류');
          }

          if (state.switching || state.signing) {
            throw new Error('방송 전환 중입니다.');
          }

          state.switching = true;

          try {
            remember();
            const station = data.id ? await api.getStation(data.id) : null;

            if (data.id && !station?.station) {
              throw new Error('스트리머를 찾을 수 없습니다.');
            }

            const options = { ...client.network?.httpOptions };
            const configured = client.signedout ? {} : account?.() || {};
            let cookie = client.cookie || state.cookie || configured.cookie;
            let info = client.info;
            let login = !cookie ? configured : null;

            if (data.account === 'existing' && data.identity) {
              const selected = state.accounts.get(data.identity);

              if (!selected) {
                throw new Error('계정을 다시 선택해주세요.');
              }

              cookie = selected.cookie;
              info = selected.info;
              login = !cookie && selected.configured ? account?.() : null;
            }

            if (data.account === 'guest') {
              cookie = null;
              info = null;
              login = null;
            }

            if (data.account === 'new') {
              login = data.login;
            }

            if (transferred) {
              cookie = transferred.cookie;
              info = transferred.info;
              login = null;
            }

            if (data.account === 'new' || login?.userId) {
              const result = await authenticate(login, options);
              if (result.second) {
                reply(response, 200, result);
                return;
              }
              cookie = result.cookie;
              info = result.info;
            }
            else if (cookie && info?.IS_LOGIN !== 1) {
              info = await api.getPrivateInfo({ ...options, cookie });

              if (info?.IS_LOGIN !== 1) {
                throw new Error('로그인이 만료되었습니다. 새 계정으로 로그인해주세요.');
              }
            }

            remember(cookie, info);

            if (data.mode === 'login') {
              reply(response, 200, { identity: info.LOGIN_ID });
              return;
            }

            if (data.number !== undefined && data.number !== Number(new URL(state.origin).port) - state.range.start + 1) {
              const screen = screenSession(state, data.number);
              if (screen.fixed) throw new Error('기본 연결은 전환할 수 없습니다.');
              const origin = new URL(state.origin);
              origin.port = String(screen.port);
              const forwarded = await fetch(new URL('/api/connect', origin), {
                method: 'POST',
                headers: { Authorization: `Bearer ${screen.token}`, 'Content-Type': 'application/json',
                  Cookie: request.headers.cookie || '',
                  'x-soop-screen': String(data.number),
                  'x-soop-source': String(Number(new URL(state.origin).port) - state.range.start + 1),
                  'x-soop-source-token': state.token },
                body: JSON.stringify({ id: data.id, account: 'guest', mode: 'switch', auto: data.auto,
                  scheduled: data.scheduled,
                  password: data.password, session: { cookie: cookie || null, info: info || null } }),
                signal: AbortSignal.timeout(60000)
              });
              const result = await forwarded.json();
              if (!forwarded.ok) throw new Error(result.error || '연결을 전환할 수 없습니다.');
              reply(response, 200, { number: data.number, token: screen.token });
              return;
            }

            if (data.mode === 'new') {
              const launched = await launchSession({
                bjId: data.id || '', cookie: cookie || null, info: info || null, auto: data.auto ?? client.auto,
                scheduled: data.scheduled || 0,
                userId: '', password: '', secondPw: '', broadPw: '', editor: true,
                basicAccount: state.basicAccount || account?.()?.userId || '',
                screenPw: data.account === 'guest' ? '' : data.access || '',
                origins: origins.length ? origins : [state.origin]
              }, Number(new URL(state.origin).port), state.range, state.host || '127.0.0.1');

              reply(response, 200, { port: launched.port, number: launched.number, token: launched.token });

              return;
            }

            if (data.id !== undefined || data.account !== 'existing' || cookie !== client.cookie) {
              await reset(cookie, info);
              client.auto = data.auto ?? client.auto;
              client.scheduled = data.scheduled || 0;

              try {
                const id = data.id ?? client.bjId;

                if (id) {
                  await client.connect(id);
                }
                else {
                  client.bjId = '';
                }
              } finally {
                void video.start();

                if (client.auto && !client.closed) {
                  client.startLive();
                }

                chat.broadcast('state', chat.state());
              }
            }

            state.sessionReady = true;
            state.loaded = 0;
            chat.broadcast('state', chat.state());
            reply(response, 200, { player: client.bjId, state: chat.state() });
          } finally {
            state.switching = false;
          }

          return;
        }

        if (address.pathname === '/api/station') {
          const type = address.searchParams.get('type') || 'fans';
          const category = address.searchParams.get('category') || 'all';
          const page = Number(address.searchParams.get('page') || 1);
          const board = address.searchParams.get('board') || '';
          const id = address.searchParams.get('id') || macro.client.bjId;

          if (
            request.method !== 'GET'
            || !['fans', 'subscribers', 'vod', 'board'].includes(type)
            || !['all', 'review', 'clip', 'catch', 'normal'].includes(category)
            || !Number.isInteger(page) || page < 1 || page > 100000
            || !/^\d{0,12}$/.test(board)
            || !/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')
          ) {
            reply(response, 400, { error: '목록 요청 오류' });

            return;
          }

          if (!id) {
            throw new Error('스트리머 설정을 확인해주세요');
          }

          const options = {
            ...macro.client.network?.httpOptions,
            cookie: macro.client.cookie,
            signal: AbortSignal.timeout(10000)
          };
          const menu = page === 1 ? await api.getChannel(id, 'menu', options) : null;
          let entries;
          let total;
          let more = false;

          if (type === 'fans' || type === 'subscribers') {
            const path = type === 'fans' ? 'topfans/detail' : 'subscribe-acc/detail';
            const data = await api.getChannel(id, path, options);

            if (!Array.isArray(data)) {
              throw new Error('팬 목록을 불러오지 못했습니다');
            }

            entries = data.map((user, index) => ({
              id: user.userId,
              name: user.userNick,
              image: user.profileImage,
              rank: index + 1,
              month: user.accPaymentCount
            }));
            total = entries.length;
          }
          else if (type === 'vod') {
            const data = await api.getVod(id, `${category}?page=${page}`, options);

            if (!Array.isArray(data?.contents)) {
              throw new Error('VOD 목록을 불러오지 못했습니다');
            }

            entries = data.contents.map(item => ({
              id: item.titleNo,
              title: item.titleName,
              image: item.ucc?.thumb,
              author: item.userNick,
              date: item.regDate,
              views: item.count?.vodReadCnt ?? item.count?.readCnt ?? 0
            }));
            total = data.meta?.totalItems;
            more = page < data.meta?.totalPages;
          }
          else {
            const params = new URLSearchParams({ bbsNo: board, page, perPage: 20 });
            const data = await api.getChannel(id, `board?${params}`, options);

            if (!Array.isArray(data?.contents)) {
              throw new Error('게시판 목록을 불러오지 못했습니다');
            }

            entries = data.contents.filter(item => !item.ucc).map(item => ({
              id: item.titleNo,
              title: item.titleName,
              author: item.userNick,
              date: item.regDate,
              views: item.count?.readCnt ?? 0
            }));
            total = data.meta?.totalItems;
            more = page < data.meta?.totalPages;
          }

          reply(response, 200, {
            id,
            entries,
            total,
            next: more ? page + 1 : null,
            boards: menu?.board?.filter(item => item.displayType !== 106 && item.name)
              .map(item => ({ id: item.bbsNo, name: item.name }))
          });

          return;
        }

        if (address.pathname === '/api/members') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const data = chat.members(
            address.searchParams.get('query') || '',
            address.searchParams.get('cursor') || ''
          );

          for (const user of data.entries) {
            if (user.role === '스트리머' && state.profile?.id === macro.client.bjId) {
              user.name = macro.client.bjNick || state.profile.station?.user_nick || user.name;
              user.image = state.profile.image;
            }
          }

          reply(response, 200, data);

          return;
        }

        if (address.pathname === '/api/roulette') {
          if (request.method !== 'POST') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const rule = await body(request);

          if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
            throw new Error('룰렛 설정 오류');
          }

          if (rule.default === undefined) {
            reply(response, 200, { message: '' });

            return;
          }

          const count = Number(rule.default);

          if (!Number.isSafeInteger(count) || count < 1) {
            throw new Error('룰렛 설정 오류');
          }

          const index =
            typeof rule.index === 'object'
              ? (rule.index?.[count] ?? 0)
              : (rule.index ?? 0);
          const numbers = rule.numbers || [];
          const title = rule.title || '';
          const invalid =
            !Number.isSafeInteger(index)
            || index < 0
            || !Array.isArray(numbers)
            || numbers.flat().some(value => !Number.isSafeInteger(value) || value < 1)
            || typeof title !== 'string';

          if (invalid) {
            throw new Error('룰렛 설정 오류');
          }

          let user;

          if (typeof macro.options.weflab === 'function') {
            user = macro.options.weflab();
          }
          else {
            user = macro.options.weflab;
          }

          if (!user) {
            throw new Error('WEFLAB 설정 없음');
          }

          const roulette = await weflab.roulette(user, count, index);
          const message = weflab.format(roulette, count, numbers, title);

          reply(response, 200, { message });

          return;
        }

        if (address.pathname === '/api/kicks') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const list = await chat.kicks();

          reply(response, 200, list.map(entry => ({
            ...entry,
            user: chat.user({ userId: entry.userId, userNick: entry.userNick }),
            admin: chat.user({
              userId: entry.adminId,
              userNick: entry.adminNick,
              userFlag: entry.flag
            })
          })));

          return;
        }

        if (address.pathname === '/api/macro') {
          if (!['GET', 'PUT'].includes(request.method)) {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const data = request.method === 'PUT'
            ? await body(request) : Object.fromEntries(address.searchParams);

          if (state.switching || data.player !== macro.client.bjId) {
            throw new Error('방송이 변경되었습니다.');
          }

          if (!chat.state().manager) {
            throw new Error('매니저 권한 필요');
          }

          const current = snapshot(macro);
          const index = shortcuts.includes(data.command)
            ? shortcut(current.config, data.command) : -1;

          if (index < 0) {
            throw new Error('해당 매크로 규칙이 없습니다.');
          }

          if (request.method === 'PUT') {
            if (data.revision !== current.revision) {
              reply(response, 409, { error: '내용이 변경되었습니다. 다시 열어주세요.' });

              return;
            }

            if (typeof data.reply !== 'string') {
              throw new Error('답변 내용 오류');
            }

            const viewer = chat.state();

            macro.save({
              ...current.config,
              rules: current.config.rules.map((rule, number) =>
                number === index ? { ...rule, reply: data.reply } : rule
              )
            }, {
              userId: viewer.userId,
              userNick: viewer.userName,
              rule: current.config.rules[index].name || data.command,
              message: `[${data.command}] 답변이 수정되었습니다.\n${data.reply}`
            });
          }

          const saved = snapshot(macro);
          const rule = saved.config.rules[index];

          reply(response, 200, {
            player: macro.client.bjId,
            command: data.command,
            revision: saved.revision,
            reply: Array.isArray(rule.reply) ? rule.reply.join('\n') : rule.reply || ''
          });

          return;
        }

        if (address.pathname === '/api/logs') {
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const options = Object.fromEntries(address.searchParams);
          let data;

          if (options.dates === '1') {
            chat.restore?.();
            data = [];

            if (fs.existsSync(chat.directory)) {
              data = fs.readdirSync(chat.directory).filter(date => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                  return false;
                }

                const file = path.join(chat.directory, date, chat.filename());

                if (fs.existsSync(file) && fs.statSync(file).size > 0) {
                  return true;
                }

                return ['mute.log', 'kick.log'].some(name => {
                  const file = path.join(chat.directory, date, name);

                  if (!fs.existsSync(file)) {
                    return false;
                  }

                  return fs.readFileSync(file, 'utf8').split('\n').some(line => {
                    try {
                      return JSON.parse(line).방송 === chat.client.bjId;
                    } catch {
                      return false;
                    }
                  });
                });
              }).sort().reverse();
            }
          }
          else {
            data = chat.search(options);
          }

          reply(response, 200, data);

          return;
        }

        if (address.pathname === '/api/inbox') {
          const notify = macro.client.notify;
          if (!notify) throw new Error('알림을 사용할 수 없습니다.');
          const details = data => {
            const repairs = [];
            state.inboxTargets ||= new Map();
            for (const item of data.items) {
              if (item.kind !== '운영' || !['채팅 금지', '강제 퇴장'].includes(item.label)
                || item.userId !== macro.client.bjId) continue;
              if (!state.inboxTargets.has(item.id)) {
                const name = String(item.message || '').match(/^(.+?)님이 /)?.[1];
                const date = new Date(item.time).toLocaleDateString('sv-SE');
                const type = item.label === '채팅 금지' ? 'mute' : 'kick';
                const matches = name ? chat.search({ type, text: name, start: date, end: date }).entries
                  .filter(entry => (entry.user?.name === name || entry.user?.id === name)
                    && Math.abs(Date.parse(entry.date) - item.time) < 10000)
                  .sort((a, b) => Math.abs(Date.parse(a.date) - item.time) - Math.abs(Date.parse(b.date) - item.time)) : [];
                state.inboxTargets.set(item.id, matches[0]?.user || null);
              }
              const user = state.inboxTargets.get(item.id);
              if (user?.id) repairs.push({ id: item.id, userId: user.id, nickname: user.name, user });
            }
            data.items = data.items.map(item => {
              const repair = repairs.find(value => value.id === item.id);
              if (repair) item = { ...item, ...repair, image: '' };
              return { ...item,
              user: { ...chat.user({ userId: item.userId, userNick: item.nickname }),
                ...Object.fromEntries(Object.entries(item.user || {}).filter(([, value]) => value != null)) } };
            });
            return data;
          };
          if (request.method === 'GET') {
            reply(response, 200, details(notify.inbox()));
          }
          else if (request.method === 'PUT') {
            const data = await body(request);
            if (data.player !== macro.client.bjId || state.switching) throw new Error('방송이 변경되었습니다.');
            const account = macro.client.info?.IS_LOGIN === 1 ? macro.client.info.LOGIN_ID || 'login' : '';
            if (data.account !== account) throw new Error('연결된 계정이 변경되었습니다.');
            if (!['read', 'deleteRead', 'deleteAll'].includes(data.action)) throw new Error('알림 요청을 확인해주세요.');
            reply(response, 200, details(notify.inbox(data.action, data)));
          }
          else reply(response, 405, { error: '요청 오류' });
          return;
        }

        if (address.pathname === '/api/broadcast') {
          if (request.method !== 'POST') {
            reply(response, 405, { error: '요청 오류' });
            return;
          }

          const data = await body(request);
          const client = macro.client;

          if (!client.bjId || data.player !== client.bjId || state.switching || state.signing) {
            throw new Error('방송이 변경되었습니다.');
          }

          if (typeof data.password !== 'string' || !data.password || data.password.length > 128) {
            throw new Error('방송 비밀번호를 입력해주세요.');
          }

          const key = `broadcast:${request.socket.remoteAddress}`;
          const now = Date.now();
          const previous = state.attempts.get(key);
          const attempt = previous?.until > now ? previous : { count: 0, until: now + 60000 };

          if (attempt.count >= 5) {
            throw new Error('잠시 후 다시 시도해주세요.');
          }

          attempt.count++;
          state.attempts.set(key, attempt);
          state.switching = true;

          try {
            if (!client.isOpen()) {
              client.disconnect(false);
              await client.connecting?.catch(() => {});
              client.stopLive();
              const connected = await client.connect(data.player, data.password);

              if (!connected || !client.isOpen()) {
                client.broadPw = '';
                throw new Error('방송에 접속하지 못했습니다. 방송 비밀번호를 확인해주세요.');
              }

              await video.start();
            }

            state.attempts.delete(key);
            chat.broadcast('state', chat.state());
            reply(response, 200, { connected: true });
          } finally {
            state.switching = false;
            if (client.auto && !client.closed && !client.isOpen()) {
              client.startLive();
            }
          }

          return;
        }

        if (address.pathname === '/api/push') {
          const notify = macro.client.notify;

          if (!notify || !macro.client.bjId) {
            throw new Error('방송을 먼저 선택해주세요.');
          }

          if (request.method === 'GET') {
            reply(response, 200, await push.settings(macro.client, notify.file, address.searchParams.get('endpoint')));
          }
          else if (['PUT', 'DELETE'].includes(request.method)) {
            const data = await body(request);

            if (data.player !== macro.client.bjId || state.switching) {
              throw new Error('방송이 변경되었습니다.');
            }

            const origin = request.headers.origin;

            if (!origin || !allowed.has(origin)) {
              throw new Error('기기 알림 접속 주소 오류');
            }

            const publicOrigin = new URL(visit.visitDetails(request).address || origin).origin;
            reply(response, 200, await push.save(macro.client, notify.file, data, publicOrigin, request.method === 'DELETE'));
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/notify') {
          const notify = macro.client.notify;

          if (!notify) {
            throw new Error('알림 설정을 사용할 수 없습니다.');
          }

          if (request.method === 'GET') {
            reply(response, 200, notify.settings());
          }
          else if (request.method === 'PUT') {
            const data = await body(request);

            if (data.player !== macro.client.bjId || state.switching) {
              throw new Error('방송이 변경되었습니다.');
            }

            delete data.player;
            reply(response, 200, notify.save(data));
          }
          else if (request.method === 'POST') {
            await notify.test(await body(request));
            reply(response, 200, {});
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/multi') {
          if (request.method === 'GET') {
            reply(response, 200, await control.multiStatus(macro.client));
          }
          else if (request.method === 'POST') {
            const data = await body(request);

            if (data.action === 'start') {
              reply(response, 200, await control.startMulti(data.count, macro.client));
            }
            else if (data.action === 'stop') {
              await control.stopMulti(macro.client);
              reply(response, 200, { running: false, rows: [] });
            }
            else {
              throw new Error('명령 오류');
            }
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/chat') {
          if (request.headers.origin) {
            response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
            response.setHeader('Vary', 'Origin');
          }
          if (request.method === 'GET') {
            if (request.headers.accept === 'text/event-stream') {
              chat.listen(response);
            }
            else {
              const data = chat.history(
                address.searchParams.get('cursor') || '',
                address.searchParams.get('user') || '',
                address.searchParams.get('type') || ''
              );

              reply(response, 200, { ...data, state: chat.state() });
            }
          }
          else if (request.method === 'POST') {
            const result = await chat.action(await body(request));

            reply(response, 200, result || {});
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/poll') {
          const poll = chat.poll;

          if (!poll || ![1, 3, 4].includes(poll.status)) {
            throw new Error('진행 중인 투표 없음');
          }

          if (request.method === 'GET') {
            const result = await macro.client.sendPollList(poll.surveyNo);

            if (result?.result !== 1 || chat.poll !== poll) {
              throw new Error('투표 조회 실패');
            }

            reply(response, 200, {
              ...result.data,
              survey: poll.surveyNo,
              status: poll.status
            });
          }
          else if (request.method === 'POST') {
            const data = await body(request);
            const logged = macro.client.info?.IS_LOGIN === 1;

            if (!logged || poll.status !== 1 || data.survey !== poll.surveyNo) {
              throw new Error('투표 요청 오류');
            }

            const result = await macro.client.sendPollList(poll.surveyNo);
            const choice = result?.data?.list?.some(item => {
              return Number(item.answer_no) === data.answer;
            });

            if (!choice || chat.poll !== poll) {
              throw new Error('투표 항목 오류');
            }

            const sent = await macro.client.sendPoll(data.answer);

            if (sent?.result !== 1) {
              throw new Error(sent?.message || '투표 실패');
            }

            reply(response, 200, {});
          }
          else {
            reply(response, 405, { error: '요청 오류' });
          }

          return;
        }

        if (address.pathname === '/api/account' && request.method === 'POST') {
          const data = await body(request);

          if (state.signing || state.switching) {
            throw new Error('로그인 처리 중입니다.');
          }

          const client = macro.client;
          const previous = {
            cookie: client.cookie,
            info: client.info,
            signedout: client.signedout
          };

          state.signing = true;

          let authenticated = false;

          try {
            await client.connecting;

            if (!data || typeof data !== 'object') {
              throw new Error('로그인 요청 오류');
            }

            if (data.action === 'login') {
              if (client.info?.IS_LOGIN === 1) {
                throw new Error('이미 로그인되어 있습니다.');
              }

              const result = await authenticate(data, { ...client.network.httpOptions, cookie: client.cookie });
              if (result.second) {
                reply(response, 200, result);
                return;
              }
              client.cookie = result.cookie;
              client.info = result.info;
              await client.loadBasics();
              client.signedout = false;
              remember();
              authenticated = true;
              state.cookie = null;

              const info = client.info;

              if (client.isOpen()) {
                client.disconnect();
                try {
                  await client.connect();
                } finally {
                  client.info = info;
                }
              }
            }
            else if (data.action === 'logout') {
              const id = client.info?.LOGIN_ID;
              if (id && id === chat.basicAccount) throw new Error('기본 계정은 로그아웃할 수 없습니다.');

              client.signedout = true;
              state.cookie = null;
              state.attempted = undefined;
              await client.logout();
              state.accounts.delete(id);
              state.screens?.list();
            }
            else {
              throw new Error('로그인 요청 오류');
            }

            state.loaded = 0;
            chat.flag = null;
            reply(response, 200, { state: chat.state() });
          } catch (error) {
            if (data?.action === 'login' && !authenticated) {
              client.cookie = previous.cookie;
              client.info = previous.info;
            }

            if (client.cookie === previous.cookie) {
              client.signedout = previous.signedout;
            }

            throw error;
          } finally {
            state.signing = false;
            chat.broadcast('state', chat.state());
          }

          return;
        }

        if (address.pathname === '/api/reaction' && request.method === 'POST') {
          const client = macro.client;
          if (client.info?.IS_LOGIN !== 1) {
            reply(response, 401, { error: '로그인이 필요합니다.' });
            return;
          }
          const data = await body(request);
          const result = await api.postReaction(client.bjId, client.channel?.BNO, data.action,
            { ...client.network?.httpOptions, cookie: client.cookie, active: data.active });
          if (data.action === 'favorite') {
            if (state.profile?.id === client.bjId) state.profile.favorite = result.active;
            state.loaded = 0;
          }
          else if (data.action === 'up' && state.profile?.id === client.bjId) {
            state.profile.up = result.active;
          }
          if (data.action === 'up' && result.active) upStatus(client.info?.LOGIN_ID, client.bjId, true);
          reply(response, 200, result);
          return;
        }

        if (address.pathname === '/api/user' && request.method === 'GET') {
          const id = address.searchParams.get('id') || '';

          if (!/^[a-zA-Z0-9_()-]{1,100}$/.test(id)) {
            throw new Error('사용자 아이디 오류');
          }

          const station = id.replace(/\(\d+\)$/, '');
          const data = await api.getStation(station, {
            ...macro.client.network?.httpOptions,
            signal: AbortSignal.timeout(5000)
          });

          if (address.searchParams.get('details') === '1') {
            const detail = describe(station, data);
            const options = {
              ...macro.client.network?.httpOptions,
              signal: AbortSignal.timeout(5000)
            };
            const [status, dashboard] = await Promise.allSettled([
              api.getStatus(station, options),
              api.getDashboard(station, options)
            ]);

            if (status.status === 'fulfilled') {
              detail.status = status.value?.DATA;
            }

            if (dashboard.status === 'fulfilled') {
              detail.dashboard = dashboard.value;
            }

            reply(response, 200, {
              image: data?.profile_image || '',
              profile: detail,
              user: chat.user({ userId: id })
            });
          }
          else {
            const emblem = address.searchParams.get('emblem') === '1'
              ? await api.getEmblem(station, { ...macro.client.network?.httpOptions,
                signal: AbortSignal.timeout(5000) }).catch(() => null) : undefined;
            reply(response, 200, {
              image: data?.profile_image || '',
              emblem,
              user: chat.user({ userId: id })
            });
          }

          return;
        }

        if (address.pathname === '/api/preview') {
          if (request.method === 'POST') {
            const data = await body(request);
            if (typeof data.id !== 'string' || !['live', 'vod'].includes(data.type)
              || !(data.type === 'vod' ? /^\d{1,20}$/ : /^[a-zA-Z0-9_]{1,64}$/).test(data.id)) {
              throw new Error('아이디 오류');
            }
            reply(response, 200, delivery.data(await previews.open({ id: data.id, type: data.type }), direct));
          } else if (request.method === 'DELETE') {
            previews.remove(address.searchParams.get('key'));
            reply(response, 200, {});
          } else {
            reply(response, 405, { error: '요청 오류' });
          }
          return;
        }

        if (address.pathname === '/api/stream') {
          if (request.method === 'PUT') {
            const data = await body(request);
            if (typeof data.enabled !== 'boolean') throw new Error('영상 설정 오류');
            if (state.videoChanging || state.switching) throw new Error('잠시 후 다시 시도해주세요.');
            state.videoChanging = true;
            try {
              state.videoEnabled = data.enabled;
              if (data.enabled) await video.start();
              else await video.reset();
              state.screens.publish();
              reply(response, 200, { enabled: state.videoEnabled });
            } finally {
              state.videoChanging = false;
            }
            return;
          }
          if (request.method !== 'GET') {
            reply(response, 405, { error: '요청 오류' });

            return;
          }

          const quality = address.searchParams.get('quality');

          if (quality && !/^[a-zA-Z0-9_-]{1,32}$/.test(quality)) {
            throw new Error('화질 오류');
          }

          if (!state.videoEnabled || state.videoChanging) {
            reply(response, 200, { enabled: state.videoEnabled, state: 'disabled', url: '', download: '', qualities: [] });
            return;
          }
          const data = await video.open(quality);

          if (!state.videoEnabled) {
            reply(response, 200, { enabled: false, state: 'disabled', url: '', download: '', qualities: [] });
            return;
          }

          reply(response, 200, delivery.data({ ...data, enabled: true }, direct));

          return;
        }

        if (request.method === 'PUT') {
          const data = await body(request);

          if (state.switching || data.player !== macro.client.bjId) {
            throw new Error('방송이 변경되었습니다.');
          }

          if (macro.closed) {
            reply(response, 410, { error: '프로그램 종료 됨' });

            return;
          }

          const current = snapshot(macro);

          if (!data || data.revision !== current.revision) {
            reply(response, 409, { error: '설정이 변경되었습니다. 다시 불러와주세요' });

            return;
          }

          if (typeof data.enabled === 'boolean' && !data.config) {
            macro.setEnabled(data.enabled);
          }
          else {
            macro.save(data.config);
          }
        }
        else if (request.method !== 'GET') {
          reply(response, 405, { error: '요청 오류' });

          return;
        }

        if (request.headers.host === new URL(state.origin).host) {
          state.seen = Date.now();
        }
        await refresh();

        const data = snapshot(macro);
        const inbox = macro.client.notify?.inbox();
        const current = state.profile?.id === macro.client.bjId ? state.profile : null;
        const viewers = chat.state().viewers ?? current?.broad?.current_sum_viewer ?? 0;

        reply(response, 200, {
          ...data,
          origins,
          chat: direct ? delivery.chat() : '',
          player: macro.client.bjId || '',
          homeAccount: macro.client.info?.IS_LOGIN === 1 ? macro.client.info.LOGIN_ID || 'login' : '',
          sessionReady: state.sessionReady,
          fixed: Boolean(state.fixed),
          notification: macro.client.notify?.settings(),
          inboxUnread: inbox?.unread || 0,
          inboxRevision: inbox?.revision || 0,
          shortcuts: chat.state().manager
            ? shortcuts.filter(command => shortcut(data.config, command) >= 0) : [],
          packs: packs(macro.client),
          emoticons: [...(macro.client.emoticon?.values() || [])],
          recent: macro.client.recent || [],
          ceremonies: ceremonies(macro.client),
          broadcast: {
            ...macro.client.broadcast,
            number: macro.client.channel?.BNO,
            languages: macro.client.channel?.LANG_TAGS || [],
            categories: macro.client.channel?.CATEGORY_TAGS || []
          },
          restricted: {
            password: macro.client.channel?.BPWD === 'Y',
            passwordRequired: macro.client.channel?.BPWD === 'Y' && !macro.client.broadPw && !macro.client.isOpen(),
            adult: Number(macro.client.channel?.GRADE) >= 19
          },
          viewers,
          profile: state.profile?.id === macro.client.bjId ? state.profile : null,
          name:
            macro.client.bjNick || macro.client.station?.user_nick || macro.client.bjId
        });
      })
      .catch(error => {
        if (!response.headersSent && !response.destroyed) {
          reply(response, 400, { error: error.message || '설정 처리 실패' });
        }
        else {
          response.destroy();
        }
      });
  };
}
