import * as identity from './identity.js';

export function createPopups() {
  const search = document.querySelector('.search');
  const nodes = [...document.querySelectorAll('dialog'), ...[
    'chat-manager', 'menu-items', 'settings-menu', 'subtitle-menu', 'qualities'
  ].map(id => document.getElementById(id)).filter(Boolean), search].filter(Boolean);
  const id = identity.create();
  const order = new Map();
  let sequence = 0;
  let frames = [];
  let removing = false;
  let restoring = false;
  let navigating = false;

  const name = node => node === search ? 'search' : node.id;
  const visible = node => node.ownerDocument === document && (node === search
    ? node.classList.contains('expanded') || !document.getElementById('search-panel').hidden
    : node.tagName === 'DIALOG' ? node.open : !node.hidden);
  const current = () => {
    for (const node of nodes) {
      if (visible(node)) {
        if (!order.has(node)) order.set(node, ++sequence);
      }
      else {
        order.delete(node);
      }
    }
    return [...order].sort((a, b) => a[1] - b[1]).map(([node]) => ({
      name: name(node), modal: node.matches(':modal')
    }));
  };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const state = () => ({ ...window.history.state, popup: { id, frames } });
  const sync = () => {
    if (removing || restoring || navigating) return;
    const items = current();
    const previous = frames.at(-1) || [];

    if (equal(items, previous)) return;
    if (!items.length) {
      if (frames.length) {
        removing = true;
        window.history.go(-frames.length);
      }
      return;
    }
    const index = frames.findIndex(frame => equal(frame, items));
    if (index >= 0) {
      removing = true;
      window.history.go(index + 1 - frames.length);
    }
    else if (!previous.length || previous.every(item => items.some(next => next.name === item.name))) {
      frames.push(items);
      window.history.pushState(state(), '');
    }
    else {
      frames[frames.length - 1] = items;
      window.history.replaceState(state(), '');
    }
  };
  const close = node => {
    if (node === search) {
      node.dispatchEvent(new Event('popupclose'));
    }
    else if (node.tagName === 'DIALOG') {
      if (node.dispatchEvent(new Event('cancel', { cancelable: true }))) node.close();
    }
    else {
      node.hidden = true;
    }
  };
  for (const node of nodes) {
    if (node.tagName !== 'DIALOG') continue;
    const button = node.querySelector('button.close');
    if (!button) continue;
    node.addEventListener('click', event => {
      if (event.target !== node) return;
      const bounds = node.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) button.click();
    });
  }
  const observer = new MutationObserver(sync);
  const observe = () => {
    for (const node of nodes) {
      observer.observe(node, { attributes: true, attributeFilter: node === search
        ? ['class'] : ['open', 'hidden'] });
    }
    const panel = document.getElementById('search-panel');
    if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  };

  observe();
  window.addEventListener('popstate', event => {
    const saved = event.state?.popup;
    const target = saved?.id === id ? saved.frames : [];

    if (removing) {
      removing = false;
      frames = target;
      sync();
      return;
    }
    const desired = target.at(-1) || [];
    const previous = frames;
    restoring = true;

    for (const item of current().reverse()) {
      if (!desired.some(next => next.name === item.name)) {
        close(nodes.find(node => name(node) === item.name));
      }
    }
    if (current().some(item => !desired.some(next => next.name === item.name))) {
      frames = previous;
      window.history.pushState(state(), '');
    }
    else {
      frames = target;
      for (const item of desired) {
        const node = nodes.find(node => name(node) === item.name);
        if (!node || visible(node)) continue;
        if (node === search) {
          node.classList.add('expanded');
          document.getElementById('search-input').focus();
        }
        else if (node.tagName === 'DIALOG') {
          item.modal ? node.showModal() : node.show();
        }
        else {
          node.hidden = false;
        }
        node.dispatchEvent(new Event('popuprestore', { bubbles: true }));
      }
    }
    restoring = false;
  });
  window.addEventListener('pagehide', () => observer.disconnect());
  window.addEventListener('popupnavigate', () => {
    navigating = true;
    observer.disconnect();
  });
  window.addEventListener('pageshow', () => { navigating = false; observe(); sync(); });
}
