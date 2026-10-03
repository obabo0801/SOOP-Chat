import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import * as log from '#utils/log';

const HOME_URL = 'https://www.sooplive.com/';
const LOGIN_URL =
    'https://login.sooplive.com/afreeca/login.php';

const AUTH_FILE = path.join(
    process.cwd(),
    'browser.json'
);

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

function isSoopDomain(domain = '') {
    const host = domain
        .replace(/^\./, '')
        .toLowerCase();

    return (
        host === 'sooplive.com'
        || host.endsWith('.sooplive.com')
        || host === 'afreecatv.com'
        || host.endsWith('.afreecatv.com')
    );
}

async function getCookieObject(context) {
    const cookies = await context.cookies();

    return Object.fromEntries(
        cookies
            .filter(cookie =>
                isSoopDomain(cookie.domain)
            )
            .map(cookie => [
                cookie.name,
                cookie.value
            ])
    );
}

async function waitForAuthTicket(
    context,
    page,
    timeout
) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (page.isClosed()) {
            throw new Error(
                '브라우저가 닫혀 로그인을 취소했습니다.'
            );
        }

        const cookie = await getCookieObject(
            context
        );

        if (cookie.AuthTicket) {
            return cookie;
        }

        await sleep(500);
    }

    throw new Error(
        'SOOP 로그인 시간이 초과되었습니다.'
    );
}

export async function getSoopCookie({
    forceLogin = false,
    timeout = 5 * 60 * 1000,
    browserType = 'chromium',
    authFile = AUTH_FILE,
    proxy,
    userAgent,
    signal
} = {}) {
    signal?.throwIfAborted();

    const saved = (
        !forceLogin
        && fs.existsSync(authFile)
    );

    const engine = {
        chromium, firefox, webkit,
        msedge: chromium
    }[browserType];

    if (!engine) {
        throw new Error('지원하지 않는 브라우저입니다.');
    }

    const proxyUrl = (
        proxy ? new URL(proxy) : null
    );

    const browser = await engine.launch({
        headless: false,
        ...(browserType === 'msedge' ? {
            channel: 'msedge'
        } : {}),
        ...(proxyUrl ? {
            proxy: {
                server: `${proxyUrl.protocol}//${proxyUrl.host}`,
                username: decodeURIComponent(proxyUrl.username),
                password: decodeURIComponent(proxyUrl.password)
            }
        } : {})
    });

    const aborted = () => {
        void browser.close().catch(() => {});
    };

    signal?.addEventListener('abort', aborted, { once: true });

    let context;

    try {
        signal?.throwIfAborted();

        context = await browser.newContext({
            ...(saved ? { storageState: authFile } : {}),
            ...(userAgent ? { userAgent } : {})
        });

        const page = await context.newPage();

        if (saved) {
            await page.goto(HOME_URL, {
                waitUntil: 'domcontentloaded'
            });

            const cookie =
                await getCookieObject(context);

            if (cookie.AuthTicket) {
                await context.storageState({
                    path: authFile
                });

                return cookie;
            }
        }

        await page.goto(LOGIN_URL, {
            waitUntil: 'domcontentloaded'
        });

        log.info(
            '브라우저에서 SOOP 로그인을 완료하세요.'
        );

        await waitForAuthTicket(
            context,
            page,
            timeout
        );

        await page.waitForTimeout(1500);

        await page.goto(HOME_URL, {
            waitUntil: 'domcontentloaded'
        });

        const cookie = await getCookieObject(
            context
        );

        if (!cookie.AuthTicket) {
            throw new Error(
                'SOOP 로그인 쿠키를 가져오지 못했습니다.'
            );
        }

        await context.storageState({
            path: authFile
        });

        return cookie;
    } finally {
        signal?.removeEventListener('abort', aborted);

        await context?.close()
            .catch(() => {});

        if (browser.isConnected()) {
            await browser.close()
                .catch(() => {});
        }
    }
}
