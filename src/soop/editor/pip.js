export function createPip(video, subtitle, title, update, caption, playing = () => !video.paused) {
  let popup;
  let restore;
  let output;
  let cleanup;
  let opening;
  let settling = 0;
  let dismissed = false;
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/.test(navigator.userAgent)
    || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  const active = () => Boolean(popup && !popup.closed)
    || document.pictureInPictureElement === video
    || Boolean(output && document.pictureInPictureElement === output)
    || video.webkitPresentationMode === 'picture-in-picture';

  const changed = () => update(active());
  const guard = () => { settling = Date.now() + 1200; };
  const resume = () => {
    if (mobile && playing() && (!document.hidden || active())
      && video.paused && video.readyState >= 2) {
      void video.play().catch(() => {});
    }
  };

  video.addEventListener('enterpictureinpicture', () => {
    dismissed = false;
    guard(); changed(); resume();
  });
  video.addEventListener('leavepictureinpicture', () => {
    dismissed = document.hidden;
    guard();
    changed();
    if (!document.hidden) {
      resume();
      requestAnimationFrame(resume);
    }
  });
  video.addEventListener('webkitpresentationmodechanged', changed);

  const composite = async () => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const target = document.createElement('video');
    const ratio = video.videoWidth / video.videoHeight || 16 / 9;

    canvas.width = Math.min(video.videoWidth || 960, 960);
    canvas.height = Math.round(canvas.width / ratio);
    target.className = 'pip-video';
    target.muted = true;
    target.playsInline = true;
    document.body.append(target);
    let frame;
    let closed = false;
    let stream;
    const draw = () => {
      if (closed || video.readyState < 2) {
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const message = caption();

      if (message) {
        const size = Math.max(14, Math.round(canvas.width / 38));

        context.font = `600 ${size}px sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const lines = [];
        let line = '';

        for (const character of message) {
          if (character === '\n' || context.measureText(line + character).width > canvas.width - 48) {
            lines.push(line);
            line = character === '\n' ? '' : character;
          }
          else {
            line += character;
          }
        }

        lines.push(line);
        const height = size * 1.5;
        const bottom = canvas.height - 12;
        const visible = lines.slice(-3);

        visible.forEach((text, index) => {
          const y = bottom - (visible.length - index - 0.5) * height;
          const width = context.measureText(text).width + 20;

          context.fillStyle = 'rgba(0, 0, 0, 0.65)';
          context.fillRect((canvas.width - width) / 2, y - height / 2, width, height);
          context.fillStyle = '#fff';
          context.fillText(text, canvas.width / 2, y);
        });
      }

      stream?.getVideoTracks()[0]?.requestFrame?.();
    };
    const next = () => {
      if (!closed) {
        draw();
        frame = video.requestVideoFrameCallback(next);
      }
    };
    const playing = () => { void target.play().catch(() => {}); };
    const paused = () => target.pause();
    const toggle = () => {
      if (!closed && document.pictureInPictureElement === target) {
        if (target.paused) {
          video.pause();
        }
        else {
          void video.play().catch(() => {});
        }
      }
    };
    const timer = setInterval(draw, video.requestVideoFrameCallback ? 250 : 40);

    output = target;
    cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(timer);
      video.cancelVideoFrameCallback?.(frame);
      video.removeEventListener('play', playing);
      video.removeEventListener('pause', paused);
      stream?.getTracks().forEach(track => track.stop());
      target.srcObject = null;
      target.remove();
      output = undefined;
      cleanup = undefined;
      changed();
    };
    target.addEventListener('leavepictureinpicture', cleanup, { once: true });
    target.addEventListener('play', toggle);
    target.addEventListener('pause', toggle);
    video.addEventListener('play', playing);
    video.addEventListener('pause', paused);

    try {
      draw();
      stream = canvas.captureStream(25);
      target.srcObject = stream;

      if (video.requestVideoFrameCallback) {
        frame = video.requestVideoFrameCallback(next);
      }

      await target.play();
      await target.requestPictureInPicture();
      changed();
    } catch (error) {
      cleanup?.();
      throw error;
    }
  };

  return {
    active,
    dismissed: () => {
      if (!document.hidden) dismissed = false;
      return dismissed;
    },
    mobile,
    guard,
    pending: () => Boolean(opening) || Date.now() < settling,
    async enter() {
      if (active()) return;
      return this.toggle();
    },
    async exit() {
      if (opening) await opening;
      if (active()) await this.toggle();
    },
    title(value) {
      if (popup && !popup.closed) {
        popup.document.title = value;
      }
    },
    async toggle() {
      if (!opening) {
        opening = this.change().finally(() => { opening = null; });
      }
      return opening;
    },
    async change() {
      guard();
      if (popup && !popup.closed) {
        popup.close();

        return;
      }

      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();

        return;
      }

      if (mobile || !window.documentPictureInPicture?.requestWindow) {
        if (mobile && (video.readyState < 2 || !video.videoWidth || !video.videoHeight)) {
          throw new Error('영상이 준비된 후 다시 시도해주세요.');
        }
        if (!mobile && video.requestPictureInPicture && window.HTMLCanvasElement.prototype.captureStream
          && video.readyState >= 2 && caption) {
          try {
            await composite();

            return;
          } catch {}
        }

        if (video.requestPictureInPicture) {
          await video.requestPictureInPicture();
        }
        else if (video.webkitSetPresentationMode) {
          video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture'
            ? 'inline' : 'picture-in-picture');
        }

        return;
      }

      const target = await window.documentPictureInPicture.requestWindow({
        width: 480,
        height: 270
      });
      const view = target.document;
      const link = view.createElement('link');
      const player = view.createElement('div');
      const placeholder = video.ownerDocument.createElement('div');
      const nodes = [video, subtitle];
      const markers = nodes.map(node => {
        const marker = node.ownerDocument.createComment('pip');

        node.before(marker);

        return marker;
      });
      const controls = video.controls;
      const playing = !video.paused;

      popup = target;
      view.title = title();
      view.body.className = 'pip-window';
      link.rel = 'stylesheet';
      link.href = new URL('./style.css', window.location.href).href;
      view.head.append(link);
      player.className = 'player';
      placeholder.className = 'pip-placeholder';
      placeholder.textContent = 'PIP 모드에서 재생 중';
      markers[0].after(placeholder);
      video.controls = true;

      restore = () => {
        if (popup !== target) {
          return;
        }

        const playing = !video.paused;

        nodes.forEach((node, index) => {
          markers[index].replaceWith(node);
        });
        placeholder.remove();
        video.controls = controls;
        popup = undefined;
        restore = undefined;

        if (playing) {
          void video.play().catch(() => {});
        }

        changed();
      };

      target.addEventListener('pagehide', restore, { once: true });
      player.append(...nodes);
      view.body.append(player);

      if (playing) {
        void video.play().catch(() => {});
      }

      changed();
    },
    close() {
      if (popup && !popup.closed) {
        popup.close();
      }
      restore?.();
      if (document.pictureInPictureElement === video || output
        && document.pictureInPictureElement === output) {
        void document.exitPictureInPicture().catch(() => {});
      }
      if (video.webkitPresentationMode === 'picture-in-picture') {
        video.webkitSetPresentationMode('inline');
      }
      cleanup?.();
    }
  };
}
