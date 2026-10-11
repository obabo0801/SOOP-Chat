import { isIP } from 'net';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as ntfy from '#utils/ntfy';
import * as log from '#utils/log';

export function clientAddress(request, vercel = false) {
  const normalize = value => String(value || '').trim().replace(/^::ffff:/, '');
  const remote = normalize(request.socket.remoteAddress);
  const local = remote === '::1' || /^127\./.test(remote);

  if (local) {
    for (const key of vercel ? ['x-vercel-forwarded-for'] : ['x-vercel-forwarded-for', 'x-forwarded-for']) {
      const value = request.headers[key];
      if (typeof value !== 'string') continue;
      const address = normalize(value.split(',')[0]);
      if (isIP(address)) return address;
    }
  }

  return !vercel && isIP(remote) ? remote : '';
}

export function visitDetails(request) {
  const headers = request.headers;
  const local = /^(::1|127\.|::ffff:127\.)/.test(request.socket.remoteAddress || '');
  const first = value => typeof value === 'string' ? value.split(',')[0].trim() : '';
  const host = local && first(headers['x-forwarded-host']) || headers.host;
  const protocol = local && first(headers['x-forwarded-proto']) || (request.socket.encrypted ? 'https' : 'http');
  let address = '';

  try {
    const url = new URL(local && headers['x-soop-url'] || request.url, `${protocol}://${host}`);

    if (['http:', 'https:'].includes(url.protocol)) {
      address = `${url.origin}${url.pathname}`;
    }
  } catch {}

  const agent = headers['user-agent'] || '';
  const browsers = [
    ['Whale', /Whale\/([\d.]+)/],
    ['Edge', /Edg(?:A|iOS)?\/([\d.]+)/],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/]
  ];
  let browser = '확인 불가';

  for (const [name, pattern] of browsers) {
    const match = pattern.exec(agent);

    if (match) {
      browser = `${name} ${match[1]}`;
      break;
    }
  }

  let system = '확인 불가';

  if (/Android/.test(agent)) {
    const version = /Android\s+([\d.]+)/.exec(agent)?.[1] || '';

    system = `Android ${version}`.trim();
  }
  else if (/iPhone|iPad|iPod/.test(agent)) {
    const version = /(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/.exec(agent)?.[1] || '';

    system = `iOS ${version.replaceAll('_', '.')}`.trim();
  }
  else if (/Windows NT 10\.0/.test(agent)) {
    system = 'Windows 10/11';
  }
  else if (/Windows/.test(agent)) {
    system = 'Windows';
  }
  else if (/Mac OS X/.test(agent)) {
    const version = /Mac OS X ([\d_]+)/.exec(agent)?.[1] || '';

    system = `macOS ${version.replaceAll('_', '.')}`.trim();
  }
  else if (/Linux/.test(agent)) {
    system = 'Linux';
  }

  const result = { address, browser, os: system };

  return result;
}

export async function notifyVisit(request, notify = true) {
  const topic = process.env.DEVTOPIC?.trim();
  if (!topic || request.method !== 'GET'
    || /prefetch/i.test(String(request.headers['sec-purpose'] || request.headers.purpose || ''))) {
    return false;
  }

  const details = visitDetails(request);
  let origin;
  try { origin = new URL(process.env.WEBORIGIN).origin; } catch { return false; }
  if (!details.address.startsWith(`${origin}/`)) return false;
  if (notify && (request.headers['sec-fetch-dest'] !== 'document'
    || request.headers['sec-fetch-mode'] !== 'navigate'
    || details.browser === '확인 불가')) return false;
  const forwarded = request.headers['x-vercel-forwarded-for'];
  const screen = request.headers['x-soop-screen'] && request.headers['x-soop-url'];
  if (!forwarded && !screen) return false;

  const visitor = screen && request.headers['x-soop-visitor'];
  const address = forwarded ? clientAddress(request, true)
    : typeof visitor === 'string' && isIP(visitor) ? visitor : '';
  if (!address) return false;
  const key = crypto.createHash('sha256').update(`${process.cwd()}:${address}`).digest('hex');
  const file = path.join(os.tmpdir(), `soopvisit${key}`);
  const lock = `${file}.lock`;
  try { fs.mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  let active = false;
  try {
    const now = Date.now();
    try { active = now - fs.statSync(file).mtimeMs < 120000; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (notify || active) fs.writeFileSync(file, '', { mode: 0o600 });
  } finally {
    fs.rmdirSync(lock);
  }
  if (!notify || active) return false;
  const time = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });

  try {
    await ntfy.publish({ server: 'https://ntfy.sh', topic, token: process.env.NTFYTOKEN?.trim() }, {
      title: `[접속] ${address}`,
      message: `주소: ${details.address || '확인 불가'}\n브라우저: ${details.browser}\nOS: ${details.os}\n시간: ${time}`
    });
    return true;
  } catch (error) {
    log.warn('[접속 알림]', error.message);
    return false;
  }
}
