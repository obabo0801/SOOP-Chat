import fs from 'fs';

function defaultTenant(id, env = process.env) {
    return {
        id,
        bjId: '$BJID',
        broadPw: '$BROADPW',
        browser: false,
        idle: true,
        proxy: (env[`PROXY_${id}`]
            ? `$PROXY_${id}` : '$PROXY'
        )
    };
}

export function loadTenants(
    name = process.env.TENANTS_FILE || 'tenants.json'
) {
    try {
        return JSON.parse(
            fs.readFileSync(name, 'utf8')
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            return;
        }

        throw new Error('연결 설정 오류');
    }
}

export function tenantOptions(
    definitions,
    count,
    env = process.env
) {
    if (count !== undefined && (
        !/^\d+$/.test(String(count))
        || !Number.isSafeInteger(Number(count))
        || Number(count) < 1
    )) {
        throw new Error('연결 개수 오류');
    }

    const total = (
        count === undefined
        ? undefined : Number(count)
    );

    if (definitions !== undefined
        && !Array.isArray(definitions)) {
        throw new Error('연결 설정 오류');
    }

    const configured = new Map();

    for (const row of definitions ?? []) {
        if (!Number.isSafeInteger(row?.id)
            || row.id < 1
            || configured.has(row.id)) {
            throw new Error('연결 번호 오류');
        }

        configured.set(row.id, row);
    }

    const rows = (total === undefined && configured.size
        ? [...configured.values()]
        : Array.from({ length: total ?? 1 }, (_, index) => {
            const id = index + 1;

            return configured.get(id) ?? defaultTenant(id, env);
        })
    );

    const resolve = value => {
        return (typeof value === 'string'
            && value.startsWith('$')
            ? env[value.slice(1)] : value
        );
    };

    const bool = value => {
        return (value === true
            || String(value).toLowerCase() === 'true'
        );
    };

    return rows.map(row => {
        const options = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
                key, resolve(value)
            ])
        );

        options.bjId ||= env.BJID;
        options.broadPw ||= env.BROADPW;
        options.browserType ||= env.BROWSER_TYPE || undefined;
        options.userAgent ||= env.USER_AGENT || undefined;

        if (!options.bjId) {
            throw new Error('BJID 없음');
        }

        if (typeof options.cookie === 'string'
            && options.cookie) {
            try {
                options.cookie = JSON.parse(options.cookie);
            } catch {
                throw new Error('쿠키 설정 오류');
            }
        }

        options.browser = bool(options.browser);
        options.idle = (
            options.idle === undefined
            ? true : bool(options.idle)
        );

        return options;
    });
}

export function createTenants(
    count,
    name = process.env.TENANTS_FILE || 'tenants.json',
    env = process.env
) {
    const definitions = loadTenants(name);
    const options = tenantOptions(definitions, count, env);
    const rows = [...definitions ?? []];
    const ids = new Set(rows.map(row => row.id));

    for (const option of options) {
        if (!ids.has(option.id)) {
            rows.push(defaultTenant(option.id, env));
        }
    }

    if (definitions !== undefined && rows.length === definitions.length) {
        return false;
    }

    try {
        fs.writeFileSync(name,
            `${JSON.stringify(rows, null, 4)}\n`,
            { flag: definitions === undefined ? 'wx' : 'w' }
        );
    } catch (error) {
        if (error.code === 'EEXIST') {
            return false;
        }

        throw new Error('연결 설정 오류');
    }

    return true;
}
