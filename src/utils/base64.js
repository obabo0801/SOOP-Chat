const BASE64_REGEX = new RegExp(
    '^(?:[A-Za-z0-9+/]{4})*' +
    '(?:[A-Za-z0-9+/]{2}==|' +
    '[A-Za-z0-9+/]{3}=)?$');

function normalize(str) {
    return str.replace(/=+$/, '');
}

function isBase64(str) {
     if (typeof str !== 'string') {
        return false;
    }

    if (!BASE64_REGEX.test(str)) {
        return false;
    }

    const norm = normalize(str);
    const enc = normalize(
        Buffer.from(str, 'base64')
        .toString('utf8')
    );
    
    return norm === enc;
}

export function encode(str) {
    if (!str) return null;

    try {
        return Buffer
            .from(str, 'utf8')
            .toString('base64');
    } catch {
        return str;
    }
}

export function decode(str) {
    if (!str) return null;

    if (!isBase64(str)) {
        return str;
    }
    
    try {
        return Buffer
            .from(str, 'base64')
            .toString('utf8');
    } catch {
        return str;
    }
}