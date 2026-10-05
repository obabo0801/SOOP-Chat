import fs from 'fs';

function defaultTenant(id) {
  const result = {
    id,
    bjId: '$BJID',
    broadPw: '$BROADPW',
    idle: true
  };

  return result;
}

export function loadTenants(name) {
  const target = name ?? (process.env.TENANTS || 'tenants.json');
  const custom = name !== undefined || Boolean(process.env.TENANTS);

  try {
    const result = JSON.parse(fs.readFileSync(target, 'utf8'));

    return result;
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (custom) {
        throw new Error('연결 설정 파일 없음');
      }

      return;
    }

    throw new Error('연결 설정 오류');
  }
}

export function tenantOptions(definitions, count, env = process.env) {
  if (
    count !== undefined
    && (!/^\d+$/.test(String(count))
      || !Number.isSafeInteger(Number(count))
      || Number(count) < 1)
  ) {
    throw new Error('연결 개수 오류');
  }

  const total = count === undefined ? undefined : Number(count);

  if (definitions !== undefined && !Array.isArray(definitions)) {
    throw new Error('연결 설정 오류');
  }

  const configured = new Map();

  for (const row of definitions ?? []) {
    if (!Number.isSafeInteger(row?.id) || row.id < 1 || configured.has(row.id)) {
      throw new Error('연결 번호 오류');
    }

    configured.set(row.id, row);
  }

  let rows;

  if (total === undefined && configured.size) {
    rows = [...configured.values()];
  }
  else {
    rows = Array.from({ length: total ?? 1 }, (_, index) => {
      const id = index + 1;

      const result = configured.get(id) ?? defaultTenant(id);

      return result;
    });
  }

  const resolve = value => {
    let result;

    if (typeof value === 'string' && value.startsWith('$')) {
      result = env[value.slice(1)];
    }
    else {
      result = value;
    }

    return result;
  };

  const bool = value => {
    const result = value === true || String(value).toLowerCase() === 'true';

    return result;
  };

  const result = rows.map(row => {
    const options = Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !['proxy', 'browser', 'browserType', 'authFile'].includes(key))
        .map(([key, value]) => [key, resolve(value)])
    );

    options.bjId ||= env.BJID;
    options.broadPw ||= env.BROADPW;
    options.userAgent ||= env.USER_AGENT || undefined;

    if (!options.bjId) {
      throw new Error('BJID 없음');
    }

    if (typeof options.cookie === 'string' && options.cookie) {
      try {
        options.cookie = JSON.parse(options.cookie);
      } catch {
        throw new Error('쿠키 설정 오류');
      }
    }

    options.idle = options.idle === undefined ? true : bool(options.idle);

    return options;
  });

  return result;
}

export function createTenants(count, name, env = process.env) {
  const target = name ?? (process.env.TENANTS || 'tenants.json');
  const definitions = loadTenants(name);
  const options = tenantOptions(definitions, count, env);
  const rows = [...(definitions ?? [])];
  const ids = new Set(rows.map(row => row.id));

  for (const option of options) {
    if (!ids.has(option.id)) {
      rows.push(defaultTenant(option.id));
    }
  }

  if (definitions !== undefined && rows.length === definitions.length) {
    return false;
  }

  try {
    fs.writeFileSync(target, `${JSON.stringify(rows, null, 4)}\n`, {
      flag: definitions === undefined ? 'wx' : 'w'
    });
  } catch (error) {
    if (error.code === 'EEXIST') {
      return false;
    }

    throw new Error('연결 설정 오류');
  }

  return true;
}
