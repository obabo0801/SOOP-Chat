import fs from 'fs';
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

let buffered = false;
const streams = new Map();

export function buffer() {
    fs.mkdirSync(file.get('logs'), { recursive: true });
    buffered = true;
}

function write(data) {
    const name = `logs/${time.getDate()}.log`;

    if (!buffered) {
        return file.append(name, data);
    }

    if (!streams.has(name)) {
        const stream = fs.createWriteStream(file.get(name), { flags: 'a' });
        stream.on('error', () => {
            console.error('로그 기록 실패');
        });

        streams.set(name, stream);
    }

    streams.get(name).write(`${data}\n`);
}

export async function flush() {
    await Promise.all([...streams.values()].map(stream => {
        return new Promise((resolve, reject) => {
            if (stream.errored) {
                reject(stream.errored);

                return;
            }

            stream.once('error', reject);
            stream.end(resolve);
        });
    }));

    streams.clear();
    buffered = false;
}

function formatArgs(args) {
    return args
        .map(value => {
            if (value instanceof Error) {
                return value.message || value.name;
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

    return write(data);
}

export function send(level, ...args) {
    const type = String(level);
    const arg = formatArgs(args);

    const data =
        `[${time.getTime()}] [${type}] ${arg}`;

    const l = CONSOLE[type] ?? console.log;
    const c = COLORS[type] ?? COLORS.RESET;
    l(`${c}${data}${COLORS.RESET}`);

    return write(data);
}

export function print(level, ...args) {
    const type = String(level);
    const arg = formatArgs(args);

    const l = CONSOLE[type] ?? console.log;
    const c = COLORS[type] ?? COLORS.RESET;
    l(`${c}${arg}${COLORS.RESET}`);

    return write(arg);
}

export function table(data) {
    const names = {
        result: '결과',
        connected: '접속',
        connecting: '연결 중',
        authenticated: '로그인',
        idle: '접속 유지',
        error: '오류'
    };
    const entries = Object.entries(data);
    const keys = [...new Set(entries.flatMap(([, row]) => Object.keys(row)))];
    const headers = ['번호', ...keys.map(key => names[key] || key)];
    const rows = entries.map(([index, row]) => [
        index, ...keys.map(key => row[key] == null ? '' : String(row[key]))
    ]);
    const wide = new RegExp([
        '[',
        '\\u1100-\\u115f\\u2329\\u232a',
        '\\u2e80-\\ua4cf\\uac00-\\ud7a3',
        '\\uf900-\\ufaff\\ufe10-\\ufe19\\ufe30-\\ufe6f',
        '\\uff01-\\uff60\\uffe0-\\uffe6',
        ']|\\p{Extended_Pictographic}'
    ].join(''), 'u');
    const width = text => {
        let size = 0;

        for (const char of text) {
            if (/\p{Mark}/u.test(char)) {
                continue;
            }

            size += wide.test(char) ? 2 : 1;
        }

        return size;
    };
    const sizes = headers.map((header, index) => rows.reduce((size, row) => {
        return Math.max(size, ...row[index].split('\n').map(width));
    }, width(header)));
    const border = (left, middle, right) => {
        return left + sizes.map(size => '─'.repeat(size + 2)).join(middle) + right;
    };
    const line = row => {
        return '│ ' + row.map((cell, index) => {
            return cell + ' '.repeat(sizes[index] - width(cell));
        }).join(' │ ') + ' │';
    };
    const output = [
        border('┌', '┬', '┐'),
        line(headers)
    ];

    for (const row of rows) {
        output.push(border('├', '┼', '┤'));

        const cells = row.map(cell => cell.split('\n'));
        const height = Math.max(...cells.map(cell => cell.length));

        for (let index = 0; index < height; index++) {
            output.push(line(cells.map(cell => cell[index] || '')));
        }
    }

    output.push(border('└', '┴', '┘'));
    process.stdout.write(output.join('\n') + '\n');
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

export function clear() {
    console.clear();
}

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
