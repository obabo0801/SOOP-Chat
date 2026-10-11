import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { registerHooks } from 'module';
import * as log from '#utils/log';

function handlerFiles(file) {
  const files = [file];
  for (const folder of [new URL('../', import.meta.url), new URL('../../utils/', import.meta.url)]) {
    for (const name of fs.readdirSync(folder)) {
      if (name.endsWith('.js') && !['editor.js', 'control.js', 'config.js'].includes(name)) {
        files.push(new URL(name, folder));
      }
    }
  }
  files.push(new URL('../config.js', import.meta.url));
  for (const name of ['proxy', 'launch', 'screens', 'storage', 'usage', 'previews', 'visit', 'push', 'media']) {
    files.push(new URL(`./${name}.js`, import.meta.url));
  }
  return files;
}

export async function watchHandler(file, state, sources = handlerFiles(file)) {
  const target = fileURLToPath(file);
  const paths = new Set(sources.map(value => fileURLToPath(value)));
  paths.add(target);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const result = next(specifier, context);
      const version = context.parentURL && new URL(context.parentURL).searchParams.get('revision');
      if (version && result.url.startsWith('file:') && paths.has(fileURLToPath(result.url))) {
        const address = new URL(result.url);
        address.searchParams.set('revision', version);
        return { ...result, url: address.href };
      }
      return result;
    }
  });
  let handler;
  let revision;
  let requested;
  let closed = false;

  const load = async () => {
    const digest = crypto.createHash('sha256');
    for (const source of paths) digest.update(source).update(fs.readFileSync(source));
    const hash = digest.digest('hex');

    if (hash === requested) {
      return;
    }

    requested = hash;
    const address = new URL(file);

    address.searchParams.set('revision', hash);
    let module;
    try {
      module = await import(address.href);
    } catch (error) {
      if (requested === hash) requested = undefined;
      throw error;
    }

    if (closed || requested !== hash) {
      return;
    }

    const next = module.createHandler(state);

    if (typeof next !== 'function') {
      throw new Error('요청 처리 코드 오류');
    }

    handler = next;
    revision = hash;
  };

  try {
    await load();
  } catch (error) {
    hooks.deregister();
    throw error;
  }

  const update = () => {
    void load().catch(error => {
      log.warn('[알림]', '코드 반영 실패', error.message);
    });
  };

  for (const source of paths) fs.watchFile(source, { interval: 500, persistent: false }, update);

  return {
    handle: (request, response) => handler(request, response),
    get revision() {
      return revision;
    },
    close() {
      closed = true;
      for (const source of paths) fs.unwatchFile(source, update);
      hooks.deregister();
    }
  };
}

export function watchStyles(state, files = new Map([
  ['/style.css', new URL('./style.css', import.meta.url)],
  ['/chat.css', new URL('./chat.css', import.meta.url)]
])) {
  state.styles = new Map();
  const watchers = new Map();

  for (const [name, file] of files) {
    const target = fileURLToPath(file);
    const update = () => {
      try {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');

        if (state.styles.get(name) === hash) {
          return;
        }

        state.styles.set(name, hash);

        for (const response of state.pages.keys()) {
          if (!response.destroyed) {
            response.write(`event: style\ndata: ${JSON.stringify([...state.styles])}\n\n`);
          }
        }
      } catch {}
    };

    update();
    watchers.set(target, update);
    fs.watchFile(target, { interval: 500, persistent: false }, update);
  }

  return () => {
    for (const [target, update] of watchers) {
      fs.unwatchFile(target, update);
    }
  };
}
