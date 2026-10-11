import { drag } from './scroll.js';

export function createConnect(request, refresh, transition, signin, home = false) {
  const $ = id => document.getElementById(id);
  const dialog = $('connect');
  drag($('connect-modes'));
  drag($('connect-accounts'));
  const report = error => {
    $('connect-message').textContent = error.message;
    if (!$('connect-error').open) $('connect-error').showModal();
  };
  let target;
  let account = 'guest';
  let identity = '';
  let mode = 'switch';
  let number;
  let screens = [];
  let protectedConnection = false;
  let currentPassword = false;
  let resolve;
  let busy = false;
  let initial = false;
  let logging = false;

  const selected = () => {
    const screen = screens.find(item => item.number === number);
    $('connect-switch-password-field').hidden = mode !== 'switch' || !(screen?.password || number === undefined && currentPassword);
    $('connect-password-field').hidden = mode !== 'new' || account === 'guest';
    if (account === 'guest') {
      $('connect-password').value = '';
    }
    for (const button of dialog.querySelectorAll('button[data-account], button[data-mode]')) {
      button.classList.toggle('selected', button.dataset.account
        ? button.dataset.account === account && (account !== 'existing' || button.dataset.identity === identity)
        : button.dataset.mode === mode && (mode !== 'switch' || (button.dataset.number || '') === String(number || '')));
    }
  };
  const accounts = items => {
    for (const card of $('connect-accounts').querySelectorAll('.connect-account')) card.remove();
    for (const item of items) {
      const card = $('connect-account').content.firstElementChild.cloneNode(true);
      const button = card.querySelector('[data-account]');
      const image = button.querySelector('img');
      const logout = card.querySelector('.connect-logout');
      button.dataset.identity = item.id;
      logout.dataset.identity = item.id;
      logout.dataset.locked = String(Boolean(item.configured));
      logout.disabled = Boolean(item.configured);
      button.querySelector('strong').textContent = item.name || item.id;
      button.querySelector('small').textContent = item.id;
      image.hidden = true;
      image.addEventListener('load', () => { image.hidden = false; });
      image.addEventListener('error', () => { image.hidden = true; });
      if (item.image) image.src = item.image.replace(/^http:/, 'https:');
      $('connect-accounts').insertBefore(card, $('connect-accounts').querySelector('[data-account="new"]'));
    }
  };
  const select = async (item = {}) => {
    if (resolve || busy) {
      return false;
    }

    target = item;
    account = 'guest';
    identity = '';
    mode = home ? 'new' : 'switch';
    number = undefined;
    screens = [];
    $('connect-auto').checked = false;
    $('connect-password').value = '';
    $('connect-switch-password').value = '';
    $('connect-scheduled').value = '';
    dialog.querySelector('[data-mode="switch"]').hidden = home;
    $('connect-title').textContent = item.name ? `${item.name} 방송 화면 열기` : '시작하기';
    $('connect-submit').disabled = true;
    selected();
    dialog.showModal();

    const result = new Promise(done => { resolve = done; });

    try {
      const data = await request('GET', undefined, '/api/session');

      if (dialog.open) {
        accounts(data.accounts);
        screens = data.screens || [];
        protectedConnection = Boolean(data.fixed);
        currentPassword = Boolean(data.password);
        if (protectedConnection && mode === 'switch') mode = 'new';
        const current = dialog.querySelector('[data-mode="switch"]');
        current.disabled = protectedConnection;
        current.dataset.locked = String(protectedConnection);
        for (const button of $('connect-modes').querySelectorAll('[data-number]')) button.remove();
        for (const item of screens.filter(item => !item.current)) {
          const button = current.cloneNode(true);
          button.hidden = false;
          button.dataset.number = item.number;
          button.dataset.locked = String(Boolean(item.fixed));
          button.disabled = Boolean(item.fixed);
          button.querySelector('strong').textContent = `${item.number}번 연결`;
          if (item.image) {
            const preview = document.createElement('img');
            preview.className = 'connect-preview';
            preview.alt = '';
            preview.hidden = true;
            preview.addEventListener('load', () => {
              preview.hidden = false;
              button.classList.add('preview');
            });
            preview.addEventListener('error', () => {
              preview.hidden = true;
              button.classList.remove('preview');
            });
            preview.src = item.image.startsWith('//') ? `https:${item.image}` : item.image;
            button.prepend(preview);
          }
          const name = document.createElement('small');
          name.textContent = item.name;
          button.append(name);
          $('connect-modes').append(button);
        }
        selected();

        $('connect-limit').textContent = `최대 ${data.count}개 화면`;
        $('connect-submit').disabled = false;
      }
    } catch (error) {
      report(error);
    }

    return result;
  };

  const openSignin = (previous = { account: 'guest', identity: '' }) => {
    if (logging || busy) return;
    logging = true;
    signin(async login => {
      busy = true;
      try {
        const result = await request('POST', { account: 'new', mode: 'login', login }, '/api/connect');
        if (result.second) return result;
        const data = await request('GET', undefined, '/api/session');
        accounts(data.accounts);
        account = 'existing';
        identity = result.identity;
        logging = false;
        selected();
        return result;
      } finally { busy = false; }
    }, () => {
      logging = false;
      account = previous.account;
      identity = previous.identity;
      selected();
    });
  };
  const finish = result => {
    resolve?.(result);
    resolve = null;
    logging = false;
  };
  const run = async () => {
    busy = true;
    const separate = mode === 'new';
    const window = separate ? globalThis.window.open('about:blank', '_blank') : null;
    let switched = false;

    try {
      const data = await request('POST', {
        id: target.id, account, identity, mode,
        scheduled: $('connect-scheduled').value ? Date.parse($('connect-scheduled').value) : 0,
        number, auto: $('connect-auto').checked, password: $('connect-switch-password').value,
        access: separate && account !== 'guest' ? $('connect-password').value : ''
      }, '/api/connect');

      if (!separate && !data.number) {
        transition();
        switched = true;
      }

      if (separate || data.number) {
        const url = new URL(globalThis.window.location.href);

        url.pathname = `/${data.number}/`;
        url.search = '';
        url.hash = data.token;
        if (window && !window.closed) {
          window.opener = null;
          window.location.replace(url.href);
        }
        else {
          globalThis.window.dispatchEvent(new Event('popupnavigate'));
          globalThis.window.location.assign(url.href);
        }
      }

      finish(true);
      $('connect-password').value = '';

      return data;
    } catch (error) {
      window?.close();
      throw error;
    } finally {
      if (switched) {
        await refresh();
      }

      busy = false;
    }
  };

  dialog.addEventListener('click', event => {
    const logout = event.target.closest('.connect-logout');
    if (logout && !logout.disabled && !busy) {
      void removeAccount(logout);
      return;
    }
    const button = event.target.closest('button[data-account], button[data-mode]');

    if (!button || button.disabled || busy) {
      return;
    }

    const previous = { account, identity };
    if (button.dataset.account) {
      account = button.dataset.account;
      identity = button.dataset.identity || '';
    }
    mode = button.dataset.mode || mode;
    if (button.dataset.mode) {
      number = button.dataset.number ? Number(button.dataset.number) : undefined;
      $('connect-switch-password').value = '';
    }
    selected();
    if (button.dataset.account === 'new') openSignin(previous);
  });
  const removeAccount = async button => {
    busy = true;
    button.disabled = true;
    try {
      await request('DELETE', { id: button.dataset.identity }, '/api/session');
      if (identity === button.dataset.identity) { account = 'guest'; identity = ''; }
      button.closest('.connect-account').remove();
      selected();
    } catch (error) {
      report(error);
      button.disabled = false;
    } finally { busy = false; }
  };
  dialog.addEventListener('cancel', event => {
    if (busy) {
      event.preventDefault();
    }
  });
  $('connect-close').addEventListener('click', () => dialog.close());
  $('connect-auto-help').addEventListener('click', () => $('connect-auto-guide').showModal());
  $('connect-auto-guide-close').addEventListener('click', () => $('connect-auto-guide').close());
  dialog.addEventListener('close', () => {
    if (!busy && !logging) {
      finish(false);
    }
  });
  $('connect-submit').addEventListener('click', async () => {
    if (busy) {
      return;
    }

    if (account === 'new') {
      openSignin();
      return;
    }

    $('connect-submit').disabled = true;
    $('connect-close').disabled = true;

    for (const button of dialog.querySelectorAll('button[data-account], button[data-mode]')) {
      button.disabled = true;
    }

    try {
      const data = await run();

      dialog.close();

      return data;
    } catch (error) {
      report(error);
    } finally {
      $('connect-submit').disabled = false;
      $('connect-close').disabled = false;

      for (const button of dialog.querySelectorAll('button[data-account], button[data-mode]')) {
        button.disabled = button.dataset.locked === 'true';
      }
    }
  });

  return {
    select,
    update(data) {
      if (!initial) {
        initial = true;

        if (!data.player && !data.sessionReady) {
          void select();
        }
      }
    }
  };
}
