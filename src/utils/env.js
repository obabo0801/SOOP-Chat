import fs from 'fs';
import { parse } from 'dotenv';
import { decode } from '#utils/base64';
import * as file from '#utils/file';
import * as log from '#utils/log';

export function parseEnv(name, show = true) {
  const target = name ?? '.env';
  let path = file.find(target);

  if (!path) {
    if (name !== undefined) {
      throw new Error('환경변수 파일 없음');
    }

    path = file.get(target);

    const content =
      [
        'BJID=""',
        'BROADPW=""',
        'USERID=""',
        'PASSWORD=""',
        'SECONDPW=""',
        'WEFLAB=""',
        '',
        'HOST="127.0.0.1"',
        'PORT="0"',
        'ORIGINS=""',
        'ACCESSPW=""',
        '',
        'NTFYTOPIC=""',
        'NTFYTOKEN=""',
        'DEVTOPIC=""',
        'PUSHPUBLIC=""',
        'PUSHPRIVATE=""',
        '',
        'SERVER=""',
        'WEBORIGIN=""',
        'ADDRESS=""',
        'BIND=""',
        'UPSTREAM=""'
      ].join('\n') + '\n';

    try {
      fs.writeFileSync(path, content, { flag: 'wx' });

      return null;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  try {
    const env = file.read(path).toString('utf8');
    const parsed = parse(decode(env) ?? env);

    Object.assign(process.env, parsed);

    for (const k in parsed) {
      if (['ACCESSPW', 'PUSHPUBLIC', 'PUSHPRIVATE'].includes(k)) {
        continue;
      }

      const value = decode(process.env[k]);

      if (value !== null) {
        process.env[k] = value;
      }
    }

    return parsed;
  } catch (error) {
    if (show) {
      log.error('[환경변수]', error);
    }

    return null;
  }
}
