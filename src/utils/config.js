import * as file from '#utils/file';

let config = null;

export function load(name) {
  const path = file.find(name);

  if (!path) {
    throw new Error('설정 파일 없음');
  }

  config = file.json(path);
}

export function get() {
  return config;
}
