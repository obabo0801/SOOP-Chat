import fs from 'fs';
import path from 'path';

const read = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError || error.code === 'ENOENT') return {};
    throw error;
  }
};

export function useEnabled(client, file, fallback = false, value) {
  if (!file) return fallback;
  const id = client.info?.IS_LOGIN === 1 ? client.info.LOGIN_ID : '';
  const folder = path.join(path.dirname(file), 'accounts');
  const target = path.join(folder, `${encodeURIComponent(id || '비로그인')}.json`);
  fs.mkdirSync(folder, { recursive: true });

  if (fallback && id) {
    const owner = path.join(path.dirname(file), 'accounts.json');
    if (!fs.existsSync(owner)) {
      try {
        fs.writeFileSync(owner, JSON.stringify({ id }) + '\n', { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (!fs.existsSync(target) && read(owner)?.id === id) {
      fs.writeFileSync(target, JSON.stringify({ enabled: true }) + '\n', { mode: 0o600 });
    }
  }

  if (typeof value === 'boolean') {
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ enabled: value }) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, target);
    return value;
  }
  if (!fs.existsSync(target)) return false;
  return read(target)?.enabled === true;
}
