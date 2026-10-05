import {
    USER_AGENT
} from '#soop/http';

export class Network {
    constructor({
        userAgent = USER_AGENT
    } = {}) {
        this.userAgent = userAgent;
    }

    get httpOptions() {
        return {
            headers: {
                'User-Agent': this.userAgent
            },
            signal: this.signal
        };
    }

    get socketOptions() {
        return {
            headers: {
                'User-Agent': this.userAgent
            }
        };
    }
}
