import { USER_AGENT } from '#soop/http';

export class Network {
  constructor({ userAgent = USER_AGENT } = {}) {
    this.userAgent = userAgent;
  }

  get httpOptions() {
    const result = {
      headers: {
        'User-Agent': this.userAgent
      },
      signal: this.signal
    };

    return result;
  }

  get socketOptions() {
    const result = {
      headers: {
        'User-Agent': this.userAgent
      }
    };

    return result;
  }
}
