import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import * as dotenv from 'dotenv';
import * as log from '#utils/log';
import * as base64 from '#utils/base64';

function target(client, file) {
  if (!file || !client.bjId) {
    throw new Error('방송을 먼저 선택해주세요.');
  }

  const account = client.info?.IS_LOGIN === 1 ? client.info.LOGIN_ID : '';
  const result = path.join(path.dirname(file), 'push', `${encodeURIComponent(account || '비로그인')}.json`);

  return result;
}

function read(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (!Array.isArray(data)) {
      throw new Error('기기 알림 설정 오류');
    }

    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export async function keys() {
  const file = path.resolve('.env');
  const lock = `${file}.pushlock`;

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      fs.mkdirSync(lock);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30000) {
          fs.rmdirSync(lock);
        }
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) {
          throw error;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }

    try {
      const stored = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const source = base64.decode(stored) ?? stored;
      const values = dotenv.parse(source);
      let publicKey = values.PUSHPUBLIC || process.env.PUSHPUBLIC;
      let privateKey = values.PUSHPRIVATE || process.env.PUSHPRIVATE;

      if (!publicKey && !privateKey) {
        const generated = webpush.generateVAPIDKeys();
        publicKey = generated.publicKey;
        privateKey = generated.privateKey;
        const content = source.replace(/^PUSH(PUBLIC|PRIVATE)=.*(?:\r?\n|$)/gm, '');
        const next = `${content.trimEnd()}\nPUSHPUBLIC="${publicKey}"\nPUSHPRIVATE="${privateKey}"\n`;
        fs.writeFileSync(file, stored !== source ? base64.encode(next) : next, { mode: 0o600 });
      }

      if (!publicKey || !privateKey) {
        throw new Error('기기 알림 키 설정을 확인해주세요.');
      }

      if (!/^[\w-]{87}$/.test(publicKey) || !/^[\w-]{43}$/.test(privateKey)) {
        throw new Error('기기 알림 키 설정을 확인해주세요.');
      }

      process.env.PUSHPUBLIC = publicKey;
      process.env.PUSHPRIVATE = privateKey;

      return { publicKey, privateKey };
    } finally {
      fs.rmdirSync(lock);
    }
  }

  throw new Error('기기 알림 설정을 다시 시도해주세요.');
}

function validate(value) {
  let endpoint;

  try {
    endpoint = new URL(value?.endpoint);
  } catch {
    throw new Error('기기 알림 주소 오류');
  }

  const host = endpoint.hostname;
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  const apple = host.endsWith('.push.apple.com');

  if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password
    || !allowed.includes(host) && !apple || endpoint.href.length > 4096
    || !/^[\w-]{87,88}$/.test(value.keys?.p256dh || '')
    || !/^[\w-]{22,24}$/.test(value.keys?.auth || '')) {
    throw new Error('기기 알림 등록 정보 오류');
  }

  return { endpoint: endpoint.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

export async function settings(client, file, endpoint) {
  const data = read(target(client, file));
  const vapid = await keys();
  const result = { publicKey: vapid.publicKey, registered: data.some(item => item.subscription.endpoint === endpoint) };

  return result;
}

export async function save(client, file, data, origin, remove = false) {
  const subscription = validate(data.subscription);
  if (typeof data.url !== 'string' || !/^\/(?!\/)/.test(data.url)) {
    throw new Error('기기 알림 접속 주소 오류');
  }

  const address = new URL(data.url || '/', origin);

  if (address.origin !== origin || address.username || address.password) {
    throw new Error('기기 알림 접속 주소 오류');
  }

  address.search = '';
  address.hash = '';
  const location = target(client, file);
  const items = read(location).filter(item => item.subscription.endpoint !== subscription.endpoint);

  if (!remove) {
    if (items.length >= 20) {
      throw new Error('등록 가능한 기기 수를 초과했습니다.');
    }

    items.push({ subscription, url: address.href });
  }

  write(location, items);

  return settings(client, file, remove ? undefined : subscription.endpoint);
}

export function connected(client, file) {
  if (!file || !client.bjId) {
    return false;
  }

  try {
    return read(target(client, file)).length > 0;
  } catch {
    log.warn('[알림]', '기기 알림 설정을 읽을 수 없습니다.');

    return false;
  }
}

export async function publish(client, file, message) {
  const location = target(client, file);
  const items = read(location);

  if (!items.length) {
    return false;
  }

  const vapid = await keys();
  const time = message.time || Date.now();
  const lifetime = message.priority === 5 ? 120 : 60;

  if (Date.now() - time >= lifetime * 1000) {
    return false;
  }
  const results = await Promise.allSettled(items.map(async item => {
    try {
      validate(item.subscription);
      const address = new URL(item.url);
      let destination = address.href;

      if (message.click) {
        const link = new URL(message.click, address);
        if (link.protocol === 'https:' && !link.username && !link.password
          && (link.origin === address.origin || link.hostname === 'sooplive.com'
            || link.hostname.endsWith('.sooplive.com'))) {
          destination = link.href;
        }
      }
      const topic = crypto.createHash('sha256')
        .update(`${location}:${address.href}:${message.kind || message.title}`)
        .digest('base64url').slice(0, 32);
      let image = message.image;

      if (image) {
        const sticker = new URL(image);
        if (sticker.hostname === 'ogq-sticker-global-cdn-z01.sooplive.com'
          && /^\/sticker\/[\w-]+\/[1-9]\d*(?:_\d+)?\.(png|webp)$/.test(sticker.pathname)) {
          image = new URL(sticker.pathname.replace('/sticker/', '/ogq/').replace(/\.webp$/, '.png'), address.origin).href;
        }
      }
      const payload = JSON.stringify({
        title: message.title, body: message.message, url: destination,
        image, tag: topic, urgent: message.priority === 5, time
      });
      await webpush.sendNotification(item.subscription, payload, {
        vapidDetails: { ...vapid, subject: address.origin },
        TTL: Math.max(0, Math.ceil(lifetime - (Date.now() - time) / 1000)),
        topic,
        urgency: message.priority === 5 ? 'high' : 'normal',
        timeout: 10000
      });

      return true;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        const current = read(location).filter(value => value.subscription.endpoint !== item.subscription.endpoint);
        write(location, current);
      }

      log.warn('[알림]', `기기 알림 전송 실패${error.statusCode ? ` (${error.statusCode})` : ''}`);

      return false;
    }
  }));

  return results.some(result => result.status === 'fulfilled' && result.value);
}
