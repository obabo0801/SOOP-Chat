import * as file from '#utils/file';
import * as time from '#utils/time';

const LEVELS = Object.freeze({
    TITLE: 'title',
    LIST: 'list',
    CMD: 'cmd',
    INPUT: 'input',
    LOAD: 'load',
    READY: 'ready',
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
});

const CONSOLE = Object.freeze({
    [LEVELS.TITLE]: console.info,
    [LEVELS.LIST]: console.info,
    [LEVELS.CMD]: console.info,
    [LEVELS.INPUT]: console.info,
    [LEVELS.LOAD]: console.info,
    [LEVELS.READY]: console.info,
    [LEVELS.DEBUG]: console.debug,
    [LEVELS.INFO]: console.info,
    [LEVELS.WARN]: console.warn,
    [LEVELS.ERROR]: console.error
});

const COLORS = Object.freeze({
    [LEVELS.TITLE]: '\x1b[97m',
    [LEVELS.LIST]: '\x1b[1m',
    [LEVELS.CMD]: '\x1b[96m',
    [LEVELS.INPUT]: '\x1b[1m',
    [LEVELS.LOAD]: '\x1b[92m',
    [LEVELS.READY]: '\x1b[1m',
    [LEVELS.DEBUG]: '\x1b[90m',
    [LEVELS.INFO]: '\x1b[0m',
    [LEVELS.WARN]: '\x1b[93m',
    [LEVELS.ERROR]: '\x1b[91m',
    RESET: '\x1b[0m'
});

function formatArgs(args) {
    return args
        .map(value => {
            if (value instanceof Error) {
                return value.stack
                    || value.message
                    || value.name;
            }

            return typeof value === 'object'
                ? stringify(value)
                : String(value);
        })
        .join(' ');
}

export function append(level, ...args) {
    const type = String(level);
    const arg = formatArgs(args);

    const data = 
        `[${time.getTime()}] [${type}] ${arg}`;

    return file.append(
        `logs/${time.getDate()}.log`, data);
}

export function send(level, ...args) {
    const type = String(level);
    const arg = formatArgs(args);

    const data = 
        `[${time.getTime()}] [${type}] ${arg}`;

    const l = CONSOLE[type] ?? console.log;
    const c = COLORS[type] ?? COLORS.RESET;
    l(`${c}${data}${COLORS.RESET}`);

    return file.append(
        `logs/${time.getDate()}.log`, data);
}

export function print(level, ...args) {
    const type = String(level);
    const arg = formatArgs(args);

    const l = CONSOLE[type] ?? console.log;
    const c = COLORS[type] ?? COLORS.RESET;
    l(`${c}${arg}${COLORS.RESET}`);

    return file.append(
        `logs/${time.getDate()}.log`, arg);
}

function stringify(data) {
    try {
        return JSON.stringify(data, (_, value) =>
            typeof value === 'bigint'
                ? value.toString()
                : value
        );
    } catch {
        return String(data);
    }
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

export function title(...args) {
    return print(LEVELS.TITLE, ...args);
}

export function silent(...args) {
    return append(LEVELS.INFO, ...args);
}

export function prompt(...args) {
    return print(LEVELS.INFO, ...args);
}

export function list(...args) {
    return print(LEVELS.LIST, ...args);
}

export function cmd(...args) {
    return send(LEVELS.CMD, ...args);
}

export function input(...args) {
    return append(LEVELS.INPUT, ...args);
}

export function load(...args) {
    return send(LEVELS.LOAD, ...args);
}

export function ready(...args) {
    return send(LEVELS.READY, ...args);
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