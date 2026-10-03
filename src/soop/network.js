import { ProxyAgent } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';

import {
    USER_AGENT
} from '#soop/http';

export class Network {
    constructor({
        proxy,
        userAgent = USER_AGENT
    } = {}) {
        this.userAgent = userAgent;
        this.proxy = proxy || null;

        if (this.proxy) {
            const url = new URL(this.proxy);

            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new Error('프록시 주소 오류');
            }

            this.dispatcher = new ProxyAgent(this.proxy);
            this.agent = new HttpsProxyAgent(this.proxy);
        }
    }

    get httpOptions() {
        return {
            headers: {
                'User-Agent': this.userAgent
            },
            dispatcher: this.dispatcher,
            signal: this.signal
        };
    }

    get socketOptions() {
        return {
            headers: {
                'User-Agent': this.userAgent
            },
            agent: this.agent
        };
    }

    async close() {
        this.agent?.destroy();
        await this.dispatcher?.close();
    }
}
