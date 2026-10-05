import fs from 'fs';
import path from 'path';
import { SoopHistory } from '#soop/history';
import { checkFlag } from '#soop/handler';
import * as weflab from '#utils/weflab';

const EVENTS = {
    balloon: '별풍선',
    adcon: '애드벌룬',
    videoBalloon: '영상 풍선',
    vodBalloon: 'VOD 별풍선',
    vodAdcon: 'VOD 애드벌룬',
    stationAdcon: '방송국 애드벌룬',
    sticker: '스티커',
    quickview: '퀵뷰',
    subscription: '구독권',
    follow: '구독',
    subCeremony: '구독 갱신',
    ogqGift: 'OGQ 선물',
    challenge: '도전미션',
    battle: '대결미션',
    missionSettle: '미션 정산'
};

export class SoopMacro {
    constructor(client, options = {}) {
        this.client = client;
        this.options = options;
        this.file = options.file === false
            ? null
            : path.resolve(options.file || 'macros.json');

        this.config = {
            enabled: false,
            rules: []
        };
        this.rules = [];

        this.events = new Map();
        this.cooldowns = new Map();
        this.queue = Promise.resolve();
        this.timer = null;
        this.closed = false;
        this.allowed = null;

        if (this.file) {
            if (!fs.existsSync(this.file)) {
                fs.mkdirSync(path.dirname(this.file), { recursive: true });
                fs.writeFileSync(this.file, JSON.stringify({
                    enabled: false,
                    rules: [{
                        name: '명령어',
                        kind: 'command',
                        pattern: '!명령어',
                        action: 'reply',
                        reply: '!명령어',
                        cooldown: 5
                    }],
                    history: { remarks: [] }
                }, null, 4) + '\n');
            }

            this.load();

            this.watcher = () => {
                if (this.closed) {
                    return;
                }

                try {
                    this.load();
                    this.client.emit('macro', {
                        type: 'load',
                        message: '수정 완료'
                    });
                } catch (error) {
                    this.client.emit('error', error);
                }
            };

            fs.watchFile(this.file, { interval: 1000 }, this.watcher);
        }
        else {
            this.update(options.config || this.config);
        }

        this.history = options.history === false
            ? null
            : new SoopHistory(client, {
                ...this.config.history,
                ...(options.history || {})
            });

        this.on('chat', data => {
            return this.handle(data);
        });

        this.on('managerChat', data => {
            return this.handle(data, 'chat', true);
        });

        this.on('ogq', data => {
            return this.handle(data);
        });

        this.on('join', () => {
            this.allowed = null;
        });

        for (const event of ['subBj', 'userFlag']) {
            this.on(event, data => {
                if (this.isSelf(data.userId)) {
                    this.allowed = Boolean(data.flag.isBJ || data.flag.isManager);
                }
            });
        }

        this.on('chuser', data => {
            if (data.type === 1) {
                this.handleEvent('enter', {
                    ...data.user,
                    userId: data.user.id,
                    userNick: data.user.name
                });
            }
        });

        for (const event of Object.keys(EVENTS)) {
            this.on(event, data => {
                return this.handleEvent(event, data);
            });
        }
    }

    on(event, handler) {
        this.events.set(event, handler);
        this.client.on(event, handler);
    }

    load() {
        let config;

        try {
            config = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch {
            throw new Error('매크로 설정 오류');
        }

        this.update(config);
    }

    update(config) {
        if (
            !config
            || typeof config.enabled !== 'boolean'
            || !Array.isArray(config.rules)
        ) {
            throw new Error('매크로 설정 오류');
        }

        const ids = new Set();

        const rules = config.rules.map((rule, index) => {
            if (
                !rule
                || typeof rule !== 'object'
                || Array.isArray(rule)
            ) {
                throw new Error('매크로 규칙 오류');
            }

            const id = String(rule.id || index + 1);
            const kind = rule.kind === 'timer'
                ? 'interval'
                : rule.kind || 'command';
            const action = rule.action || 'reply';
            const cooldown = Number(rule.cooldown ?? 5);
            const interval = Number(rule.interval ?? 300);
            const patterns = Array.isArray(rule.pattern)
                ? rule.pattern
                : [rule.pattern];

            if (
                ids.has(id)
                || !['command', 'text', 'regex', 'event', 'interval'].includes(kind)
                || !['reply', 'roulette', 'mute', 'kick', 'warn'].includes(action)
                || (rule.enabled !== undefined && typeof rule.enabled !== 'boolean')
                || (rule.commands !== undefined && typeof rule.commands !== 'boolean')
                || (rule.edit !== undefined && typeof rule.edit !== 'boolean')
                || (
                    rule.reply !== undefined
                    && typeof rule.reply !== 'string'
                    && (
                        !Array.isArray(rule.reply)
                        || rule.reply.some(line => typeof line !== 'string')
                    )
                )
                || (!patterns.length && rule.enabled !== false)
                || patterns.some(pattern =>
                    typeof pattern !== 'string'
                    || (!pattern && kind !== 'interval')
                )
                || !Number.isFinite(cooldown)
                || cooldown < 0
                || !Number.isFinite(interval)
                || interval < 1
                || !['all', 'manager', 'streamer'].includes(rule.access || 'all')
                || !['both', 'chat', 'console'].includes(rule.input || 'both')
                || !['chat', 'manager', 'direct'].includes(rule.output || 'chat')
            ) {
                throw new Error(`매크로 규칙 오류 (${rule.name || id})`);
            }

            ids.add(id);

            let regexes;

            if (kind === 'regex') {
                try {
                    regexes = patterns.map(value => {
                        const expression = /[\\^$.*+?()[\]{}|]/.test(value);
                        const pattern = expression
                            ? value
                            : `(^|[^\\p{L}\\p{N}_])${value}(?=$|[^\\p{L}\\p{N}_])`;
                        const flags = expression
                            ? rule.flags || 'i'
                            : [...new Set((rule.flags || 'i') + 'u')].join('');

                        return new RegExp(pattern, flags);
                    });
                } catch {
                    throw new Error(`정규식 오류 (${rule.name || id})`);
                }
            }

            const ogq = typeof rule.ogq === 'string'
                ? /^(.+?)\s+([1-9]\d*)$/.exec(rule.ogq.trim())
                : null;

            if (rule.ogq && (!ogq || !Number.isSafeInteger(Number(ogq[2])))) {
                throw new Error(`OGQ 설정 오류 (${rule.name || id})`);
            }

            if (rule.numbers !== undefined) {
                const numbers = rule.numbers;
                const groups = Array.isArray(numbers) && numbers.every(Array.isArray)
                    ? numbers
                    : [numbers];

                if (
                    groups.some(group =>
                        !Array.isArray(group)
                        || group.some(number =>
                            !Number.isSafeInteger(number)
                            || number < 1
                        )
                    )
                ) {
                    throw new Error(`룰렛 번호 설정 오류 (${rule.name || id})`);
                }
            }

            if (action === 'roulette') {
                const ranges = rule.ranges;
                const index = rule.index;

                if (
                    (rule.title !== undefined && typeof rule.title !== 'string')
                    || (
                        rule.default !== undefined
                        && (!Number.isSafeInteger(rule.default) || rule.default < 1)
                    )
                    || (
                        ranges !== undefined
                        && (
                            !Array.isArray(ranges)
                            || !ranges.length
                            || ranges.some(range =>
                                !Array.isArray(range)
                                || range.length !== 2
                                || range.some(number =>
                                    !Number.isSafeInteger(number)
                                    || number < 1
                                )
                                || range[0] > range[1]
                            )
                        )
                    )
                    || (
                        index !== undefined
                        && (
                            typeof index === 'number'
                                ? !Number.isSafeInteger(index) || index < 0
                                : !index
                                    || typeof index !== 'object'
                                    || Array.isArray(index)
                                    || Object.entries(index).some(([number, value]) =>
                                        !/^[1-9]\d*$/.test(number)
                                        || !Number.isSafeInteger(value)
                                        || value < 0
                                    )
                        )
                    )
                ) {
                    throw new Error(`룰렛 설정 오류 (${rule.name || id})`);
                }

                if (
                    rule.default !== undefined
                    && !this.matchesRoulette(rule, String(rule.default))
                ) {
                    throw new Error(`룰렛 설정 오류 (${rule.name || id})`);
                }
            }

            const count = Number(rule.count ?? 0);

            if (
                action === 'mute'
                && (!Number.isSafeInteger(count) || count < 0 || count > 3)
            ) {
                throw new Error(`채금 횟수 오류 (${rule.name || id})`);
            }

            return {
                ...rule,
                id,
                kind,
                action,
                cooldown,
                interval,
                patterns,
                regexes,
                count,
                ogqName: ogq?.[1],
                ogqNumber: ogq ? Number(ogq[2]) : undefined
            };
        });

        if (
            config.history?.remarks
            && (
                !Array.isArray(config.history.remarks)
                || config.history.remarks.some(item =>
                    !item
                    || !item.name
                    || !Array.isArray(item.words)
                    || item.words.some(word =>
                        typeof word !== 'string'
                        || !word.trim()
                    )
                )
            )
        ) {
            throw new Error('비고 설정 오류');
        }

        this.config = config;
        this.rules = rules;
        this.cooldowns.clear();

        if (this.history) {
            this.history.remarks = this.options.history?.remarks
                || config.history?.remarks
                || [];
        }

        clearInterval(this.timer);
        this.timer = null;

        if (rules.some(rule => rule.kind === 'interval' && this.isEnabled(rule))) {
            this.timer = setInterval(() => {
                for (const rule of this.rules) {
                    if (rule.kind === 'interval' && this.isEnabled(rule)) {
                        this.enqueue(rule, { source: 'event' }, {}, rule.interval);
                    }
                }
            }, 1000);
        }
    }

    setEnabled(enabled) {
        if (typeof enabled !== 'boolean') {
            throw new Error('매크로 설정 오류');
        }

        this.save({ ...this.config, enabled });
    }

    save(config) {
        if (this.file) {
            const temporary = this.file + '.tmp';

            fs.writeFileSync(temporary, JSON.stringify(config, null, 4) + '\n');
            fs.renameSync(temporary, this.file);
        }

        this.update(config);
    }

    isEnabled(rule) {
        const reply = Array.isArray(rule.reply)
            ? rule.reply.join('\n')
            : String(rule.reply || '');

        return rule.enabled !== false
            && (rule.action !== 'reply' || Boolean(reply.trim() || rule.ogq));
    }

    list() {
        return this.rules.map(rule => ({
            이름: rule.name || rule.id,
            사용: this.isEnabled(rule) ? '켜짐' : '꺼짐',
            종류: {
                command: '명령어',
                text: '자동답변',
                regex: '자동답변',
                event: '이벤트',
                interval: '주기'
            }[rule.kind],
            규칙: rule.patterns.join('\n'),
            동작: rule.action === 'mute' && !rule.count
                ? '경고'
                : {
                    reply: '답변',
                    roulette: '룰렛',
                    mute: '채금',
                    kick: '강퇴',
                    warn: '경고'
                }[rule.action]
        }));
    }

    isSelf(userId) {
        const normalize = id => String(id || '').replace(/\(\d+\)$/, '');

        return Boolean(
            userId
            && this.client.userId
            && normalize(userId) === normalize(this.client.userId)
        );
    }

    canSend() {
        const flag = checkFlag(this.client.userFlag);
        const user = [...this.client.userList.values()].find(item => this.isSelf(item.id));
        const allowed = this.allowed ?? Boolean(
            flag.isBJ
            || flag.isManager
            || user?.isBJ
            || user?.isManager
            || ['스트리머', '매니저'].includes(user?.role)
        );

        return !this.closed
            && this.config.enabled
            && !this.client.idle
            && this.client.isOpen()
            && Number(this.client.info?.IS_LOGIN) === 1
            && allowed;
    }

    access(rule, data) {
        if ((rule.access || 'all') === 'all' || data.source === 'console') {
            return true;
        }

        const user = this.client.userList.get(data.userId);
        const role = data.role || user?.role;

        return rule.access === 'streamer'
            ? role === '스트리머'
            : ['스트리머', '매니저'].includes(role);
    }

    matchesRoulette(rule, args) {
        if (!args) {
            return rule.default !== undefined;
        }

        return !rule.ranges || rule.ranges.some(([start, end]) => {
            return Number(args) >= start && Number(args) <= end;
        });
    }

    async replyManager(message) {
        try {
            if (!await this.client.sendManagerChat(message)) {
                throw new Error('매니저 채팅 전송 실패');
            }
        } catch (error) {
            this.client.emit('error', error);
        }
    }

    async handle(data, source = 'chat', manager = false) {
        if (data.test || this.closed) {
            return false;
        }

        const message = String(data.message || '').trim();
        const command = message.split(/\s+/)[0];
        const args = message.slice(command.length).trim();
        const context = { ...data, message, source };
        const forward = /^(!공지|!시간)(?:\/|\s|$)([\s\S]*)$/.exec(message);
        const edit = rule => {
            return rule.kind === 'command'
                && rule.action === 'reply'
                && rule.edit
                && rule.patterns.some(pattern => {
                    return pattern.toLowerCase() === command.toLowerCase();
                });
        };

        if (manager && forward && this.access({ access: 'manager' }, context)) {
            if (!this.canSend()) {
                return false;
            }

            try {
                const name = forward[1];
                const content = forward[2].trim();
                const reply = content
                    ? `${name}/${content}`
                    : { '!공지': '!공지/삭제', '!시간': '!시간/업타임' }[name];

                if (!await this.client.sendChat(reply)) {
                    throw new Error('채팅 전송 실패');
                }

                this.client.emit('macro', {
                    type: 'send',
                    rule: name,
                    message: reply
                });

                const reset = !content
                    || content === (name === '!공지' ? '삭제' : '업타임');
                const status = reset
                    ? (name === '!공지' ? '삭제 완료' : '업타임 전환')
                    : '수정 완료';
                const icon = reset ? '/개털림/' : '/개번쩍/';
                const response = [
                    `${icon} [${name}] ${status}`,
                    reset ? '' : content
                ].filter(Boolean).join('\n');

                await this.replyManager(response);

                return true;
            } catch (error) {
                await this.replyManager(`[${forward[1]}] 처리 실패`);
                this.client.emit('error', error);

                return false;
            }
        }

        if (
            manager
            && this.access({ access: 'manager' }, context)
            && this.rules.some(edit)
        ) {
            try {
                if (this.file) {
                    this.load();
                }

                const index = this.rules.findIndex(edit);

                if (index >= 0) {
                    this.save({
                        ...this.config,
                        rules: this.config.rules.map((rule, number) => number === index
                            ? { ...rule, reply: args.replace(/\\r\\n|\\n/g, '\n') }
                            : rule
                        )
                    });

                    const status = args ? '수정 완료' : '삭제 완료';
                    const reply = this.config.rules[index].reply;
                    const icon = args ? '/개번쩍/' : '/개털림/';
                    const response = [
                        `${icon} [${command}] ${status}`,
                        reply
                    ].filter(Boolean).join('\n');

                    this.client.emit('macro', {
                        type: 'load',
                        message: status
                    });

                    await this.replyManager(response);

                    return true;
                }
            } catch (error) {
                await this.replyManager(`[${command}] 처리 실패`);
                this.client.emit('error', error);

                return false;
            }
        }

        if (source === 'chat' && this.isSelf(data.userId)) {
            return false;
        }

        for (const rule of this.rules) {
            if (
                !this.isEnabled(rule)
                || ['event', 'interval'].includes(rule.kind)
                || (rule.input && rule.input !== 'both' && rule.input !== source)
                || !this.access(rule, context)
            ) {
                continue;
            }

            let match;

            if (rule.kind === 'command') {
                if (!rule.patterns.some(pattern => {
                    return message.split(/\s+/)[0].toLowerCase() === pattern.toLowerCase();
                })) {
                    continue;
                }

                match = { args };

                if (
                    rule.action === 'roulette'
                    && !this.matchesRoulette(rule, match.args)
                ) {
                    continue;
                }
            }
            else if (rule.kind === 'text') {
                if (
                    !rule.patterns.some(pattern =>
                        message.toLowerCase().includes(pattern.toLowerCase())
                    )
                ) {
                    continue;
                }
            }
            else {
                let result;

                for (const regex of rule.regexes) {
                    regex.lastIndex = 0;
                    result = regex.exec(message);

                    if (result) {
                        break;
                    }
                }

                if (!result) {
                    continue;
                }

                match = Object.fromEntries(
                    result.map((value, index) => [index, value || ''])
                );
            }

            return this.enqueue(rule, context, match || {});
        }

        return false;
    }

    handleEvent(event, data) {
        if (data.test || this.closed) {
            return;
        }

        if (event === 'missionSettle') {
            for (const [userId, userNick, count] of data.list || []) {
                this.handleEvent('mission', { ...data, userId, userNick, count });
            }

            return;
        }

        const names = [event === 'mission' ? 'missionSettle' : event];

        if (event === 'challenge') {
            names[0] = {
                CHALLENGE_GIFT: 'challengeGift',
                CHALLENGE_SETTLE: 'challengeSettle'
            }[data.type];
        }
        else if (event === 'battle') {
            names[0] = { GIFT: 'battleGift', SETTLE: 'battleSettle' }[data.type];
        }

        if (event === 'balloon' && data.fanOrder > 0) {
            names.push('fanClub');
        }

        if (event === 'balloon' && data.topFan > 0) {
            names.push('topFan');
        }

        for (const rule of this.rules) {
            if (
                rule.kind === 'event'
                && this.isEnabled(rule)
                && rule.patterns.some(pattern => names.includes(pattern))
            ) {
                this.enqueue(rule, {
                    ...data,
                    source: 'event',
                    donation: EVENTS[event] || '별풍선'
                });
            }
        }
    }

    enqueue(rule, data, match = {}, cooldown = rule.cooldown) {
        if (!this.canSend() || !this.isEnabled(rule) || !this.access(rule, data)) {
            return Promise.resolve(false);
        }

        const now = Date.now();
        const key = rule.action === 'roulette'
            ? `${rule.id}:${Number(match.args || rule.default)}`
            : rule.id;
        const last = this.cooldowns.get(key);

        if (last !== undefined && now - last < cooldown * 1000) {
            return Promise.resolve(false);
        }

        this.cooldowns.delete(key);
        this.cooldowns.set(key, now);

        while (this.cooldowns.size > 1000) {
            this.cooldowns.delete(this.cooldowns.keys().next().value);
        }

        this.queue = this.queue.then(async () => {
            if (!this.canSend() || !this.rules.includes(rule)) {
                return false;
            }

            return this.run(rule, data, match);
        }).catch(error => {
            this.client.emit('error', error);

            return false;
        });

        return this.queue;
    }

    async run(rule, data, match) {
        const warning = rule.action === 'warn'
            || (rule.action === 'mute' && !rule.count);

        if (['mute', 'kick', 'warn'].includes(rule.action)) {
            const user = this.client.userList.get(data.userId);

            if (
                data.source !== 'chat'
                || !data.userId
                || ['스트리머', '매니저'].includes(data.role || user?.role)
                || data.isBJ
                || data.isManager
                || user?.isBJ
                || user?.isManager
            ) {
                return false;
            }

            if (!warning) {
                const reason = rule.reason || rule.name || '자동관리';
                let result = true;

                for (
                    let count = 0;
                    count < (rule.action === 'mute' ? rule.count : 1);
                    count++
                ) {
                    if (!this.canSend() || !this.rules.includes(rule)) {
                        return false;
                    }

                    result = rule.action === 'mute'
                        ? await this.client.sendDumb(data.userId, reason)
                        : await this.client.sendKick(data.userId, 0, reason);

                    if (!result) {
                        throw new Error('자동관리 요청 실패');
                    }
                }

                const reply = Array.isArray(rule.reply)
                    ? rule.reply.join('\n')
                    : String(rule.reply || '');

                if (!reply.trim() && !rule.ogq) {
                    this.client.emit('macro', {
                        type: 'send',
                        rule: rule.name || rule.id,
                        message: reason
                    });

                    return result;
                }
            }
        }

        let reply = Array.isArray(rule.reply)
            ? rule.reply.join('\n')
            : String(rule.reply || '');

        if (warning && !reply.trim()) {
            reply = '{이름}님, 채팅 내용을 주의해주세요.';
        }

        if (rule.commands) {
            const commands = new Set(this.rules
                .filter(item =>
                    item.kind === 'command'
                    && this.isEnabled(item)
                    && item.input !== 'console'
                )
                .flatMap(item => item.patterns.map(pattern => pattern.toLowerCase()))
            );

            reply = reply.replace(/\\r\\n|\\n/g, '\n').split('\n').flatMap(line => {
                const names = line.trim().split(/\s+/);

                if (!names.every(name => name.startsWith('!'))) {
                    return [line];
                }

                const list = names.filter(name => commands.has(name.toLowerCase()));

                return list.length ? [list.join(' ')] : [];
            }).join('\n');
        }

        if (rule.action === 'roulette') {
            const count = Number(match.args || rule.default);
            const user = typeof this.options.weflab === 'function'
                ? this.options.weflab()
                : this.options.weflab;

            if (!Number.isSafeInteger(count) || count < 1) {
                throw new Error('사용법: !룰렛 개수');
            }

            if (!user) {
                throw new Error('WEFLAB 설정 없음');
            }

            const index = typeof rule.index === 'object'
                ? rule.index[count] ?? 0
                : rule.index ?? 0;
            const roulette = await weflab.roulette(user, count, index);

            reply = weflab.format(roulette, count, rule.numbers, rule.title);
        }

        const variables = {
            이름: data.userNick || data.fromNick || data.user_nick || '',
            아이디: data.userId || data.fromId || data.user_id || '',
            내용: data.message || '',
            인수: match.args || '',
            개수: data.count
                ?? data.item?.days
                ?? data.gift_count
                ?? data.settle_count
                ?? data.month
                ?? '',
            개월: data.month ?? data.item?.month ?? '',
            받는이: data.toNick || data.receivedName || '',
            후원종류: data.donation || '',
            팬순번: data.fanOrder ?? '',
            ...match
        };

        const message = reply.replace(/\{([^{}]+)\}/g, (text, key) => {
            return variables[key] === undefined ? text : String(variables[key]);
        }).replace(/\\r\\n|\\n/g, '\n');

        let ogq;

        if (rule.ogq) {
            const group = this.client.ogq?.data?.findIndex(item => {
                return item.ogq_title?.trim().toLowerCase() === rule.ogqName.toLowerCase();
            });

            ogq = group >= 0 ? this.client.findOgq(group) : null;

            if (ogq && rule.ogqNumber > ogq.max) {
                ogq = null;
            }
        }

        if (
            !this.canSend()
            || !this.rules.includes(rule)
            || (!message && !ogq)
        ) {
            return false;
        }

        let result;

        if (ogq) {
            result = await this.client.sendOgq(
                message ? '\n' + message : '',
                ogq.id,
                rule.ogqNumber
            );

            if (Number(result?.code) !== 1) {
                throw new Error(`OGQ 전송 실패 (${result?.code ?? '응답 없음'})`);
            }

            result = true;
        }
        else if (rule.output === 'manager') {
            result = await this.client.sendManagerChat(message);
        }
        else if (rule.output === 'direct') {
            if (!data.userId) {
                throw new Error('귓속말 대상 없음');
            }

            result = await this.client.sendDirectChat(message, data.userId);
        }
        else {
            result = await this.client.sendChat(message);
        }

        if (!result) {
            throw new Error('매크로 전송 실패');
        }

        this.client.emit('macro', {
            type: 'send',
            rule: rule.name || rule.id,
            message,
            userId: data.userId || '',
            userNick: data.userNick || ''
        });

        return true;
    }

    async close() {
        if (this.closed) {
            return;
        }

        this.closed = true;
        clearInterval(this.timer);

        if (this.file) {
            fs.unwatchFile(this.file, this.watcher);
        }

        for (const [event, handler] of this.events) {
            this.client.off(event, handler);
        }

        this.events.clear();
        this.history?.close();
        await this.queue;
    }
}
