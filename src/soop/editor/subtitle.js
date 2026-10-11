export function createSubtitle(video, node, enabled, live = () => false) {
  const entries = [];
  const seen = new Set();
  const track = video.addTextTrack('subtitles', 'SOOP');
  let source = '';
  let date;
  let timing = [];
  let delay = 0;
  const position = value => {
    const anchor = timing.findLast(item => item.date <= value) || timing[0];

    return anchor ? anchor.time + (value - anchor.date) / 1000 : (value - date) / 1000;
  };

  track.mode = 'hidden';
  const text = () => {
    if (!enabled() || video.ended) {
      return '';
    }

    const caption = entries.findLast(item => {
      const elapsed = video.currentTime - item.time;

      return elapsed >= -0.05 && elapsed < 6;
    });

    return caption?.message || '';
  };
  const update = () => {
    const native = video.webkitDisplayingFullscreen
      || video.webkitPresentationMode === 'fullscreen'
      || video.webkitPresentationMode === 'picture-in-picture'
      || document.pictureInPictureElement === video;

    track.mode = native && enabled() ? 'showing' : 'hidden';
    node.textContent = text();
    node.hidden = !node.textContent || native;
  };
  const rebuild = () => {
    for (const cue of [...(track.cues || [])]) {
      track.removeCue(cue);
    }

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];

      entry.time = position(entry.date) - (entry.delay ?? delay);
      const next = entries[index + 1];
      const end = Math.min(entry.time + 6, next ? position(next.date) - (next.delay ?? delay) : Infinity);

      if (Number.isFinite(entry.time) && end > Math.max(0, entry.time)
        && typeof window.VTTCue === 'function') {
        const cue = new window.VTTCue(Math.max(0, entry.time), end, entry.message);

        cue.line = -2;
        track.addCue(cue);
      }
    }

    update();
  };

  track.addEventListener('cuechange', update);
  for (const event of ['timeupdate', 'play', 'pause', 'seeking', 'seeked', 'loadeddata', 'ended',
    'enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged',
    'webkitbeginfullscreen', 'webkitendfullscreen']) {
    video.addEventListener(event, update);
  }

  return {
    text,
    update,
    add(entry, realtime = true) {
      const time = Date.parse(entry.date);

      if (!Number.isFinite(time) || !entry.message || entry.id && seen.has(entry.id)) {
        return;
      }

      const current = position(time);
      let offset = realtime ? delay : undefined;
      const age = Date.now() - time;
      const native = document.pictureInPictureElement === video
        || video.webkitPresentationMode === 'picture-in-picture';
      if (realtime && live() && (!document.hidden || native) && Math.abs(age) <= 3000
        && video.readyState >= 3 && !video.paused && !video.seeking && Number.isFinite(current)) {
        delay = current - video.currentTime;
        offset = delay;
      }

      if (entry.id) seen.add(entry.id);
      entries.push({ id: entry.id, date: time, delay: offset, message: entry.message });
      entries.sort((a, b) => a.date - b.date);

      if (entries.length > 2000) {
        seen.delete(entries.shift().id);
      }

      rebuild();
    },
    timing(data) {
      let start = data.date;

      if (!Number.isFinite(start)) {
        if (source === data.url && Number.isFinite(date)) {
          start = date;
        }
        else {
          start = data.duration > 0 ? Date.now() - data.duration * 1000 : undefined;
        }
      }

      if (source !== data.url || date !== start
        || JSON.stringify(timing) !== JSON.stringify(data.timing || [])) {
        source = data.url;
        date = start;
        timing = data.timing || [];
        rebuild();
      }
    },
    clear() {
      entries.length = 0;
      seen.clear();
      delay = 0;
      rebuild();
    }
  };
}
