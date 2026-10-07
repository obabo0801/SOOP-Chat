export async function publish(config, message, signal) {
  const url = new URL(config.server);

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ntfy 서버 주소 오류');
  }

  if (!/^[\w-]+$/.test(config.topic)) {
    throw new Error('ntfy 토픽 설정 오류');
  }

  url.pathname = url.pathname.replace(/\/?$/, '/');

  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
    },
    body: JSON.stringify({ topic: config.topic, ...message }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)].filter(Boolean))
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`ntfy 전송 실패 (${response.status})`);
  }

  await response.body?.cancel();
}
