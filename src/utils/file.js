import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

export function get(name) {
  if (path.isAbsolute(name)) {
    return name;
  }

  const result = join(process.cwd(), name);

  return result;
}

export function json(name) {
  const file = read(name);

  if (file) {
    return JSON.parse(file);
  }
}

export function join(...args) {
  return path.join(...args);
}

export function find(name) {
  const file = get(name);

  const result = fs.existsSync(file) ? file : null;

  return result;
}

export function exists(name) {
  const result = fs.existsSync(get(name));

  return result;
}

export function read(name) {
  const file = get(name);

  if (fs.existsSync(file)) {
    return fs.readFileSync(file);
  }
}

export function dir(name) {
  const result = fs.readdirSync(get(name), { recursive: true });

  return result;
}

export function url(route, name) {
  const result = pathToFileURL(path.join(get(route), name)).href;

  return result;
}

export function write(name, ...args) {
  const file = get(name);
  const dir = path.dirname(file);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const data = `${args.join(' ')}\n`;

  return fs.writeFileSync(file, data);
}

export function append(name, ...args) {
  const file = get(name);
  const dir = path.dirname(file);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const data = `${args.join(' ')}\n`;

  return fs.appendFileSync(file, data);
}
