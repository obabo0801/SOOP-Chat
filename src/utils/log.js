import * as file from '#utils/file';
import * as time from '#utils/time';

const LEVELS = Object.freeze({
    ALLIM: 'allim',
    INPUT: 'input',
    LOAD: 'load',
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
});

const CONSOLE = Object.freeze({
    [LEVELS.ALLIM]: console.info,
    [LEVELS.INPUT]: console.info,
    [LEVELS.LOAD]: console.info,
    [LEVELS.DEBUG]: console.debug,
    [LEVELS.INFO]: console.info,
    [LEVELS.WARN]: console.warn,
    [LEVELS.ERROR]: console.error
});

const COLORS = Object.freeze({
    [LEVELS.ALLIM]: '\x1b[96m',
    [LEVELS.INPUT]: '\x1b[1m',
    [LEVELS.LOAD]: '\x1b[92m',
    [LEVELS.DEBUG]: '\x1b[90m',
    [LEVELS.INFO]: '\x1b[0m',
    [LEVELS.WARN]: '\x1b[93m',
    [LEVELS.ERROR]: '\x1b[91m',
    RESET: '\x1b[0m'
});

export function append(level, ...args) {
    const type = String(level);
    const arg = args
        .map(a => typeof a === 'object' 
        ? stringify(a) : String(a))
        .join(' ');

    const data = 
        `[${time.getTime()}] ${arg}`;

    return file.append(
        `logs/${time.getDate()}.log`, data);
}

export function send(level, ...args) {
    const type = String(level);
    const arg = args
        .map(a => typeof a === 'object' 
        ? stringify(a) : String(a))
        .join(' ');

    const data = 
        `[${time.getTime()}] ${arg}`;

    const l = CONSOLE[type] ?? console.log;
    const c = COLORS[type] ?? COLORS.RESET;
    l(`${c}${data}${COLORS.RESET}`);

    return file.append(
        `logs/${time.getDate()}.log`, data);
}

export function print(level, ...args) {
    const type = String(level);
    const arg = args
        .map(a => typeof a === 'object' 
        ? stringify(a) : String(a))
        .join(' ');

    const l = CONSOLE[type] ?? console.log;
    const c = COLORS[type] ?? COLORS.RESET;
    l(`${c}${arg}${COLORS.RESET}`);

    return file.append(
        `logs/${time.getDate()}.log`, arg);
}

function stringify(data) {
    return JSON.stringify(data, (_, v) =>
        typeof v === 'bigint'
         ? v.toString() : v);
}

export function strformat(commands, {
    first = '', last = '', col = 5,
    rows = [], join = ' ', line = '\n'} = {}) {
    const v = Object.values(commands);
    for (let i = 0; i < v.length; i += col) {
        rows.push(v.slice(i, i + col).join(join));
    }
    return `${first}${rows.join(line)}${last}`;
}

export function strtemplate(text, values = {}) {
    return String(text).replace(
        /\{(\w+)\}/g, (_, key) =>
        values[key] ?? `{${key}}`);
}

export function clear() { console.clear() }

export function silent(...args) {
    return append(LEVELS.INFO, ...args);
}

export function prompt(...args) {
    return print(LEVELS.INFO, ...args);
}

export function allim(...args) {
    return send(LEVELS.ALLIM, ...args);
}

export function input(...args) {
    return append(LEVELS.INPUT, ...args);
}

export function load(...args) {
    return send(LEVELS.LOAD, ...args);
}

export function debug(...args) {
    return send(LEVELS.DEBUG, ...args);
}

export function info(...args) {
    return send(LEVELS.INFO, ...args);
}

export function warn(...args) {
    return send(LEVELS.WARN, ...args);
}

export function error(...args) {
    return send(LEVELS.ERROR, ...args);
}