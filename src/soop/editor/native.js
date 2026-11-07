export function syncTheme() {
  const bridge = window.SoopAndroid;
  if (!bridge?.postMessage) return;
  const update = () => bridge.postMessage(JSON.stringify({ type: 'theme',
    dark: document.documentElement.classList.contains('dark') }));
  window.addEventListener('theme', update);
  update();
}

export function createNative(video, state, restore) {
  const bridge = window.SoopAndroid;
  const available = Boolean(bridge?.postMessage);
  let active = false;
  let updated = 0;
  const send = value => {
    if (available) bridge.postMessage(JSON.stringify(value));
  };
  const publish = (force = false) => {
    if (!available || active || !force && Date.now() - updated < 500) return;
    updated = Date.now();
    const current = state();
    let url = '';
    let artwork = '';
    try { if (current.url) url = new URL(current.url, location.href).href; } catch {}
    try {
      if (current.artwork) {
        const address = new URL(current.artwork, location.href);
        if (address.protocol === 'http:') address.protocol = 'https:';
        if (address.protocol === 'https:') artwork = address.href;
      }
    } catch {}
    const rect = video.getBoundingClientRect?.();
    send({ type: 'playback', url, title: current.title, artist: current.artist || '', artwork, live: current.live,
      bounds: rect && window.innerWidth ? { x: rect.left, y: rect.top, width: rect.width,
        height: rect.height, viewport: window.innerWidth } : null,
      playing: Boolean(current.enabled && current.url && !current.paused && !video.paused && !video.ended),
      position: video.currentTime || 0, muted: video.muted, volume: video.volume,
      start: video.seekable?.length ? video.seekable.start(0) : 0,
      end: video.seekable?.length ? video.seekable.end(video.seekable.length - 1) : 0,
      width: video.videoWidth, height: video.videoHeight });
  };
  if (available) {
    window.addEventListener('resize', () => publish(true));
    for (const event of ['playing', 'pause', 'ended', 'loadedmetadata', 'volumechange', 'durationchange', 'seeked']) {
      video.addEventListener(event, () => publish(true));
    }
    video.addEventListener('timeupdate', () => publish());
    video.addEventListener('progress', () => publish());
    window.addEventListener('soopnative', event => {
      const data = event.detail;
      if (data?.type === 'seek' && Number.isFinite(data.position) && video.seekable?.length) {
        let target = Math.max(video.seekable.start(0), data.position);
        for (let index = 0; index < video.seekable.length; index++) {
          if (target < video.seekable.start(index)) target = video.seekable.start(index);
          if (target <= video.seekable.end(index)) break;
          if (index === video.seekable.length - 1) target = video.seekable.end(index);
        }
        restore({ type: 'seek', position: target });
        publish(true);
        return;
      }
      if (data?.type === 'playback' && typeof data.playing === 'boolean') {
        if (!data.playing) video.pause();
        restore(data);
        return;
      }
      if (data?.type !== 'pip' || typeof data.active !== 'boolean') return;
      active = data.active;
      if (active) video.pause();
      else restore(data);
    });
  }
  return { available, active: () => active, publish,
    enter: () => { publish(true); send({ type: 'pip' }); } };
}
