import {
    DOMAIN,
    DELIMITER,
    SVC,
    USER_FLAG1,
    USER_FLAG2,
    ICE_AUTH,
} from '#soop/config';

import {
    normalize
} from '#soop/http';

export function dispatch(soop, pkt) {
    const fields = pkt.fields;

    switch (pkt.service) {
    
    // 1
    case SVC.LOGIN: {
        soop.userId = fields[0];
        soop.userFlag = fields[1];

        soop.sendJoinChannel(
            soop.broadPw
        );

        if (soop.rule) {
            soop.emit('rule', soop.rule);
        }
        break;
    }

    // 2
    case SVC.JOIN_CHANNEL: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        soop.userFlag = fields[6];

        if (soop.cookie?.AuthTicket) {
            soop.sendUserFlag(soop.userFlag);
        }

        soop.emit('join', {
            userId: soop.channel?.USERID,
            userName: soop.channel?.UNICK,
            userFlag: soop.userFlag,
            ...userInfo(soop, soop.userFlag)
        });
        break;
    }

    // 3
    case SVC.QUIT_CHANNEL: {
        soop.emit('quit', {
            type: Number(fields[2]),
            count: Number(fields[3]),
            adminName: fields[4]
        });

        soop.disconnect();
        break;
    }

    // 8
    case SVC.SET_DUMB: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        soop.emit('dumb', {
            time: Number(fields[2]),
            count: Number(fields[3]),
            adminId: fields[4],
            userId: fields[0],
            userName: fields[7],
            userFlag: fields[1],
            ...userInfo(
                soop, fields[1]
            )
        });
        break;
    }

    // 4
    case SVC.CHUSER: {
        const list = userList(soop, fields);

        if (!list) break;

        if (list.length > 1) {
            soop.emit('userList', list);
            break;
        }

        if (!list[0]) {
            break;
        }

        soop.emit('chuser', {
            type: Number(fields[0]),
            user: list[0]
        });
        break;
    }
    
    // 5
    case SVC.CHAT: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        soop.emit('chat', {
            message: fields[0],
            userId: fields[1],
            userName: fields[5],
            subMonth: Number(fields[7]),
            userFlag: fields[6],
            ...userInfo(
                soop, fields[6]
            )
        });
        break;
    }

    // 7
    case SVC.SET_BJ_STAT: {
        break;
    }

    // 9
    case SVC.DIRECT_CHAT: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        const type = Number(fields[3]);
        const toId = fields[1];
        const fromId = fields[2];

        soop.emit('directChat', {
            message: fields[0],
            toId,
            fromId,
            type,
            fromName: fields[5],
            toName: fields[6],
            userFlag: fields[7],
            ...userInfo(
                soop, fields[7]
            )
        });

        if (type === 1) {
            soop.direct = fromId;
        } else {
            soop.direct = toId;
        }
        break;
    }

    // 12
    case SVC.SET_USER_FLAG: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        soop.emit('userFlag', {
            flag: checkFlag(fields[0]),
            userId: fields[1],
            userName: fields[2]
        })
        break;
    }

    // 13
    case SVC.SET_SUB_BJ: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        soop.emit('subBj', {
            flag: checkFlag(fields[1]),
            userId: fields[0],
            userName: fields[3]
        })
        break;
    }

    // 14
    case SVC.SET_NICKNAME: {
        const result = {
            userFlag: checkFlag(fields[3]),
            userId: fields[0],
            newName: fields[1],
            type: Number(fields[2]),
            oldName: fields[4]
        }

        const user = soop.userList.get(result.userId);

        if (user) {
            user.name = result.newName;
        }

        soop.emit('nickName', result);
        break;
    }

    // 17
    case SVC.CLUB_COLOR: {
        break;
    }

    // 18
    case SVC.SEND_BALLOON: {
        const data = {
            bjId: fields[0],
            userId: fields[1],
            userName: fields[2],
            count: Number(fields[3]),
            fanOrder: Number(fields[4]),
            fileName: fields[7],
            isDefault: Number(fields[8]) === 1,
            topFan: Number(fields[9]),
            language: fields[12] || 'ko_KR',
            urlModify: fields[13]
        }

        soop.emit('balloon', {
             ...data,
             imageUrl: soop.makeBalloonUrl(data)
        });
        break;
    }

    // 19
    case SVC.ICE_MODE: {
        const type = Number(fields[0]);

        if (type === 1) {
            soop.iceMode = true;
        } else {
            soop.iceMode = false;
        }
        break;
    }

    // 20
    case SVC.SEND_FAN_LETTER: {
        const data = {
            bjId: fields[0],
            bjName: fields[1],
            userId: fields[2],
            userName: fields[3],
            type: Number(fields[5]),
            count: Number(fields[7]),
            supporterOrder: Number(fields[8]),
            language: fields[11] || 'ko_KR'
        };

        soop.emit('sticker', {
            ...data,
            imageUrl: soop.makeStickerUrl(
                data.type,
                data.language
            )
        });
        break;
    }

    // 22
    case SVC.ICE_MODE_EX: {
        soop.emit('iceMode', {
            index: Number(fields[0]),
            choice: Number(fields[1]),
            auth: parseIceAuth(fields[2]),
            count: Number(fields[3]),
            date: Number(fields[4])
        })
        break;
    }

    // 23
    case SVC.SLOW_MODE: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        soop.emit('slowMode', {
            count: Number(fields[1])
        });
        break;
    }

    // 26
    case SVC.MANAGER_CHAT: {
        if (error(fields, 2)){
            soop.emit('error', fields[0]);
            break;
        }

        soop.emit('managerChat', {
            message: fields[0],
            userId: fields[1],
            userName: fields[4],
            userFlag: fields[5],
            ...userInfo(
                soop, fields[5]
            )
        });
        break;
    }

    // 33
    case SVC.SEND_BALLOON_SUB: {
        const data = {
            bjId: fields[1],
            userId: fields[3],
            userName: fields[4],
            count: Number(fields[5]),
            fanOrder: Number(fields[6]),
            fileName: fields[8],
            isDefault: Number(fields[9]) === 1,
            topFan: Number(fields[10]),
            language: fields[12] || 'ko_KR',
            urlModify: fields[13],
        };
        
        soop.emit('balloon', {
             ...data,
             imageUrl: soop.makeBalloonUrl(data)
        });
        break;
    }

    // 34
    case SVC.SEND_FAN_LETTER_SUB: {
        const data = {
            bjId: fields[1],
            bjName: fields[2],
            userId: fields[3],
            userName: fields[4],
            type: Number(fields[6]),
            count: Number(fields[8]),
            supporterOrder: Number(fields[9]),
            language: fields[11] || 'ko_KR'
        };

        soop.emit('sticker', {
            ...data,
            imageUrl: soop.makeStickerUrl(
                data.type,
                data.language
            )
        });
        break;
    }

    // 45
    case SVC.SEND_QUICKVIEW: {
        const itemType = Number(fields[5]);

        soop.emit('quickview', {
            senderId: fields[1],
            senderName: fields[2],
            receiverId: fields[3],
            receiverName: fields[4],
            itemType,
            item: QUICKVIEW_TYPE[itemType]
        });
        break;
    }

    // 50
    case SVC.NOTIFY_POLL: {
        soop.poll = {
            status: Number(fields[0]),
            bjId: fields[1],
            surveyNo: Number(fields[2]),
            show: Number(fields[3])
        }

        soop.emit('poll', soop.poll);
        break;
    }

    // 54
    case SVC.BAN_WORD: {
        soop.before = fields[0];
        soop.after = fields[1]
            .split(DELIMITER.ACK);

        soop.emit('banWord', {
            before: soop.before,
            after: soop.after
        })
        break;
    }

    // 58
    case SVC.SEND_ADMIN_NOTICE: {
        soop.emit('adminNotice', {
            message: fields[0]
        })
        break;
    }

    // 76
    case SVC.KICK_AND_CANCEL: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        soop.emit('kickCancel', {
            type: Number(fields[0]),
            userId: fields[1],
            userName: fields[2],
            message: fields[2],
            raw: fields
        });
        break;
    }

    // 77
    case SVC.KICK_USER_LIST: {
        const list = kickList(soop, fields);

        if (!list) break;

        soop.emit('kickList', list);
        break;
    }

    // 86
    case SVC.VOD_BALLOON: {
        const data = {
            bjId: fields[0],
            userId: fields[1],
            userName: fields[2],
            count: Number(fields[3]),
            fileName: fields[4],
            isDefault: Number(fields[5]) === 1,
            chatNumber: fields[6],
            language: fields[7] || 'ko_KR',
            urlModify: fields[8]
        };
        soop.emit('vodBalloon', {
            ...data,
            imageUrl: soop.makeBalloonUrl(data)
        });
        break;
    }

    // 87
    case SVC.ADCON_EFFECT: {
        const url = normalize(fields[8]);

        soop.emit('adcon', {
            bjId: fields[1],
            userId: fields[2],
            userName: fields[3],
            count: Number(
                fields[9]
            ),
            fanOrder: Number(
                fields[10]
            ),
           topFan: Number(
                fields[11]
            ),
            isFanChief: Number(
                fields[12]
            ),
            imageUrl: url,
        });
        break;
    }

    // 88
    case SVC.CLOSE_BROAD: {
        soop.disconnect();
        break;
    }

    // 90
    case SVC.KICK_MSG_STATE: {
        soop.emit('kickState', {
            index: Number(fields[1])
        });
        break;
    }

    // 91
    case SVC.FOLLOW_ITEM: {
        const month = Number(fields[5]);
        const tier = Number(fields[7]);

        const urlModify = fields[10];

        const url = soop.makeGudokUrl(
            month, urlModify
        );

        soop.emit('follow', {
            bjId: fields[1],
            userId: fields[2],
            userName: fields[3],
            month,
            tier,
            tierName: tierName(soop, tier),
            imageUrl: url
        });
        break;
    }

    // 93
    case SVC.FOLLOW_ITEM_EFFECT: {
        const month = Number(fields[3]);
        const tier = Number(fields[7]);

        const url = new URL(
            `/subscription_ceremony/m/gudok_${month}.png`,
            DOMAIN.static
        );

        const urlModify = fields[10];

        if (urlModify) {
            url.href += `?v=${urlModify}`;
        }

        soop.emit('followEffect', {
            bjId: fields[0],
            userId: fields[1],
            userName: fields[2],
            month,
            accMonth: Number(fields[6]),
            tier,
            tierName: tierName(soop, tier),
            imageUrl: url.href
        });
        break;
    }

    // 94
    case SVC.TRANSLATION_STATE: {
        soop.emit('translationState', {
            index: Number(fields[0])
        });
        break;
    }

    // 95
    case SVC.TRANSLATION: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }
        
        const org = Number(fields[3]);
        const trans = Number(fields[4]);

        soop.emit('translation', {
            index: Number(fields[0]),
            mode: Number(fields[1]),
            message: fields[2],
            org,
            before: SUPPORTED_LANG[org],
            trans,
            after: SUPPORTED_LANG[trans]
        });
        break;
    }

    // 103
    case SVC.VOD_ADCON: {
        const url = normalize(fields[4]);

        soop.emit('vodAdcon', {
            bjId: fields[0],
            userId: fields[1],
            userName: fields[2],
            message: fields[5],
            count: Number(fields[3]),
            imageUrl: url
        });
        break;
    }

    // 104
    case SVC.BJ_NOTICE: {
        if (error(fields, 2)) {
            soop.emit('error', fields[0]);
            break;
        }

        soop.emit('notice', {
            state: Number(fields[1]),
            message: fields[3]
        })
        break;
    }

    // 105
    case SVC.VIDEO_BALLOON: {
        const url = new URL(
            '/new_player/items/m_video_balloon.png',
            DOMAIN.res
        );

        soop.emit('videoBalloon', {
            bjId: fields[1],
            userId: fields[2],
            userName: fields[3],
            count: Number(fields[4]),
            fanOrder: Number(fields[5]),
            topFan: Number(fields[7]),
            imageUrl: url.href,
            raw: fields
        });
        break;
    }

    // 107
    case SVC.STATION_ADCON: {
        const url = normalize(fields[4]);

        soop.emit('stationAdcon', {
            bjId: fields[0],
            userId: fields[1],
            userName: fields[2],
            count: Number(fields[3]),
            imageUrl: url,
        });
        break;
    }

    // 108
    case SVC.SEND_SUBSCRIPTION: {
        const itemType = Number(fields[7]);

        const item = subscription(itemType);

        if (!item) {
            soop.emit('subscription', {
                senderId: fields[1],
                senderName: fields[2],
                receiverId: fields[3],
                receiverName: fields[4],
                bjId: fields[5],
                bjName: fields[6],
                itemType
            });
            break;
        }

        soop.emit('subscription', {
            senderId: fields[1],
            senderName: fields[2],
            receiverId: fields[3],
            receiverName: fields[4],
            bjId: fields[5],
            bjName: fields[6],
            itemType,
            item,
            tier: item.tier,
            tierName: tierName(soop, item.tier)
        });
        break;
    }

    // 109
    case SVC.OGQ_EMOTICON: {
        const ogqId = fields[2];
        const subId = fields[3];

        const ext = Number(
            fields[17]
        ) === 1 ? 'webp' : 'png';

        const url = new URL(
            `/sticker/${ogqId}/${subId}.${ext}`,
            DOMAIN.ogq
        );

        soop.emit('ogq', {
            message: fields[1],
            ogqId,
            subId,

            subMonth: Number(fields[12]),
            imageUrl: url.href,

            userId: fields[5],
            userName: fields[6],
            userFlag: fields[7],
            ...userInfo(
                soop, fields[7]
            )
        })
        break;
    }

    // 110
    case SVC.PUNGASI_START_JSON: {
        break;
    }

    // 111
    case SVC.ITEM_DROPS: {
        soop.emit('drops', {
            message: fields[2]
        });
        break;
    }

    // 118
    case SVC.OGQ_EMOTICON_GIFT: {
        soop.emit('ogqGift', {
            senderId: fields[1],
            senderName: fields[2],
            receivedId: fields[3],
            receivedName: fields[4],
            title: fields[5],
            imageUrl: normalize(fields[6])
        });
        break;
    }

    // 119
    case SVC.AD_IN_BROAD_JSON: {
        let data = null;

        try {
            data = JSON.parse(fields[0]);
        } catch (error) {
            soop.emit('error', error);
        }

        soop.emit('adInBroad', data);
        break;
    }

    // 121
    case SVC.MISSION: {
        let data = null;

        try {
            data = JSON.parse(fields[0]);
        } catch (error) {
            soop.emit('error', error);
            break;
        }

        if (data.image) {
            const url = new URL(
                `/images/chat/mission/m_${data.image}.png`,
                DOMAIN.res
            );

            data.imageUrl = url.href;
        }

        if (data.type.startsWith('CHALL')) {
            soop.emit('challenge', data);
        } else {
            soop.emit('battle', data);
        }
        break;
    }

    // 125
    case SVC.MISSION_SETTLE: {
        let data = null;

        try {
            data = JSON.parse(fields[0]);
        } catch (error) {
            soop.emit('error', error);
            break;
        }
        
        soop.emit('missionSettle', data);
        break;
    }

    // 127
    case SVC.CHUSER_EXTEND: {
        const userId = fields[0];
        const user = soop.userList.get(userId);

        if (!user) break;

        Object.assign(
            user,
            parseMonth(fields[1])
        );

        soop.userList.set(
            userId,
            user
        );
        break;
    }

    // 130
    case SVC.SUB_CEREMONY_BUTTON: {
        soop.emit('subCeremony', {
            bjId: fields[1],
            userId: fields[2],
            userName: fields[3],
            month: Number(fields[4])
        });
        break;
    }

    // 136
    case SVC.GLOBAL_SUBTITLE: {
        const index = Number(fields[2]);

        soop.emit('subtitle', {
            bjId: fields[0],
            index,
            lang: SUBTITLE_LANG[index],
            message: fields[3]
        });
        break;
    }

    // 137
    case SVC.USER_LANG_SET: {
        const index = Number(fields[0]);

        soop.emit('userLang', {
            index,
            lang: SUBTITLE_LANG[index]
        });
        break;
    }

    default:
        soop.emit('packet', pkt);
        break;
    }
}

export function subscription(type) {
    type = Number(type);

    const basic = {
        1:  { month: 1, days: 30 },
        2:  { month: 3, days: 90 },
        3:  { month: 6, days: 180 },
        11: { month: 1, days: 30 },
    };

    if (basic[type]) {
        const { month, days } = basic[type];

        return {
            tier: 1,
            tierName: '베이직',
            month,
            days,
            label: `베이직 ${month}개월 구독 선물권`
        };
    }

    if (type === 12) {
        return {
            tier: 1,
            tierName: '베이직',
            month: 1,
            days: 30,
            isTrial: true,
            label: '베이직 1개월 구독 체험권'
        };
    }

    const plusGiftLevel = {
        20: 1,
        21: 2,
        23: 3,
        24: 4,
        25: 5,
    };

    if (plusGiftLevel[type]) {
        const level = plusGiftLevel[type];

        return {
            tier: 2,
            tierName: '플러스',
            level,
            month: 1,
            days: 30,
            label: `플러스 레벨${level} 1개월 구독 선물권`
        };
    }

    if (type >= 30 && type <= 34) {
        const level = type - 29;

        return {
            tier: 2,
            tierName: '플러스',
            level,
            month: 1,
            days: 30,
            isTrial: true,
            label: `플러스 레벨${level} 1개월 구독 체험권`
        };
    }

    return {
        tier: 0,
        tierName: '알 수 없음',
        level: 0,
        month: 0,
        days: 0,
        label: `알 수 없는 구독 타입(${type})`
    };
}

export const QUICKVIEW_TYPE = {
    1:   { name: '퀵뷰', days: 30,  plus: false },
    2:   { name: '퀵뷰', days: 90,  plus: false },
    3:   { name: '퀵뷰', days: 365, plus: false },

    100: { name: '퀵뷰 플러스', days: 7,   plus: true },
    101: { name: '퀵뷰 플러스', days: 30,  plus: true },
    102: { name: '퀵뷰 플러스', days: 90,  plus: true },
    103: { name: '퀵뷰 플러스', days: 365, plus: true },
};

export const SUBTITLE_LANG = {
    [-1]: { label: 'OFF', code: 'off' },
    0: { label: '한국어', code: 'ko_KR' },
    1: { label: 'English', code: 'en_US' },
    2: { label: 'ไทย', code: 'th_TH' },
    3: { label: '中文 繁體', code: 'zh_TW' },
    4: { label: '中文 简体', code: 'zh_CN' },
    5: { label: '日本語', code: 'ja_JP' },
    6: { label: 'Tiếng Việt', code: 'vi_VN' },
    7: { label: 'Indonesia', code: 'id_ID' }
};

export const SUPPORTED_LANG = {
    0: { label: '🌏', code: 'auto' },
    1: { label: 'English', code: 'en_US' },
    2: { label: '日本語', code: 'ja_JP' },
    3: { label: '한국어', code: 'ko_KR' },
    4: { label: '中文 简体', code: 'zh_CN' },
    5: { label: '中文 繁體', code: 'zh_TW' },
    6: { label: 'ไทย', code: 'th_TH' },
    7: { label: 'Tiếng Việt', code: 'vi_VN' },
};

export function error(fields, length) {
    return fields.length < length;
}

export function userList(soop, fields = []) {
    const type = Number(fields[0]);
    const users = [];

    if (type === 1) {
        for (let i = 1; i < fields.length; i += 3) {
            const id = fields[i];

            if (!id) continue;

            const user = {
                id,
                name: fields[i + 1],
                flag: fields[i + 2],
                ...userInfo(
                    soop, fields[i + 2]
                )
            };

            soop.userList.set(id, user);
            users.push(user);
        }

        return users;
    }

    if (type === -1) {
        const id = fields[1];

        if (!id) return users;

        const user = {
            id,
            name: fields[2],
            exit: Number(fields[3]),
            count: Number(fields[4]),
            flag: fields[5],
            ...userInfo(
                soop, fields[5]
            )
        }

        soop.userList.delete(id);
        users.push(user);

        return users;
    }

    return users;
}

export function kickList(soop, fields = []) {
    const kicks = [];

    for (let i = 0; i < fields.length; i += 6) {
        const userId = fields[i];

        if (!userId) continue;

        const kick = {
            userId,
            userName: fields[i + 1],
            date: fields[i + 2],
            adminId: fields[i + 3],
            adminName: fields[i + 4],
            flag: fields[i + 5],
            ...userInfo(
                soop, fields[i + 5]
            )
        };

        kicks.push(kick);
    }

    return kicks;
}

export function splitFlag(flag = '0|0') {
    const [
        flag1 = 0, flag2 = 0
    ] = String(flag).split('|');

    return {
        flag1: Number(flag1) || 0,
        flag2: Number(flag2) || 0
    };
}

export function hasFlag(value = 0, flag = 0) {
    return (value & flag) === flag;
}

export function checkFlag(flag = '0|0') {
    const {
        flag1, flag2
    } = splitFlag(flag);

    return {
        flag1,
        flag2,
        ...checkFlag1(flag1),
        ...checkFlag2(flag2),
    };
}

export function checkFlag1(flag1 = 0) {
    flag1 = Number(flag1) || 0;
    return {
        isAdmin: hasFlag(flag1,
            USER_FLAG1.ADMIN
        ),
        isHidden: hasFlag(flag1,
            USER_FLAG1.HIDDEN
        ),
        isBJ: hasFlag(flag1,
            USER_FLAG1.BJ
        ),
        isGuest: hasFlag(flag1,
            USER_FLAG1.GUEST
        ),
        isFanClub: hasFlag(flag1,
            USER_FLAG1.FANCLUB
        ),
        isManager: hasFlag(flag1,
            USER_FLAG1.MANAGER
        ),
        isMobile: hasFlag(flag1,
            USER_FLAG1.MOBILE
        ),
        isTopFan: hasFlag(flag1,
            USER_FLAG1.TOP_FAN
        ),
        isRealName: hasFlag(flag1,
            USER_FLAG1.REAL_NAME
        ),
        isQuickView: hasFlag(flag1,
            USER_FLAG1.QUICKVIEW
        ),
        isMobileWeb: hasFlag(flag1,
            USER_FLAG1.MOBILE_WEB
        ),
        isNightBot: hasFlag(flag1,
            USER_FLAG1.NIGHTBOT
        ),
        isBlock: hasFlag(flag1,
            USER_FLAG1.BLOCK
        )
    };
}

export function checkFlag2(flag2 = 0) {
    flag2 = Number(flag2) || 0;
    return {
        isGlobalPc: hasFlag(flag2,
            USER_FLAG2.GLOBAL_PC
        ),
        isClan: hasFlag(flag2,
            USER_FLAG2.CLAN
        ),
        isTopClan: hasFlag(flag2,
            USER_FLAG2.TOP_CLAN
        ),
        isTop20: hasFlag(flag2,
            USER_FLAG2.TOP_20
        ),
        isEmployee: hasFlag(flag2,
            USER_FLAG2.EMPLOYEE
        ),
        isCleanAti: hasFlag(flag2,
            USER_FLAG2.CLEAN_ATI
        ),
        isPolice: hasFlag(flag2,
            USER_FLAG2.POLICE
        ),
        isAdminChat: hasFlag(flag2,
            USER_FLAG2.ADMIN_CHAT
        ),
        isPc: hasFlag(flag2,
            USER_FLAG2.PC
        ),
        isSpecify: hasFlag(flag2,
            USER_FLAG2.SPECIFY
        ),
        isTier1: hasFlag(flag2,
            USER_FLAG2.FOLLOW_TIER1
        ),
        isTier2: hasFlag(flag2,
            USER_FLAG2.FOLLOW_TIER2
        ),
        isTier3: hasFlag(flag2,
            USER_FLAG2.FOLLOW_TIER3
        )
    };
}

export function parseIceAuth(mask = 0) {
    mask = Number(mask) || 0;

    return {
        isStreamerAllowed: hasFlag(mask,
            ICE_AUTH.STREAMER
        ),
        isFanClubAllowed: hasFlag(mask,
            ICE_AUTH.FAN_CLUB
        ),
        isSupporterAllowed: hasFlag(mask,
            ICE_AUTH.SUPPORTER
        ),
        isTopFanAllowed: hasFlag(mask,
            ICE_AUTH.TOP_FAN
        ),
        isSubscriberAllowed: hasFlag(mask,
            ICE_AUTH.SUBSCRIBER
        ),
        isManagerAllowed: hasFlag(mask,
            ICE_AUTH.MANAGER
        ),
    };
}

export function userInfo(soop, flag = '0|0') {
    const info = checkFlag(flag);

    let role = '일반';

    if (info.isBJ) role = '스트리머';
    else if (info.isManager) role = '매니저';
    else if (info.isTopFan) role = '열혈';
    else if (info.isFanClub) role = '팬';
    else if (info.isNightBot) role = '봇';
    else if (info.isAdmin
        || info.isAdminChat) role = '운영자';

    let tier = 0;

    if (info.isTier1) tier = 1;
    else if (info.isTier2) tier = 2;

    let tierName = '';

    if (info.isTier1) tierName = (
        soop.channel?.TIER1_NICK || '베이직'
    );
    else if (info.isTier2) tierName = (
        soop.channel?.TIER2_NICK || '플러스'
    );

    return { role, tier, tierName, ...info };
}

export function tierName(soop, count = 0) {
    let tier = '';

    if (count === 1) tier = (
        soop.channel?.TIER1_NICK || '베이직'
    );
    else if (count === 2) tier = (
        soop.channel?.TIER2_NICK || '플러스'
    );

    return tier;
}

export function parseMonth(value = '') {
    const p = new URLSearchParams(value);
    const fw = Number(p.get('fw'));
    const afw = Number(p.get('afw'));

    return {
        fw: fw > 0 ? fw : 0,
        afw: afw > 0 ? afw : 0
    }
}