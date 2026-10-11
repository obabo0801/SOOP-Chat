import Hls from '/hls.js';

export function createLivePreview(request) {
  const cards = new Map();
  const failed = new WeakSet();
  const mobile = matchMedia('(hover: none), (pointer: coarse)');
  let active;
  let timer;
  let version = 0;
  const release = key => void request('DELETE', undefined,
    `/api/preview?key=${encodeURIComponent(key)}`).catch(() => {});
  const stop = () => {
    clearTimeout(timer);
    version++;
    if (!active) return;
    active.hls?.destroy();
    active.video?.pause();
    active.video?.removeAttribute('src');
    active.video?.load();
    active.video?.remove();
    if (active.key) release(active.key);
    active = null;
  };
  const play = async node => {
    if (document.hidden || !node.isConnected || !cards.has(node) || failed.has(node)) return;
    if (active?.node === node) return;
    stop();
    const current = ++version;
    active = { node };
    try {
      const item = cards.get(node);
      const data = await request('POST', item, '/api/preview');
      if (current !== version || !node.isConnected || document.hidden) {
        release(data.key);
        return;
      }
      active.key = data.key;
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.className = 'live-preview';
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.disablePictureInPicture = true;
      video.loop = item.type === 'vod';
      active.video = video;
      node.prepend(video);
      video.addEventListener('playing', () => video.classList.add('playing'));
      if (data.format === 'video') {
        video.src = data.url;
        void video.play().catch(() => {
          if (current === version) { failed.add(node); stop(); }
        });
      } else if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 6, backBufferLength: 0 });
        active.hls = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (current === version) void video.play().catch(() => {
            if (current === version) { failed.add(node); stop(); }
          });
        });
        hls.on(Hls.Events.ERROR, (_, error) => {
          if (error.fatal && current === version) { failed.add(node); stop(); }
        });
        hls.loadSource(data.url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = data.url;
        void video.play().catch(() => {
          if (current === version) { failed.add(node); stop(); }
        });
      } else {
        stop();
      }
    } catch {
      if (current === version) { failed.add(node); stop(); }
    }
  };
  const visible = node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0
      && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  };
  const nearest = () => {
    if (!mobile.matches || document.hidden) return;
    let selected;
    let distance = Infinity;
    for (const node of cards.keys()) {
      if (!visible(node) || failed.has(node)) continue;
      const rect = node.getBoundingClientRect();
      const area = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0))
        * Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
      if (area < rect.width * rect.height * 0.6) continue;
      const value = Math.hypot(rect.top + rect.height / 2 - innerHeight / 2,
        rect.left + rect.width / 2 - innerWidth / 2);
      if (value < distance) { selected = node; distance = value; }
    }
    if (selected) void play(selected);
    else stop();
  };
  const schedule = () => {
    if (!mobile.matches) return;
    clearTimeout(timer);
    timer = setTimeout(nearest, 350);
  };
  const observer = new IntersectionObserver(() => {
    if (active && !visible(active.node)) stop();
    schedule();
  }, { threshold: [0, 0.6, 1] });
  const register = (node, id, type = 'live') => {
    cards.set(node, { id: String(id), type });
    observer.observe(node);
    node.addEventListener('pointerenter', () => {
      if (!mobile.matches) {
        clearTimeout(timer);
        timer = setTimeout(() => void play(node), 350);
      }
    });
    node.addEventListener('pointerleave', () => {
      if (!mobile.matches) { failed.delete(node); stop(); }
    });
    node.addEventListener('click', stop);
  };
  new MutationObserver(() => {
    let removed = false;
    for (const node of cards.keys()) {
      if (node.isConnected) continue;
      cards.delete(node);
      observer.unobserve(node);
      removed = true;
    }
    if (active && (!active.node.isConnected || !visible(active.node))) stop();
    if (removed) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else schedule();
  });
  window.addEventListener('pagehide', stop);
  mobile.addEventListener('change', () => { stop(); schedule(); });
  return register;
}
