import fs from 'fs';
import os from 'os';
import path from 'path';
import { DOMAIN } from '#soop/config';
import * as api from '#soop/http';
import { saveRecovery } from './runtime.js';
import { saveStored, removeStored } from './storage.js';

export const screenFile = port => path.join(os.tmpdir(), `soopeditor${port}.screen.json`);

export function screenSession(state, number) {
  if (!Number.isInteger(number) || number < 1 || number > state.range.count) {
    throw new Error('연결 번호를 확인해주세요.');
  }
  const port = state.range.start + number - 1;
  const data = JSON.parse(fs.readFileSync(screenFile(port), 'utf8'));
  if (data.port !== port || data.workspace !== process.cwd()
    || !Number.isInteger(data.pid) || data.pid <= 0 || !/^[a-f0-9]{64}$/.test(data.token)) {
    throw new Error('연결을 확인할 수 없습니다.');
  }
  process.kill(data.pid, 0);
  return data;
}

export function createScreens(state) {
  const port = Number(new URL(state.origin).port);
  const file = screenFile(port);
  let content;
  let checkpoint;
  let account;
  let loading;
  let credentials;
  let login;
  let streamer;
  let streamLoading;
  const identity = client => {
    const cookie = api.cookieString(client.cookie);
    if (cookie !== credentials) {
      credentials = cookie;
      login = null;
      if (cookie && !client.info) {
        const saved = [...state.accounts?.values() || []]
          .find(item => api.cookieString(item.cookie) === cookie);
        login = saved?.info || null;
        if (!login) {
          void api.getPrivateInfo({ ...client.network?.httpOptions, cookie: client.cookie })
            .then(info => { if (credentials === cookie) login = info; })
            .catch(() => { if (credentials === cookie) credentials = undefined; });
        }
      }
    }
    const info = client.info || login;
    const id = info?.IS_LOGIN === 1 ? info.LOGIN_ID : '';
    if (id && account?.id !== id && loading !== id) {
      loading = id;
      void Promise.allSettled([api.getStation(id), api.getStatus(id)]).then(([station, status]) => {
        if (loading !== id) return;
        account = { id, name: station.value?.station?.user_nick || '', image: station.value?.profile_image || new URL(
          `/LOGO/${id.slice(0, 2)}/${encodeURIComponent(id)}/m/${encodeURIComponent(id)}.webp`, DOMAIN.profile
        ).href, emblem: status.value?.DATA?.emblem_img_url || '',
        emblemGrade: status.value?.DATA?.emblem_grade || '',
        emblemLevel: status.value?.DATA?.emblem_level || '' };
        loading = null;
      });
    }
    const user = state.chat.user({ userId: client.userId || id,
      userFlag: state.chat.flag || client.userFlag });
    const months = Number(user.total || user.month || 0);
    user.tierUrl = user.tier && months > 0 ? client.makeTierUrl?.(user.tier, months) || '' : '';
    const saved = state.screenIdentity;
    if (!saved || saved.id !== id || saved.bjId !== client.bjId || client.isOpen?.()) {
      let display = user;
      if (id && !client.isOpen?.()) {
        const ids = new Set([id, ...[...state.chat.users.keys()].filter(value =>
          value.replace(/\(\d+\)$/, '') === id)]);
        const entries = [...ids].flatMap(value => state.chat.history('', value).entries)
          .filter(entry => ['chat', 'ogq'].includes(entry.type))
          .sort((a, b) => b.date.localeCompare(a.date));
        display = entries[0]?.user || user;
      }
      state.screenIdentity = { id, bjId: client.bjId, user: display };
    }
    const display = client.isOpen?.() ? user : state.screenIdentity.user;
    return { ...display, id, image: account?.id === id ? account.image : '',
      emblem: account?.id === id ? account.emblem : '',
      emblemGrade: account?.id === id ? account.emblemGrade : '',
      emblemLevel: account?.id === id ? account.emblemLevel : '',
      name: id ? info.LOGIN_NICK || (account?.id === id ? account.name : '') || ''
        : cookie && !info ? '로그인 확인 중' : '비로그인' };
  };
  const publish = () => {
    const client = state.macro.client;
    const recovery = {
      settings: { bjId: client.bjId || '', broadPw: client.broadPw || '', auto: client.auto,
        videoEnabled: state.videoEnabled !== false,
        scheduled: client.scheduled || 0,
        cookie: client.cookie || '', info: client.info || null, screenPw: state.password },
      editor: { port, range: state.range, token: state.token, accessToken: state.accessToken,
        root: state.root, fixed: Boolean(state.fixed), basicAccount: state.basicAccount || '' },
      accounts: [...state.accounts?.values() || []]
    };
    const snapshot = JSON.stringify(recovery);
    if (checkpoint !== snapshot) {
      saveRecovery(recovery);
      saveStored(recovery);
      checkpoint = snapshot;
    }
    const profile = state.profile?.id === client.bjId ? state.profile
      : streamer?.id === client.bjId ? streamer : null;
    if (client.bjId && !profile && streamLoading !== client.bjId) {
      const id = client.bjId;
      streamLoading = id;
      void api.getStation(id, { ...client.network?.httpOptions }).then(data => {
        if (streamLoading === id && client.bjId === id && data?.station?.user_nick) {
          streamer = { id, image: data.profile_image || '', station: data.station, broad: data.broad };
        }
      }).catch(() => {}).finally(() => {
        if (streamLoading === id) streamLoading = null;
      });
    }
    const connected = Boolean(client.isOpen?.());
    const user = identity(client);
    const name = profile?.station?.user_nick || (client.bjNick !== client.bjId ? client.bjNick : '');
    const image = profile?.image || (client.bjId ? new URL(
      `/LOGO/${client.bjId.slice(0, 2)}/${encodeURIComponent(client.bjId)}/m/${encodeURIComponent(client.bjId)}.webp`, DOMAIN.profile
    ).href : '');
    const ready = Boolean(name && image && (!client.cookie || user.id && user.image && user.name));
    const number = Number(client.channel?.BNO || profile?.broad?.broad_no);
    const preview = number > 0 && client.isOpen?.()
      ? new URL(`/m/${number}`, DOMAIN.thumbnail).href : '';
    const data = {
      port, pid: process.pid, workspace: process.cwd(), token: state.token,
      id: client.bjId || '',
      name: name || '',
      ready,
      title: client.broadcast?.title || profile?.broad?.broad_title || '',
      image: connected ? preview || profile?.broad?.broad_thumb || '' : '',
      profile: image,
      emblem: profile?.status?.emblem_img_url || client.emblem?.url || '',
      emblemGrade: profile?.status?.emblem_grade || client.emblem?.grade || '',
      emblemLevel: profile?.status?.emblem_level || client.emblem?.level || '',
      account: user.name,
      connected,
      viewers: connected ? state.chat.state().viewers ?? Number(profile?.broad?.current_sum_viewer || 0) : null,
      languages: client.channel?.LANG_TAGS || [],
      categories: client.channel?.CATEGORY_TAGS || [],
      hashtags: String(client.broadcast?.hashtag || '').split(/[,#]/).map(tag => tag.trim()).filter(Boolean),
      password: Boolean(state.password),
      fixed: Boolean(state.fixed),
      auto: Boolean(client.auto),
      identity: user
    };
    const next = JSON.stringify(data);

    if (content !== next) {
      const temporary = `${file}.${process.pid}.tmp`;

      fs.writeFileSync(temporary, next, { mode: 0o600 });
      fs.renameSync(temporary, file);
      content = next;
    }
  };
  const remove = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));

      if (data.pid === process.pid && data.token === state.token) {
        fs.unlinkSync(file);
      }
    } catch {}
  };

  publish();
  const timer = setInterval(() => {
    try { publish(); } catch {}
  }, 3000);

  timer.unref();
  process.once('exit', remove);

  return {
    publish,
    list() {
      publish();
      const items = [];
      const { start, count } = state.range;

      for (let next = start; next < start + count; next++) {
        try {
          const data = JSON.parse(fs.readFileSync(screenFile(next), 'utf8'));

          if (!data.ready || !data.id || data.port !== next || data.workspace !== process.cwd()
            || !Number.isInteger(data.pid) || data.pid <= 0 || !/^[a-f0-9]{64}$/.test(data.token)) {
            continue;
          }

          process.kill(data.pid, 0);
          const current = next === port;
          const number = next - start + 1;
          const url = `/${number}/`;

          items.push({ number, id: data.id, name: data.name, title: data.title,
            image: data.image, profile: data.profile, emblem: data.emblem || '',
            emblemGrade: data.emblemGrade || '', emblemLevel: data.emblemLevel || '',
            account: data.account, connected: data.connected,
            viewers: data.connected ? data.viewers ?? 0 : null, languages: data.languages || [], categories: data.categories || [],
            hashtags: data.hashtags || [],
            password: Boolean(data.password), fixed: Boolean(data.fixed), auto: Boolean(data.auto), identity: data.identity, current, url });
        } catch {}
      }

      return items;
    },
    close() {
      clearInterval(timer);
      process.off('exit', remove);
      remove();
      if (state.stopRequested) removeStored(state.root ? 0 : port - state.range.start + 1);
    }
  };
}
