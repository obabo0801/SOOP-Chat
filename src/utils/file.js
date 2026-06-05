import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

export function get(name) {
    if (path.isAbsolute(name)) {
        return name;
    }

    return join(process.cwd(), name);
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
    if (exists(name)) return name;
    return dir('.').filter(f =>
        path.basename(f) === name)
        .map(get)[0] || null;
}

export function exists(name) {
    return fs.existsSync(get(name));
}

export function read(name) {
    const file = get(name);

    if (fs.existsSync(file)) {
        return fs.readFileSync(file);
    }
}

export function dir(name) {
    return fs.readdirSync(get(name),
        { recursive: true }
    );
}

export function url(route, name) {
    return pathToFileURL(
        path.join(get(route), name)).href;
}

export function write(name, ...args) {
    const file = get(name);
    const dir = path.dirname(file);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir,
            { recursive: true }
        );
    }

    const data = `${args.join(' ')}\n`;
    return fs.writeFileSync(file, data);
}

export function append(name, ...args) {
    const file = get(name);
    const dir = path.dirname(file);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir,
            { recursive: true }
        );
    }

    const data = `${args.join(' ')}\n`;
    return fs.appendFileSync(file, data);
}