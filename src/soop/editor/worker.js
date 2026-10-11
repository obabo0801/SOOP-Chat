self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data;

  try {
    data = event.data?.json() || {};
  } catch {
    data = {};
  }

  const expired = data.time && Date.now() - data.time > (data.urgent ? 120000 : 60000);
  const image = data.image?.replace(/(\/ogq\/[\w-]+\/[1-9]\d*(?:_\d+)?)\.webp$/, '$1.png');
  const options = {
    body: data.body || '새 알림이 도착했습니다.',
    icon: image || '/app.png',
    image,
    tag: expired ? 'expired' : data.tag,
    timestamp: data.time || Date.now(),
    requireInteraction: Boolean(data.urgent) && !expired,
    silent: Boolean(expired),
    data: { url: data.url || '/' }
  };

  if (data.urgent && !expired) {
    options.vibrate = [300, 150, 300, 150, 600];
  }

  event.waitUntil(self.registration.showNotification(data.title || 'SOOP Chat', options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let address = new URL('/', self.location.origin);

  try {
    const target = new URL(event.notification.data?.url || '/', self.location.origin);

    if (target.origin === self.location.origin
      || target.protocol === 'https:' && !target.username && !target.password
        && (target.hostname === 'sooplive.com' || target.hostname.endsWith('.sooplive.com'))) {
      address = target;
    }
  } catch {}

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = windows.find(client => new URL(client.url).href === address.href);

    if (current) {
      await current.focus();
      return;
    }

    await self.clients.openWindow(address.href);
  })());
});
