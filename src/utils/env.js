import { parse } from 'dotenv';
import { decode } from '#utils/base64';
import * as file from '#utils/file';
import * as log from '#utils/log';

export function parseEnv(name, show = true) {
    try {
        const path = file.find(name);
        if (!path) {
            if (show) {
                log.warn('[환경변수]', `${name} 파일을 찾을 수 없습니다.`);
            }
            return null;
        }

        const env = file.read(path)
            .toString('utf8');
        const parsed = parse(
            decode(env) ?? env
        );

        Object.assign(process.env, parsed);

        for (const k in parsed) {
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
