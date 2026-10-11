import crypto from 'crypto';
import * as env from '#utils/env';

export function createMedia(state, server) {
  let origin;
  let checked = 0;
  const refresh = () => {
    if (checked && (server !== undefined || Date.now() - checked < 1000)) return;
    if (server === undefined) env.parseEnv(undefined, false);
    const value = server === undefined ? process.env.SERVER : server;
    const address = value ? new URL(value) : null;
    if (address && (address.protocol !== 'https:' || address.username || address.password
      || address.pathname !== '/' || address.search || address.hash)) {
      throw new Error('SERVER에 HTTPS 서버 주소를 설정해주세요.');
    }
    origin = address;
    checked = Date.now();
  };
  refresh();
  const resource = pathname => /^\/media\/(?:preview\/)?[a-f0-9]{48}\/(?:\d+|save)$/.test(pathname)
    ? pathname.slice(0, pathname.lastIndexOf('/')) : '';
  const signature = family => crypto.createHmac('sha256', state.token).update(family).digest('hex');
  const url = value => {
    refresh();
    if (!origin || !value?.startsWith('/media/')) return value;
    const address = new URL(value, origin);
    const family = resource(address.pathname);
    if (!family) return value;
    address.searchParams.set('media', signature(family));
    const number = Number(new URL(state.origin).port) - state.range.start + 1;
    address.pathname = `/${number}${address.pathname}`;
    return address.href;
  };
  const verify = address => {
    refresh();
    const family = resource(address.pathname);
    const ticket = address.searchParams.get('media') || '';
    return Boolean(origin && family && /^[a-f0-9]{64}$/.test(ticket)
      && crypto.timingSafeEqual(Buffer.from(ticket), Buffer.from(signature(family))));
  };
  const data = (value, direct = true) => !value || !direct ? value : ({ ...value, ...Object.fromEntries(
    ['url', 'download'].filter(key => key in value).map(key => [key, url(value[key])])
  ) });
  const chat = () => {
    refresh();
    if (!origin) return '';
    const number = Number(new URL(state.origin).port) - state.range.start + 1;
    return new URL(`/${number}/api/chat`, origin).href;
  };
  return { get origin() { refresh(); return origin?.origin || ''; }, url, verify, data, chat };
}
