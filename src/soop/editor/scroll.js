export const drag = element => {
  element.classList.add('drag-scroll');
  let pointer;
  let blocked = 0;
  const activate = () => {
    if (!pointer || !element.isConnected) return;
    pointer.active = true;
    element.classList.add('dragging');
    element.setPointerCapture(pointer.id);
  };
  const end = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (pointer.moved) blocked = Date.now() + 500;
    if (element.hasPointerCapture(pointer.id)) element.releasePointerCapture(pointer.id);
    pointer = null;
    element.classList.remove('dragging');
  };
  element.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0 || !event.isPrimary) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
      scroll: element.scrollLeft, active: false, moved: false };
    blocked = 0;
  });
  element.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const x = event.clientX - pointer.x;
    const y = event.clientY - pointer.y;
    if (!pointer.active && Math.max(Math.abs(x), Math.abs(y)) > 5) {
      if (Math.abs(x) > Math.abs(y)) activate();
      else { end(event); return; }
    }
    if (!pointer.active) return;
    if (Math.abs(x) > 5) pointer.moved = true;
    element.scrollLeft = pointer.scroll - x;
    event.preventDefault();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(event, end);
  element.addEventListener('pointerleave', event => { if (!pointer?.active) end(event); });
  element.addEventListener('dragstart', event => event.preventDefault());
  element.addEventListener('contextmenu', event => { if (pointer?.active) event.preventDefault(); });
  element.addEventListener('click', event => {
    if (Date.now() > blocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
};
