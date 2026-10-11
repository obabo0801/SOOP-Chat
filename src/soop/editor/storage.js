import fs from 'fs';
import path from 'path';

const folder = () => path.join(process.cwd(), 'sessions');
const file = number => path.join(folder(), `${number || 'root'}.json`);

export function upStatus(account, bjId, done = false) {
  if (!account || !bjId) return null;
  const target = path.join(folder(), 'up.json');
  let records = {};
  try { records = JSON.parse(fs.readFileSync(target, 'utf8')); } catch {}
  const now = Date.now();
  const key = `${account}:${bjId}`;
  if (done) {
    records[key] = now;
    fs.mkdirSync(folder(), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(records), { mode: 0o600 });
    fs.renameSync(temporary, target);
  }
  return typeof records[key] === 'number' ? now - records[key] < 86400000 : null;
}

export function readStored(number = 0) {
  try {
    const value = JSON.parse(fs.readFileSync(file(number), 'utf8'));
    return value?.settings && value?.editor ? value : null;
  } catch { return null; }
}

export function saveStored(value) {
  const number = value.editor.root ? 0 : value.editor.port - value.editor.range.start + 1;
  fs.mkdirSync(folder(), { recursive: true });
  const target = file(number);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

export function removeStored(number) {
  fs.rmSync(file(number), { force: true });
}

export function storedScreens(count) {
  return Array.from({ length: count }, (_, index) => ({ number: index + 1, value: readStored(index + 1) }))
    .filter(item => item.value?.settings?.bjId);
}
