import fs from 'fs';
import path from 'path';

export function settingsFile(kind, id, migrate = false, source = `${kind}.json`) {
  if (!/^[a-zA-Z0-9_]{1,50}$/.test(id || '')) {
    throw new Error('스트리머 아이디 오류');
  }

  const file = path.resolve(kind, id, `${kind}.json`);
  const previous = path.resolve(source);

  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (migrate && !fs.existsSync(file) && fs.existsSync(previous)) {
    fs.renameSync(previous, file);
  }

  return file;
}
