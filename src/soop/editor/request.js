let connection;

export function configure(value) {
  const url = new URL(value.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !/^\/(?:\d+\/)?$/.test(url.pathname) || typeof value.access !== 'string') {
    throw new Error('서버 연결 정보를 확인해주세요.');
  }
  const changed = connection?.url !== url.href;
  connection = { url: url.href, access: value.access };
  return changed;
}

export function open(value, options = {}) {
  const url = new URL(value, window.location.href);
  const headers = new Headers(options.headers);
  if (connection) {
    const target = new URL(connection.url);
    if (url.origin === window.location.origin && /^\/(?:\d+\/)?api\//.test(url.pathname)) {
      url.pathname = target.pathname + url.pathname.replace(/^\/(?:\d+\/)?/, '');
      url.protocol = target.protocol;
      url.host = target.host;
    }
    if (url.origin === target.origin && url.pathname.startsWith(target.pathname + 'api/')) {
      headers.set('X-Soop-Access', connection.access);
    }
  }
  return fetch(url, { ...options, headers });
}

export async function request(url, options = {}) {
  const retryable = !options.method || options.method === 'GET';
  // A new screen can need 60 seconds to become ready before the server replies.
  const connecting = options.method === 'POST'
    && /^\/(?:\d+\/)?api\/connect$/.test(new URL(url, window.location.href).pathname);
  for (let attempt = 0; ; attempt++) {
    try {
      const timeout = AbortSignal.timeout(connecting ? 90000 : 20000);
      const response = await open(url, {
        ...options,
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      });
      let result;
      try {
        result = await response.json();
      } catch (cause) {
        const error = new Error('서버 응답이 지연되고 있습니다.', { cause });
        error.code = response.status;
        error.transient = response.ok || [408, 502, 503, 504].includes(response.status);
        throw error;
      }
      if (!response.ok) {
        const error = new Error(result?.error || '요청을 처리하지 못했습니다.');
        error.code = response.status;
        error.transient = [408, 502, 503, 504].includes(response.status);
        throw error;
      }
      return result;
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      const error = typeof cause?.transient === 'boolean' ? cause : Object.assign(
        new Error('연결이 지연되고 있습니다.', { cause }),
        { transient: true }
      );
      if (!retryable || !error.transient || attempt >= 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
