const BASE = 'https://weflab.com';

function decode(value = '') {
    return String(value)
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', '\'')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replace(
            /&#(\d+);/g,
            (_, code) =>
                String.fromCodePoint(
                    Number(code)
                )
        )
        .replace(
            /&#x([\da-f]+);/gi,
            (_, code) =>
                String.fromCodePoint(
                    parseInt(code, 16)
                )
        );
}

function attr(tag = '', name = '') {
    const match = tag.match(
        new RegExp(
            `\\b${name}\\s*=\\s*(["'])(.*?)\\1`,
            'i'
        )
    );

    return decode(match?.[2] || '');
}

function url(user = '') {
    const value = String(user).trim();

    if (!value) {
        throw new Error('Weflab 사용자 없음');
    }

    const target = value.startsWith('http')
        ? new URL(value)
        : new URL(
            `/user/${encodeURIComponent(value)}`,
            BASE
        );

    if (
        target.hostname !== 'weflab.com'
        || !target.pathname.startsWith('/user/')
    ) {
        throw new Error('Weflab 주소 오류');
    }

    return target;
}

function parse(html = '') {
    const source = String(html)
        .replace(
            /<script\b[\s\S]*?<\/script>/gi,
            ''
        )
        .replace(
            /<style\b[\s\S]*?<\/style>/gi,
            ''
        );

    const groups = [];

    let group = null;
    let name = '';
    let waiting = false;
    let buffer = '';

    const tokens = source.matchAll(
        /<input\b[^>]*>|<[^>]*>|[^<]+/gi
    );

    for (const match of tokens) {
        const token = match[0];

        if (/^<input\b/i.test(token)) {
            if (waiting) {
                const count = buffer.match(
                    /(\d+)\s*개(?:\s*부터\s*(\d+)\s*개\s*까지)?/
                );

                if (count) {
                    group = {
                        count: Number(count[1]),
                        ...(count[2] ? {
                            maxCount: Number(count[2])
                        } : {}),
                        items: []
                    };

                    groups.push(group);
                } else {
                    group = null;
                }

                name = '';
                waiting = false;
                buffer = '';
            }

            if (!group) {
                continue;
            }

            const placeholder = attr(
                token,
                'placeholder'
            );

            if (placeholder === '룰렛 값') {
                name = attr(token, 'value');
                continue;
            }

            if (
                placeholder === '룰렛 확률'
                && name
            ) {
                const rate = Number(
                    attr(token, 'value')
                );

                if (Number.isFinite(rate)) {
                    group.items.push({
                        name,
                        rate
                    });
                }

                name = '';
            }

            continue;
        }

        if (token.startsWith('<')) {
            continue;
        }

        const text = decode(token)
            .replace(/\s+/g, ' ')
            .trim();

        if (!text) {
            continue;
        }

        if (text.includes('후원 개수')) {
            waiting = true;
            buffer = '';

            continue;
        }

        if (!waiting) {
            continue;
        }

        buffer = `${buffer} ${text}`
            .trim()
            .slice(-100);
    }

    return groups.filter(
        item => item.items.length
    );
}

export async function list(user) {
    const response = await fetch(
        url(user),
        {
            signal: AbortSignal.timeout(
                5000
            )
        }
    );

    if (!response.ok) {
        throw new Error(`Weflab 요청 실패 (${response.status})`);
    }

    return parse(
        await response.text()
    );
}

export function format(roulette, count, numbers = [], title = '') {
    const lines = [
        title
            ? title.replace(/\{개수\}/g, String(count))
            : `[/별풍선_s/ ${count} 룰렛]`
    ];
    const related = numbers.every(Array.isArray)
        ? numbers.find(group => group.includes(count))
        : numbers;

    if (related?.length) {
        lines.push('* ' + [...new Set(related)].join(', '));
    }

    lines.push(...[...roulette.items]
        .sort((a, b) => b.rate - a.rate)
        .map(item => {
            const prefix = /^[\p{L}\p{N}]/u.test(item.name.trimStart()) ? '· ' : '';

            return `${prefix}${item.name} ${item.rate}%`;
        }));

    return lines.join('\n');
}

export async function roulette(
    user,
    count,
    index = 0
) {
    const value = Number(count);

    if (
        !Number.isInteger(value)
        || value < 1
    ) {
        throw new Error('후원 개수 오류');
    }

    const groups = (
        await list(user)
    ).filter(
        item => value >= item.count
            && value <= (item.maxCount ?? item.count)
    );

    const result = groups[index];

    if (!result) {
        throw new Error(`${value}개 룰렛 없음`);
    }

    return result;
}
