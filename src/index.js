import { config } from 'dotenv';
import readline from 'readline';
import { SoopClient } from '#soop/client';
import * as http from '#soop/http';
import * as log from '#utils/log';
import { parseEnv } from '#utils/env';
import { load, get } from '#utils/config';
config({ quiet: true });

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ''}
);

let client, isLink, isList, mode;

(async () => {
    loadConfig();

    // 방송 스트리머 아이디
    const bjId = getConfig('bjId');

    // 방송 비밀번호
    const broadPw = getConfig('broadPw');

    // 방송 대기 연결
    // true: 방송 대기하다가 방송이 켜지면 자동 접속
    // 방송 종료 후에도 다시 방송이 켜질 때까지 대기
    // false: 자동 대기를 사용하지 않고 직접 연결
    const auto = getConfig('auto');

    // 필요하면 브라우저 쿠키 넣기
    const cookie = getConfig('cookie');

    // 이모티콘 링크 표시
    isLink = getConfig('isLink') ?? true;

    // 참여자 목록 표시
    isList = getConfig('isList') ?? false;

    // 참여자 목록 및 입퇴장 수신
    // 0: 참여자 목록 표시, 입장/퇴장 모두 표시
    // 1: 입장/퇴장 모두 표시
    // 2: 입장/퇴장 열혈 이상 표시
    const pver = getConfig('pver');

    // 자막이 허용된 방송에서 자막 표시
    // (-1: 끄기 / 0: 한국어 / 1: English)
    const subtitle = getConfig('subtitle');

    // 채팅 로그 범위
    // 0 = 전체 채팅
    // 1 = 열혈 이상
    // 2 = 매니저 이상
    // 3 = 스트리머
    mode = getConfig('mode') ?? 0;

    client = new SoopClient({
        bjId, broadPw, auto,
        pver, subtitle, cookie
    });

    if (getConfig('userId')) {
        await client.login(
            getConfig('userId'),
            getConfig('password'),
            getConfig('secondPw')
        );
    }

    // live
    client.on('live', data => {
        let message = '';

        if (!data.bjId) {
            message = '방송 스트리머 아이디가 설정되어 있지 않습니다.';
            log.info('[알림]', `\x1b[1m${message}\x1b[0m`);
            return;
        }

        switch (data.code) {
        case 3:
            message = `${data.bjNick}(${data.bjId})님 방송은 오프라인입니다.`;
            break;

        case 2:
            message = `${data.bjNick}(${data.bjId})님 방송은 비밀번호 입력 후 입장이 가능합니다.`;
            break;

        case 1:
            message = `${data.bjNick}(${data.bjId})님 방송에 연결을 시도합니다.`;
            break;

        case 0:
            message = `${data.bjNick}(${data.bjId})님 방송에 연결 대기 중입니다.`;
            break;

        case -6:
        case -8:
            message = `${data.bjNick}(${data.bjId})님 방송은 성인 인증 후 입장할 수 있습니다.`;
            break;

        case -14:
            message = `${data.bjNick}(${data.bjId})님 방송은 플러스 구독팬만 참여 가능합니다.`;
            break;
        }

        log.info('[알림]', `\x1b[1m${message}\x1b[0m`);
    });

    client.on('post', data => {
        if (isLink) { //----------------------------------------------------
        
        if (data.url) {
            log.load('[게시글]', data.url);
        }

        } //----------------------------------------------------------------

        let message = (
            `${data.bjNick}님이 새 글을 작성했습니다. | `
            + `제목: ${data.title} | `
            + `작성일: ${data.regDate}`
        );

        log.info('\x1b[94m[알림]\x1b[0m', `\x1b[1m${message}\x1b[0m`);
    });

    // open
    client.on('open', data => {
        let message = '';

        if (data.broad.title) {
            message += `방송 제목: ${data.broad.title} | `
        }

        if (data.broad.category) {
            message += `카테고리: ${data.broad.category} | `
        }

        if (data.broad.hashtag) {
            message += `태그: ${data.broad.hashtag} | `
        }

        message += `${data.bjNick}(${data.bjId})님 방송에 입장하였습니다.`;

        log.info('[시작]', `\x1b[1m${message}\x1b[0m`);
    });

    // join
    client.on('join', data => {
        let message = '';

        if (data.userId) {
            message = `${data.userNick}(${data.userId})님이 대화방에 참여했습니다.`;
        } else {
            message = `비로그인 사용자가 대화방에 참여했습니다.`;
        }

        log.info('[입장]', `[${data.role}]`, `\x1b[1m${message}\x1b[0m`);
    });

    // rule
    client.on('rule', data => {
        if (data.chat_rule_display > 0) {
            log.info('[규칙]', `\x1b[1m${data.chat_rule}\x1b[0m`);
        }
    })

    // title
    client.on('title', data => {
        log.warn('[제목 변경]', `\x1b[1m${data.prev} → ${data.title}\x1b[0m`);
    });

    // category
    client.on('category', data => {
        log.warn('[카테고리 변경]', `\x1b[1m${data.prev} → ${data.category}\x1b[0m`);
    });

    // hashtag
    client.on('hashtag', data => {
        log.warn('[태그 변경]', `\x1b[1m${data.prev} → ${data.hashtag}\x1b[0m`);
    });

    // bridge
    client.on('bridge', data => {
        log.debug('[BRIDGE]', `\x1b[1m${data}\x1b[0m`);
    });

    // quit
    client.on('quit', data => {
        let message = '';

        switch (data.type) {
        case 1:
            message = '스트리머에 의해 강제퇴장 되었습니다.';
            break;
        
        case 2:
            message = '매니저에 의해 강제퇴장 되었습니다.';
            break;
        
        default:
            message = `${data.adminNick}에 의해 강제퇴장 되었습니다.`;
            break;
        }

        log.error('[알림]', message);
    });

    // dumb
    client.on('dumb', data => {
        let message = '';

        if (data.count > 2) {
            message = (
                '님이 채팅금지 횟수 초과로 블라인드 처리 되었습니다. '
                + `${data.count}초 동안 채팅과 방송화면을 볼 수 없습니다.`
            );
        } else {
            message = `님이 채팅금지(${data.time}초) ${data.count}회가 되었습니다.`;
        }

        const admin = client.userList.get(data.adminId);
        const name = admin ? admin.name : data.adminId;

        log.error('[채금]', `\x1b[1m${data.userNick}(${data.userId})${message}`, `(처리자: ${name})\x1b[0m`);
    });

    // userList
    client.on('userList', data => {
        if (isList) { //----------------------------------------------------
        const start = client.userList.size - data.length;

        const list = data
            .map((user, index) => {
                return `${start + index + 1}. ${user.name}(${user.id}) [${user.role}]`;
            }
        ).join('\n');

        
        log.info(`[참여인원]\n${list}`);

        } //----------------------------------------------------------------
    });

    // chuser
    client.on('chuser', data => {
        let message = '';

        if (data.type === 1) {
            message = `${data.user.name}(${data.user.id})님이 대화방에 참여했습니다.`;

            log.debug('[입장]', `[${data.user.role}]`, message);
            return;
        }

        if (data.user.exit === 1) {
            message = `${data.user.name}(${data.user.id})님이 대화방에서 나가셨습니다.`;

            log.debug('[퇴장]', `[${data.user.role}]`, message);
            return;
        }

        if (data.user.exit === 5) {
            message = `${data.user.name}(${data.user.id})님이 블라인드 상태에서 탈출을 시도하여 강제퇴장 되었습니다.`;

            log.error('[퇴장]', `[${data.user.role}]`, `\x1b[1m${message}\x1b[0m`);
            return;
        }

        message = `${data.user.name}(${data.user.id})님이 강퇴되었습니다. (누적 ${data.user.count}회)`

        log.error('[퇴장]', `[${data.user.role}]`, `\x1b[1m${message}\x1b[0m`);
    });

    // chat
    client.on('chat', data => {
        if (!showChat(data)) {
            return;
        }

        if (isLink) { //----------------------------------------------------

        const extras = client.findAssets(data);

        for (const item of extras.emoticons) {
            log.info('\x1b[38;5;187m[이모티콘]', item.keyword, item.smallUrl);
        }

        if (extras.tierUrl) {
            log.load('[구독]', extras.tierUrl);
        }

        } //----------------------------------------------------------------

        let badge = data.tier
            ? `${data.tierName} | ${data.subMonth}개월] [${data.role}`
            : data.role
        
        switch (data.role) {
        case '스트리머':
            badge = `\x1b[38;2;255;102;0m[${badge}]\x1b[0m\x1b[1m`;
            break;

        case '매니저':
            badge = `\x1b[38;2;83;177;174m[${badge}]\x1b[0m`;
            break;

        case '열혈':
            badge = `\x1b[38;2;214;91;143m[${badge}]\x1b[0m`;
            break;

        case '팬':
            badge = `\x1b[38;2;117;170;92m[${badge}]\x1b[0m`;
            break;

        default:
            badge = `\x1b[90m[${badge}]\x1b[0m`;
            break;
        }

        log.info('\x1b[94m[채팅]\x1b[0m', badge, `${data.userNick}(${data.userId}): ${data.message}`);
    });

    // directChat
    client.on('directChat', data => {
        if (isLink) { //----------------------------------------------------

        const extras = client.findAssets(data);

        for (const item of extras.emoticons) {
            log.info('\x1b[38;5;187m[이모티콘]', item.keyword, item.smallUrl);
        }

        if (extras.tierUrl) {
            log.load('[구독]', extras.tierUrl);
        }

        } //----------------------------------------------------------------

        let message = '';

        if (data.type === 1) {
            message = `${data.fromNick}(${data.fromId})님의 귓말 ${data.message}`;
        } else {
            message = `${data.toNick}(${data.toId})님에게 귓말 ${data.message}`;
        }

        const badge = data.tier
            ? `${data.tier} | ${data.subMonth}개월] [${data.role}`
            : data.role

        log.load('[귓속말]', `\x1b[1m[${badge}]`, `${message}\x1b[0m`);
    });

    // userFlag
    client.on('userFlag', data => {
        const flag = data.flag.isBlock ? '거부' : '허용';

        log.debug('[알림]', `${data.userNick}(${data.userId})님이 귓속말 ${flag} 하셨습니다.`);
    });

    // subBj
    client.on('subBj', data => {
        const message = data.flag.isManager
            ? '님이 매니저가 되셨습니다.'
            : '님이 매니저에서 해임 되셨습니다.';

        log.allim('[알림]', `\x1b[1m${data.userNick}(${data.userId})${message}\x1b[0m`);
    });

    // nickName
    client.on('nickName', data => {
        log.debug('[알림]', `${data.oldNick}(${data.userId})님이 ${data.newNick} 닉네임으로 변경 하셨습니다.`);
    });

    // sticker
    client.on('sticker', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]', data.imageUrl)

        } //----------------------------------------------------------------

        log.warn('[스티커]', `\x1b[1m${data.userNick}(${data.userId})님이 스티커 ${data.count}개를 선물 하셨습니다.\x1b[0m`);

        if (data.supporterOrder > 0) {
            log.info('\x1b[38;2;117;170;92m\x1b[1m[서포터]', `${data.userNick}님이 ${data.supporterOrder}번째 서포터가 되셨습니다.\x1b[0m`);
        }
    });

    // iceMode
    client.on('iceMode', data => {
        if (data.index === 0) {
            log.allim('[얼음]', '\x1b[1m채팅을 녹였습니다. 채팅에 참여 하실 수 있습니다.\x1b[0m');
            return;
        }

        const { auth, count, date } = data;

        const names = [
            auth.isStreamerAllowed && '스트리머',
            auth.isTopFanAllowed && '열혈팬',
            auth.isSubscriberAllowed && (
                date > 0 ? `구독팬(${date}개월↑)` : '구독팬'
            ),
            auth.isFanClubAllowed && (
                count > 0 ? `팬클럽(${count}개↑)` : '팬클럽'
            ),
            auth.isSupporterAllowed && '서포터',
            auth.isManagerAllowed && '매니저',
        ].filter(Boolean);

        log.allim('[얼음]', `\x1b[1m채팅을 얼렸습니다. ${names.join(', ')}만 채팅에 참여할 수 있습니다.\x1b[0m`);
    });

    // slowMode
    client.on('slowMode', data => {
        if (data.count > 0) {
            log.debug('[알림]', '저속모드가 활성화되었습니다.', `${data.count}초 간격으로 채팅 입력이 가능합니다.`);
        } else {
            log.debug('[알림]', '저속모드가 비활성화되었습니다.', '지연 없이 채팅 입력이 가능합니다.');
        }
    });

    // managerChat
    client.on('managerChat', data => {
        if (isLink) { //----------------------------------------------------

        const extras = client.findAssets(data);

        for (const item of extras.emoticons) {
            log.info('\x1b[38;5;187m[이모티콘]', item.keyword, item.smallUrl);
        }

        if (extras.tierUrl) {
            log.load('[구독]', extras.tierUrl);
        }

        } //----------------------------------------------------------------

        let badge = data.tier
            ? `${data.tierName} | ${data.subMonth}개월] [${data.role}`
            : data.role
        
        switch (data.role) {
        case '스트리머':
            badge = `\x1b[38;2;255;102;0m[${badge}]\x1b[0m\x1b[1m`;
            break;

        default:
            badge = `\x1b[38;2;83;177;174m[${badge}]\x1b[0m`;
            break;
        }

        log.info('\x1b[91m[매니저 채팅]\x1b[0m', `\x1b[1m${badge}`, `${data.userNick}(${data.userId}): ${data.message}\x1b[0m`);
    });

    // quickview
    client.on('quickview', data => {
        if (!data.item) {
            log.warn('[퀵뷰 선물]', '알 수 없는 퀵뷰 타입입니다.');
            return;
        }

        log.warn(data.item?.plus ? '[퀵뷰 플러스 선물]' : '[퀵뷰 선물]',  `${data.fromNick}(${data.fromId})님이`,
            `${data.toNick}(${data.toId})님에게`, `${data.item.name} ${data.item.days}일권 선물 하셨습니다.`
        );
    });

    // poll
    client.on('poll', async data => {
        let message = '';
        let poll = null;

        try {
            poll = await client.sendPollList(
                data.surveyNo
            );
        } catch (error) {
            log.error('[투표]', error);
            return;
        }

        if (!poll) {
            log.warn('[투표]', '투표 정보를 가져오지 못했습니다.');
            return;
        }

        switch (data.status) {
        case 1:
            message = '새로운 투표가 시작되었습니다.';
            break;

        case 2:
            message = '투표가 종료되었습니다.';

            client.poll = null;
            break;

        case 3:
            message = '투표가 마감되었습니다.';
            break;

        case 4:
            message = '투표 결과가 공개되었습니다.';
            break;

        default:
            message = '알 수 없는 투표 상태입니다.';
            break;
        }

        log.warn('[투표]', `\x1b[1m${message}\x1b[0m`);

        if (poll.result !== 1) {
            log.info(poll.message);
            return;
        }

        const list = (
                poll.data?.list || []
            )
            .map(item => `${item.answer_no}. ${item.answer_title}. (${item.answer_total}표)`)
            .join('\n');

        log.load(`\x1b[1m${poll.data?.title} (${poll.data?.start_tm})\n${list}\x1b[0m`);
    });

    // banWord
    client.on('banWord', data => {
        if (data.after?.[0]) {
            log.info('[알림]', '금칙어가 적용되어있습니다.', `(금칙어: ${data.after.join(', ')} /`, `대체어: ${data.before})`);
        }
    });

    // adminNotice
    client.on('adminNotice', data => {
        log.warn('[SOOP 안내]', `\x1b[1m${data.message}\x1b[0m`);
    });

    // kickCancel
    client.on('kickCancel', data => {
        if (data.type === 0) {
            log.debug('[알림]', `${data.userNick}(${data.userId})님이 강제퇴장했습니다.`, data.message);
        } else {
            log.debug('[알림]', `${data.userNick}(${data.userId})님의 강제퇴장이 취소되었습니다.`, data.message);
        }
    });

    // kickList
    client.on('kickList', data => {
        if (data.length === 0) {
            log.info('[알림]', '강제퇴장 인원이 없습니다.');
            return;
        }

        log.info('[알림]', '강제퇴장', `총 인원 (${data.length})`,
            '\n──────────────────────────────\n' +
            data.map((item, i) => { return [
                    `${i + 1}. ${item.userNick}(${item.userId})`,
                    `   처리 시간: ${item.date}`,
                    `   처리자: ${item.adminNick}(${item.adminId})`
            ].join('\n') }).join('\n\n')
            + '\n──────────────────────────────\n'
        );
    });

    // kickState
    client.on('kickState', data => {
        const enabled = data.index === 0 ? '켜짐' : '꺼짐';

        log.debug('[알림]', `유저에게 강제 퇴장 메시지 표시: ${enabled}`);
    });

    // follow
    client.on('follow', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        const tier = data.tier === 1 ? '베이직' : '플러스';

        const tierName = (
            tier !== data.tierName
            ? `${tier} ${data.tierName}` : `${tier}`
        );

        log.warn('[구독]', `\x1b[1m${data.userId}(${data.userNick})님이 ${tierName} ${data.month}개월 구독하였습니다.\x1b[0m`);
    });

    // followEffect
    client.on('followEffect', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        const tier = data.tier === 1 ? '베이직' : '플러스';

        const tierName = (
            tier !== data.tierName
            ? `${tier} ${data.tierName}` : `${tier}`
        );

        log.warn('[연속 구독]', `\x1b[1m${data.userId}(${data.userNick})님이 ${tierName} ${data.month}개월째 구독 중입니다. (누적 ${data.accMonth}개월)\x1b[0m`);
    });

    // translationState
    client.on('translationState', data => {
        const enabled = data.index === 1 ? '켜짐' : '꺼짐';

        log.debug('[알림]', `채팅 번역 기능: ${enabled}`);
    });

    // translation
    client.on('translation', data => {
        log.info('[번역]', `\x1b[1m${data.message} (${data.before.label} → ${data.after.label})\x1b[0m`);
        
        if (data.mode === 2) rl.write(data.message);
    });

    // notice
    client.on('notice', data => {
        if (data.state > 0) {
            log.info('[공지]', `\x1b[1m${data.message}\x1b[0m`);
        }
    });

    // subscription
    client.on('subscription', data => {
        if (!data.item) {
            log.warn('[구독권 선물]', '알 수 없는 구독권 타입입니다.');
            return;
        }

        const tierName = (
            data.item.tierName !== data.tierName
            ? `${data.item.tierName} ${data.tierName}`
            : data.item.tierName
        );

        log.warn('[구독권 선물]',
            `\x1b[1m${data.fromNick}(${data.fromId})님이 `
            + `${data.toNick}(${data.toId})님에게 `
            + `${tierName} ${data.item.month}개월 구독권을 선물 하셨습니다.\x1b[0m`
        );
    });

    // ogq
    client.on('ogq', data => {
        if (!showChat(data)) {
            return;
        }

        let badge = data.tier
            ? `${data.tierName} | ${data.subMonth}개월] [${data.role}`
            : data.role
        
        switch (data.role) {
        case '스트리머':
            badge = `\x1b[38;2;255;102;0m[${badge}]\x1b[0m\x1b[1m`;
            break;

        case '매니저':
            badge = `\x1b[38;2;83;177;174m[${badge}]\x1b[0m`;
            break;

        case '열혈':
            badge = `\x1b[38;2;214;91;143m[${badge}]\x1b[0m`;
            break;

        case '팬':
            badge = `\x1b[38;2;117;170;92m[${badge}]\x1b[0m`;
            break;

        default:
            badge = `\x1b[90m[${badge}]\x1b[0m`;
            break;
        }
        
        const message = data.message ? `: ${data.message}` : '';

        if (isLink) { //----------------------------------------------------
        
        const extras = client.findAssets(data);

        for (const item of extras.emoticons) {
            log.info('\x1b[38;5;187m[이모티콘]', item.keyword, item.smallUrl);
        }

        if (extras.tierUrl) {
            log.load('[구독]', extras.tierUrl);
        }

        log.warn('[OGQ]', badge, `${data.userNick}(${data.userId})${message}`, data.imageUrl);

        } //----------------------------------------------------------------

        else if (data.message) {
            log.info('\x1b[94m[채팅]\x1b[0m', badge,
                `${data.userNick}(${data.userId})${message}`
            );
        }

    });

    // drops
    client.on('drops', data => {
        log.info('[알림]', `\x1b[1m${data.message} 드롭스 추첨 완료! 당첨자에게 쪽지가 전달되었습니다.\x1b[0m`);
    });

    // ogqGift
    client.on('ogqGift', data => {
        if (isLink) { //----------------------------------------------------
        
        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        log.warn('[OGQ 선물]', 
            `\x1b[1m${data.fromNick}(${data.fromId})님이 `
            + `${data.toNick}(${data.toId})님에게 `
            + `${data.title} OGQ 이모티콘을 선물 하셨습니다.\x1b[0m`
        );

    });

    // adInBroad
    client.on('adInBroad', data => {
        let message = '';
        if (data.ad_in_room === 1) {
            message = '쉬는시간이 설정되었습니다. 쉬는시간에도 채팅입력이 가능합니다.';
        } else {
            message = '쉬는시간이 종료되었습니다.';
        }

        log.warn('[알림]', message);
    });

    //-------------------------------------------------------------------

    // ballon
    client.on('balloon', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        log.warn('[후원]', `]\x1b[1m${data.userNick}(${data.userId}) 별풍선 ${data.count}개를 선물 하셨습니다.\x1b[0m`);

        if (data.fanOrder > 0) {
            log.info('\x1b[38;2;117;170;92m\x1b[1m[팬클럽]', `${data.userNick}님이 ${data.fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`);
        }

        if (data.topFan > 0) {
            log.info('\x1b[38;2;214;91;143m\x1b[1m[열혈팬]', `${data.userNick}님이 열혈팬이 되셨습니다.\x1b[0m`);
        }
    });

    // adcon
    client.on('adcon', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        log.warn('[후원]', `]\x1b[1m${data.userNick}(${data.userId}) 애드벌룬 ${data.count}개를 선물 하셨습니다.\x1b[0m`);

        if (data.fanOrder > 0) {
            log.info('\x1b[38;2;117;170;92m\x1b[1m[팬클럽]', `${data.userNick}님이 ${data.fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`);
        }

        if (data.topFan > 0) {
            log.info('\x1b[38;2;214;91;143m\x1b[1m[열혈팬]', `${data.userNick}님이 열혈팬이 되셨습니다.\x1b[0m`);
        }
    });

    // videoBalloon
    client.on('videoBalloon', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        log.warn('[영상 후원]', `]\x1b[1m${data.userNick}(${data.userId}) 영상 풍선 ${data.count}개를 선물 하셨습니다.\x1b[0m`, data.raw);

        if (data.fanOrder > 0) {
            log.info('\x1b[38;2;117;170;92m\x1b[1m[팬클럽]', `${data.userNick}님이 ${data.fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`);
        }

        if (data.topFan > 0) {
            log.info('\x1b[38;2;214;91;143m\x1b[1m[열혈팬]', `${data.userNick}님이 열혈팬이 되셨습니다.\x1b[0m`);
        }
    })

    // vodBalloon
    client.on('vodBalloon', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        log.warn('[후원]', `]\x1b[1m${data.userNick}(${data.userId}) VOD 별풍선 ${data.count}개를 선물 하셨습니다.\x1b[0m`);
    });

    // vodAdcon
    client.on('vodAdcon', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        log.warn('[후원]', `]\x1b[1m${data.userNick}(${data.userId}) VOD 애드벌룬 ${data.count}개를 선물 하셨습니다.\x1b[0m`);

        if (data.fanOrder === 1) {
            log.info('\x1b[38;2;117;170;92m\x1b[1m[팬클럽]', `${data.userNick}님이 ${data.fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`);
        }

        if (data.topFan === 1) {
            log.info('\x1b[38;2;214;91;143m\x1b[1m[열혈팬]', `${data.userNick}님이 열혈팬이 되셨습니다.\x1b[0m`);
        }
    });

    // stationAdcon
    client.on('stationAdcon', data => {
        if (isLink) { //----------------------------------------------------

        log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);

        } //----------------------------------------------------------------

        log.warn('[후원]', `]\x1b[1m방송국에서 ${data.userNick}(${data.userId})님이 애드벌룬 ${data.count}개를 선물 하셨습니다.\x1b[0m`);
    });

    // challenge
    client.on('challenge', data => {
        if (isLink) { //----------------------------------------------------

            if (data.imageUrl) {
                log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);
            }
        } //----------------------------------------------------------------

        let message = '';

        if (data.type === 'CHALLENGE_GIFT') {
            message = `${data.user_nick}(${data.user_id})님 도전미션 ${data.title} 별풍선 ${data.gift_count}개 후원했습니다.`;
        }
        
        else if (data.type === 'CHALLENGE_SETTLE') {
            message = `도전미션으로 별풍선 ${data.settle_count}개 획득했습니다.`;
        }
        
        else {
            if (data.mission_status === 'SUCCESS') {
                message = `[${data.title}]이 미션을 성공하였습니다! 스트리머에게 축하의 별풍선을 선물해보세요!`;
            }
            
            else {
                message = `[${data.title}]이 미션을 달성하지 못하였습니다. 다음 도전을 응원해주세요!`;
            }
        }

        log.warn('[후원]', `\x1b[1m${message}\x1b[0m`);
    });

    // battle
    client.on('battle', async data => {
        if (isLink) { //----------------------------------------------------

            if (data.imageUrl) {
                log.info('\x1b[38;5;187m[이미지]]', data.imageUrl);
            }
        } //----------------------------------------------------------------

        let message = '';

        if (data.type === 'GIFT') {
            message = `${data.user_nick}(${data.user_id})님 대결미션 ${data.title} 별풍선 ${data.gift_count}개 후원했습니다.`;
        }
        
        else if (data.type === 'SETTLE') {
            message = `대결미션으로 별풍선 ${data.settle_count}개 획득했습니다.`;
        }
        
        else if (data.type === 'NOTICE') {
            if (data.draw) {
                message = `[${data.title}] 대결미션 결과 무승부입니다! 참여한 스트리머에게 수고의 별풍선을 선물해 보세요.`;
            }

            else if (data.winner) {
                message = `[${data.title}] 대결미션 승리 팀은 ${data.winner}입니다. 승리 팀의 스트리머에게 축하의 별풍선을 선물해 보세요.`;
            }
        }

        log.warn('[후원]', `\x1b[1m${message}\x1b[0m`);

        const mission = await client.sendMissionList();

        if (!mission.ok) {
            log.warn('[대결미션]', mission.message);
            return;
        }

        log.load('\x1b[1m' + [
            `[대결미션] ${mission.title}`,
            `상태: ${mission.status}`,
            `총 후원: ${mission.total}개`,
            `팀:\n${mission.teams}`
        ].join('\n') + '\x1b[0m');
    });

    // missionSettle
    client.on('missionSettle', data => {
        let message = '';

        let fanOrder = Number(data.fanOrder)

        for (const item of data.list) {
            const userId = item[0];
            const userNick = item[1];
            const count = item[2];
            const isFanClub = item[3];
            const isTopFan = item[4];

            if (isFanClub === 1) {
                log.info('\x1b[38;2;117;170;92m\x1b[1m[팬클럽]', `${userNick}(${userId})님이 ${fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`);

                fanOrder++;
            }

            if (isTopFan === 1) {
                log.info('\x1b[38;2;214;91;143m\x1b[1m[열혈팬]', `${userNick}님이 열혈팬이 되셨습니다.\x1b[0m`);
            }
        }
    });

    //-------------------------------------------------------------------

    // subCeremony
    client.on('subCeremony', data => {
        log.warn('[구독]', `\x1b[1m${data.userId}(${data.userNick})님이 ${data.month}개월 구독중입니다.\x1b[0m`);
    });

    // subtitle
    client.on('subtitle', data => {
        log.info('\x1b[91m[자막]\x1b[0m', `\x1b[1m${data.message}\x1b[0m`);
    });

    // userLang
    client.on('userLang', data => {
        let message = '';

        if (data.index < 0) {
            message = '자막 언어 설정이 꺼져있습니다.';
        } else {
            message = '자막 언어 설정이 변경되었습니다.';
        }

        log.info('[알림]', message, data.lang.label);
    });

    // session
    client.on('session', data => {
        if (!data.login) {
            log.warn('[세션]', '방송 연령 제한이 설정되어 종료합니다.');
            return;
        }

        log.warn('[세션]', 
            `방송 세션이 변경되어 재연결합니다.\n`
            + `제목: ${data.after?.TITLE} → ${data.after?.TITLE}\n`
            + `BNO: ${data.before?.BNO} → ${data.after?.BNO}\n`
            + `CHATNO: ${data.before?.CHATNO} → ${data.after?.CHATNO}`
        );
    });

    // error
    client.on('error', error => {
        log.error('[에러]', error);
    });

    // close
    client.on('close', data => {
        let message = '';

        if (!data.bjId) {
            return;
        }

        if (data.message) {
            message = (
                `종료 메시지: ${data.message}\n`
                + `${data.bjNick}(${data.bjId})님 방송이 종료되었습니다.\n`
                + '방송이 종료된 후에는 채팅에 참여하실 수 없습니다.'
            );
        }

        else {
            message = `${data.bjNick}(${data.bjId})님 방송을 퇴장하였습니다.`;
        }

        log.info('[종료]', message);
    });

    // packet
    client.on('packet', data => {
        log.warn('[PACKET]', {
            CODE: data.service,
            SIZE: data.length,
            FLAG: data.flag,
            DATA: data.fields
        });
    });

    await client.connect();
})();

function shutdown() {
    pause();
    close();
    client.disconnect();
    process.exit(0);
}

function prompt() {
    if (!rl.closed) rl.prompt();
}

function pause() {
    if (!rl.closed) rl.pause();
}

function close() {
    if (!rl.closed) rl.close();
}

function loadConfig() {
    load('./config.json');
    parseEnv('.env', false);
}

function getConfig(name) {
    const result = process.env[get()?.[name]] ?? get()?.[name];

    if (typeof result === 'string') {
        if (result.toLowerCase() === name.toLowerCase()) {
            return null;
        }
    }

    return result;
}

function showChat(data = {}) {
    const isAdmin = data.isAdmin;
    const isStreamer = data.isBJ;
    const isManager = data.isManager;
    const isTopFan = data.isTopFan;

    if (mode === 0) {
        return true;
    }

    if (mode === 1) {
        return (isTopFan
            || isManager
            || isStreamer
            || isAdmin
        );
    }

    if (mode === 2) {
        return (isManager
            || isStreamer
            || isAdmin
        );
    }

    if (mode === 3) {
        return (isStreamer
            || isAdmin
        );
    }

    return false;
}

async function command(cmd) {

    const [name, ...args] = cmd.trim().split(' ');
    const text = args.join(' ');

    try {
        switch (name) {
        case '/내정보':
        case '/myinfo': {
            const i = await http.getPrivateInfo({
                cookie: client.cookie
            });

            log.info(i);
            break;
        }

        case '/조회':
        case '/find': {
            const targetId = args[0];

            if (!targetId) {
                log.warn('[명령어]', '/조회 아이디');
                break;
            }

            const info = await http.getStation(targetId);

            if (!info) {
                log.warn('[조회]', `${targetId}은 검색 결과가 없습니다.`);
                return false;
            }

            const result = await http.getSection(
                targetId,
                'broad',
                { cookie: client.cookie }
            );

            if (result) {
                log.warn('[조회]', `${info?.station.user_nick}님은 현재 방송 중입니다.`);
            } else {
                log.info('[조회]', `${info?.station.user_nick}님은 현재 오프라인입니다.`);
            }
            break;
        }

        case '/자동':
        case '/auto': {
            const arg = args.join(' ');

            if (arg !== 'true' && arg !== 'false') {
                log.warn('[명령어]', '/자동 true 또는 false');
                break;
            }

            const value = arg === 'true';

            if (client.auto === value) {
                log.warn('[자동]', `이미 ${client.auto} 으로 되어있습니다.`);
                break;
            }

            client.auto = value;

            log.load('[자동]', `자동이 ${client.auto} 으로 설정되었습니다.`);
            break;
        }

        case '/연결':
        case '/connect': {
            const targetId = args[0];
            const password = args[1] || '';

            if (!targetId) {
                log.warn('[명령어]', '/접속 방송스트리머아이디 방송비밀번호');
                break;
            }

            const info = await http.getStation(targetId);

            if (!info) {
                log.warn('[연결]', `${targetId}은 검색 결과가 없습니다.`);
                break;
            }

            await client.disconnect(false);
            await client.connect(
                targetId, password
            );
            break;
        }

        case '/비밀번호':
        case '/password': {
            const password = args.join(' ');

            if (!password) {
                log.warn('[명령어]', '/비밀번호 방송비밀번호');
                break;
            }

            client.broadPw = password;

            log.load('[비밀번호]', '방송비밀번호 입력이 완료되었습니다.');

            await client.disconnect(false);
            await client.connect();
            break;
        }

        case '/연결해제':
        case '/disconnect': {
            await client.disconnect();
            break;
        }

        case '/로그인':
        case '/login': {
            const id = args[0];
            const password = args[1];
            const secondPw = args[2];

            if (client.cookie) {
                log.warn('[로그인]', '이미 로그인 상태 입니다.');
                break;
            }

            if (!id || !password) {
                log.warn('[명령어]', '/로그인 아이디 비밀번호 +2차비밀번호');
                break;
            }

            const result = await client.login(
                id,
                password,
                secondPw
            );

            if (result === -1) {
                log.error('[로그인]', '등록되지 않은 아이디이거나,', 
                    '아이디 또는 비밀번호를 잘못 입력하셨습니다.'
                );
                break;
            }

            if (result === -2) {
                log.error('[로그인]', '2차 비밀번호를 잘못 입력하셨습니다.');
                break;
            }

            const info = await http.getStation(id);

            log.info('[로그인]', 
                `${info?.station.user_nick}(${info?.station.user_id}) `
                + '로그인 되었습니다.'
            );

            const re = client.closeWs();

            if (re) {
                await client.connectWs();
            }
            break
        }

        case '/로그아웃':
        case '/logout': {
            const result = await client.logout();
            
            if (!result) {
                log.warn('[로그아웃]', '이미 비로그인 상태입니다.');
                break;
            }

            log.info('[로그아웃]', '로그아웃 되었습니다.');
            break;
        }

        case '/모드':
        case '/mode': {
            const value = Number(args[0]);

            if (![0, 1, 2, 3].includes(value)) {
                log.warn('[명령어]', '/모드 번호');
                break;
            }

            mode = value;

            const name = {
                0: '전체 채팅',
                1: '열혈 이상',
                2: '매니저 이상',
                3: '스트리머'
            }[mode];

            log.info('[모드]', `${name}만 표시합니다.`);
            break;
        }
        
        case '/채팅':
        case '/chat':
            await client.sendChat(text);
            break;

        case '/매니저':
        case '/manager':
            await client.sendManagerChat(text);
            break;
        
        case '/위임':
        case '/op': {
            const targetId = args[0];

            if (!targetId) {
                log.warn('[명령어]', '/위임 아이디');
                break;
            }

            await client.sendSubBj(targetId, 1);
            break;
        }
        
        case '/해임':
        case '/-op': {
            const targetId = args[0];

            if (!targetId) {
                log.warn('[명령어]', '/해임 아이디');
                break;
            }

            await client.sendSubBj(targetId, 0);
            break;
        }

        case '/얼음':
        case '/ice': {
            if (client.iceMode) {
                log.warn('[얼음]', '이미 얼음 기능이 활성화되어 있습니다.');
                break;
            }

            const mask = client.makeIceAuth({
                streamer: true,
                fanClub: false,
                supporter: false,
                topFan: false,
                subscriber: false,
                manager: true,
            });

            const result = await client.sendIceMode('ice_on', 100001);
            log.debug(result);
            break;
        }

        case '/땡':
        case '/-ice': {
            if (!client.iceMode) {
                log.debug('[땡]', '현재 얼음 기능이 활성화되어 있지 않습니다.');
                break;
            }

            const result = await client.sendIceMode('ice_off', 0);
            log.debug(result);
            break;
        }
        
        case '/귓속말':
        case '/to': {
            const targetId = args[0];
            const message = args.slice(1).join(' ');

            if (!targetId || !message) {
                log.warn('[명령어]', '/귓속말 아이디 내용');
                break;
            }

            await client.sendDirectChat(message, targetId);
            break;
        }

        case '/답장':
        case '/re': {
            const message = args.join(' ');

            if (!client.direct) {
                log.warn('[답장]', '답장할 대상이 없습니다.');
                break;
            }

            if (!message) {
                log.warn('[명령어]', '/답장 내용');
                break;
            }

            await client.sendDirectChat(message, client.direct);
            break;
        }

        case '/투표':
        case '/poll': {
            const index = Number(args[0]);

            if (!client.poll) {
                log.warn('[투표]', '현재 진행 중인 투표가 없습니다.');
                break;
            }

            if (Number.isNaN(index)) {
                log.warn('[명령어]', '/투표 번호');
                break;
            }

            const result = await client.sendPoll(index);
            log.debug(result);
            break;
        }

        case '/도전':
        case '/challenge': {
            const challenge = await client.sendChallengeList();

            if (!challenge.ok) {
                log.warn('[도전미션]', challenge?.message);
                break;
            }

            if (!challenge.list.length) {
                log.warn('[도전미션]', '진행중인 도전미션이 없습니다.');
                break;
            }

            const text = challenge.list.map(item => {
                const status = {
                    REQUEST: '요청',
                    PROGRESS: '진행중',
                    SUCCESS: '성공',
                    FAIL: '실패',
                    CANCEL: '취소'
                };

                const lines = [
                    `[도전미션] ${item.title}`,
                    `상태: ${status[item.status]}`,
                    `등록자: ${item.userNick}(${item.userId})`
                ];

                if (item.balloon > 0) {
                    lines.push(`후원: ${item.balloon}개`);
                }

                if (item.unique > 0) {
                    lines.push(`참여자: ${item.unique}명`);
                }

                if (item.status === 'PROGRESS') {
                    lines.push(`남은 시간: ${client.formatTime(item.time)}`);
                    lines.push(`종료 예정: ${item.expireDate}`);
                }

                if (
                    item.status !== 'PROGRESS'
                    && item.endDate
                    && item.endDate !== '0000-00-00 00:00:00'
                ) {
                    lines.push(`종료일: ${item.endDate}`);
                }

                return lines.join('\n');
            }).join('\n\n');

            log.info(`\x1b[1m${text}\x1b[0m`);
            break;
        }

        case '/대결':
        case '/battle': {
            const mission = await client.sendMissionList();

            if (!mission.ok) {
                log.warn('[대결미션]', mission?.message);
                break;
            }

            log.info('\x1b[1m' + [
                `[대결미션] ${mission.title}`,
                `상태: ${mission.status}`,
                `총 후원: ${mission.total}개`,
                `팀:\n${mission.teams}`
            ].join('\n') + '\x1b[0m');
            break;
        }

        case '/자막':
        case '/subtitle': {
            const index = Number(args[0]);

            if (Number.isNaN(index)) {
                log.warn('[명령어]', '/자막 ', 
                    '-1: 끄기 / 0: 한국어 / 1: English'
                );
                break;
            }

            await client.sendSubtitle(index);
            break;
        }

        case '/참여인원':
        case '/userlist': {
            await client.sendUserList();
            if (!isList) {
                const list = [...client.userList.values()]
                    .map((user, index) => {
                        return `${index + 1}. ${user.name}(${user.id}) [${user.role}]`;
                    }
                ).join('\n');

                log.info(`[참여인원]\n${list}`);
            }
            break;
        }

        case '/강퇴인원':
        case '/kicklist':
            await client.sendKickList();
            break;

        case '/저속':
        case '/slow': {
            const count = Number(args[0]) || 0;
            await client.sendSlowMode(count);
            break;
        }

        case '/채금':
        case '/m': {
            const targetId = args[0];
            const message = args.slice(1).join(' ') || '채팅금지';

            if (!targetId) {
                log.warn('[명령어]', '/채금 아이디 사유');
                break;
            }

            await client.sendDumb(targetId, message);
            break;
        }

        case '/강퇴':
        case '/k': {
            const targetId = args[0];
            const message = args.slice(1).join(' ') || '강제퇴장';

            if (!targetId) {
                log.warn('[명령어]', '/강퇴 아이디 사유');
                break;
            }

            await client.sendKick(targetId, 0, message);
            break;
        }

        case '/강퇴취소':
        case '/-k': {
            const targetId = args[0];

            if (!targetId) {
                log.warn('[명령어]', '/강퇴취소 아이디');
                break;
            }

            await client.sendKick(targetId, 1);
            break;
        }

        case '/번역': 
        case '/t': {
            const mode = Number(args[0]) || 1;
            const message = args.slice(1).join(' ');

            if (!message) {
                log.warn('[명령어]', '/번역 1 내용');
                break;
            }

            await client.sendTranslation(message, mode);
            break;
        }

        case '/이모티콘':
        case '/ogq': {
            const ogqId = args[0];
            const subId = Number(args[1]) || 1;
            const message = args.slice(2).join(' ');

            const list = client.ogq?.data.map((item, index) => (
                `${index}. ${item.ogq_title}`
            ));

            if (!list?.length) {
                log.warn('[OGQ]', 'OGQ 목록이 없습니다.');
                break;
            }

            if (!ogqId) {
                log.warn('[명령어]', '/ogq ogqId 번호 +내용', list);
                break;
            }

            const ogq = client.findOgq(ogqId);

            if (!ogq) {
                log.warn('[OGQ]', '없는 OGQ 번호입니다.');
                break;
            }

            const result = await client.sendOgq(message, ogq.id, subId);

            if (result.code !== 1) {
                log.warn('[OGQ]', 'OGQ 전송 실패', result.message);
                break;
            }

            log.load('[OGQ]', list[ogqId]);
            break;
        }

        case '/지우기':
        case '/clear':
            console.clear();
            break;

        case '/종료':
        case '/exit':
            shutdown();
            return;
        
        case '/도움':
        case '/help':
            log.prompt('[명령어]\n' + [
                '/조회 아이디',
                '/자동 true & false',
                '/연결 아이디 방송비밀번호',
                '/비밀번호 방송비밀번호',
                '/연결해제',
                '/로그인 아이디 비밀번호 +2차비밀번호',
                '/로그아웃',

                '/위임 아이디',
                '/해임 아이디',
                '/채금 아이디 사유',
                '/강퇴 아이디 사유',
                '/강퇴취소 아이디',
                '/얼음',
                '/땡',
                '/저속 초',

                '/채팅 내용',
                '/매니저 내용',
                '/이모티콘 OGQ 번호 내용',
                '/귓속말 아이디 내용',
                '/답장 내용',

                '/투표 번호',
                '/대결',
                '/자막 번호',
                '/참여인원',
                '/강퇴인원',
                '/번역 모드 내용',
                '/모드 번호',
                '/지우기',
                '/종료'
            ].join('\n'));
            break;        

        default:
            log.warn('[명령어]', '알 수 없는 명령어입니다.', 
                '/도움 입력으로 명령어 목록을 확인하세요.'
            );
            break;
        }
    } catch (error) {
        log.error('[명령어]', error.message);
    }

    prompt();
}

rl.on('line', async (input) => {
    const cmd = input.trim();
    log.input(input);

    if (!cmd) {
        prompt();
        return;
    }

    await command(cmd);
});

rl.on('SIGINT', shutdown);