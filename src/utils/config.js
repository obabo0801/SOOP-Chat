import * as file from '#utils/file';

let config = null;

export function load(name) {
    const path = file.find(name);
    if (!path) return;
    config = file.json(path);
}

export function get() {
    return config;
}