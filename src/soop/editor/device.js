export function createDevice(request, player) {
  const $ = id => document.getElementById(id);
  const supported = window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
  let registration;
  let installing;
  let installed = false;
  const installButtons = [$('device-install'), $('access-install')];
  const standalone = window.matchMedia('(display-mode: standalone)');
  const mobileApple = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const safari = /Macintosh/.test(navigator.userAgent)
    && /Version\/(\d+)/.exec(navigator.userAgent)?.[1] >= 17
    && /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent);
  const manual = mobileApple || safari;
  const app = () => standalone.matches || navigator.standalone === true
    || window.matchMedia('(display-mode: window-controls-overlay)').matches;
  const install = () => {
    for (const button of installButtons) {
      button.hidden = !window.isSecureContext || app() || installed || !installing && !manual;
    }
  };
  standalone.addEventListener('change', install);
  let active = false;

  const worker = async () => {
    registration ??= await navigator.serviceWorker.register(new URL('/worker.js', location.origin), { scope: '/' });
    await navigator.serviceWorker.ready;

    return registration;
  };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installing = event;
    installed = false;
    install();
  });

  window.addEventListener('appinstalled', () => {
    installing = null;
    installed = true;
    install();
  });

  const promptInstall = async () => {
    if (app() || installed) {
      return;
    }

    if (!installing) {
      if (!manual) return;
      $('install-guide-text').textContent = mobileApple
        ? 'Safari에서 공유 버튼을 누르고 홈 화면에 추가를 선택해주세요. 웹 앱으로 열기가 보이면 켜주세요.'
        : 'Safari에서 공유 버튼을 누르고 Dock에 추가를 선택해주세요.';
      $('install-guide').showModal();
      return;
    }

    const prompt = installing;
    installing = null;
    install();
    await prompt.prompt();
    const choice = await prompt.userChoice;
    installed = choice.outcome === 'accepted';
    install();
  };
  for (const button of installButtons) button.addEventListener('click', promptInstall);
  $('install-guide-close').addEventListener('click', () => $('install-guide').close());

  if (window.isSecureContext && navigator.getInstalledRelatedApps) {
    void navigator.getInstalledRelatedApps().then(apps => {
      installed = apps.some(item => item.platform === 'webapp'
        && new URL(item.url || '/', location.origin).origin === location.origin);
      install();
    }).catch(() => {});
  }
  install();

  const status = (text, error = false) => {
    $('device-status').textContent = text;
    $('device-status').hidden = !text;
    $('device-status').classList.toggle('error', error);
  };

  const refresh = async () => {
    if (!supported) {
      $('device-enable').disabled = true;
      status(window.isSecureContext ? '이 브라우저에서는 기기 알림을 지원하지 않습니다.' : 'HTTPS 주소에서 기기 알림을 사용할 수 있습니다.');
      return;
    }

    const current = await worker();
    const subscription = await current.pushManager.getSubscription();
    const endpoint = subscription?.endpoint || '';
    const data = await request('GET', undefined, `/api/push?endpoint=${encodeURIComponent(endpoint)}`);
    active = Boolean(subscription && data.registered);
    $('device-enable').textContent = active ? '등록 해제' : '알림 받기';
    status(active ? '현재 방송과 계정에 등록되었습니다.' : '');

    return data;
  };

  $('device-enable').addEventListener('click', async () => {
    const button = $('device-enable');
    button.disabled = true;

    try {
      if (!active) {
        const permission = await Notification.requestPermission();

        if (permission !== 'granted') {
          throw new Error('브라우저 사이트 설정에서 알림을 허용해주세요.');
        }
      }

      const current = await worker();
      let subscription = await current.pushManager.getSubscription();

      if (!active) {
        const data = await request('GET', undefined, '/api/push');
        const encoded = data.publicKey.replace(/-/g, '+').replace(/_/g, '/');
        const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));

        if (subscription && !sameKey(subscription.options.applicationServerKey, bytes)) {
          await subscription.unsubscribe();
          subscription = null;
        }

        subscription ??= await current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      }

      if (!subscription) {
        throw new Error('기기 알림을 다시 등록해주세요.');
      }

      await request(active ? 'DELETE' : 'PUT', {
        player: player(), subscription: subscription.toJSON(), url: location.pathname
      }, '/api/push');
      await refresh();
    } catch (error) {
      status(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  if (supported) {
    void worker().catch(() => {});
  }

  return { refresh };
}

function sameKey(buffer, key) {
  const current = new Uint8Array(buffer || []);
  const result = current.length === key.length && current.every((value, index) => value === key[index]);

  return result;
}
