import { config } from 'dotenv';
import readline from 'readline';
import fs from 'fs';
import { SoopClient } from '#soop/client';
import { SoopMacro } from '#soop/macro';
import * as notify from '#soop/notify';
import { openEditor } from '#soop/editor';
import { DOMAIN } from '#soop/config';
import * as http from '#soop/http';
import * as control from '#soop/control';
import * as log from '#utils/log';
import * as weflab from '#utils/weflab';
import { parseEnv } from '#utils/env';
import { load, get } from '#utils/config';
import { readSession } from './soop/editor/launch.js';
import { readRecovery, stopRecovery } from './soop/editor/runtime.js';

config({ quiet: true });
const session = readSession();
const recovery = await readRecovery(session);

if (session && recovery?.settings) {
  Object.assign(session, recovery.settings);
}

if (session?.lock && process.env.SOOPWORKER !== '1') {
  process.on('exit', () => {
    try {
      const lease = JSON.parse(fs.readFileSync(session.lock, 'utf8'));

      if (lease.id === session.lease) {
        fs.rmSync(session.lock, { force: true });
      }
    } catch {}
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: ''
});

let client, isLink, isList;
let mode, macro, editor, stopTask;
let login;

(async () => {
  loadConfig();

  const bjId = getConfig('bjId');
  const broadPw = getConfig('broadPw');
  const auto = getConfig('auto');
  const cookie = getConfig('cookie');

  isLink = getConfig('isLink') ?? true;
  isList = getConfig('isList') ?? false;

  const pver = getConfig('pver');
  const subtitle = getConfig('subtitle');

  mode = getConfig('mode') ?? 0;

  client = new SoopClient({
    bjId,
    broadPw,
    auto,
    scheduled: getConfig('scheduled'),
    pver,
    subtitle,
    idle: process.env.IDLE?.toLowerCase() === 'true',
    userAgent: process.env.USER_AGENT || undefined
  });

  if (session || recovery?.settings) {
    const account = recovery?.settings || session;
    client.cookie = account.cookie || undefined;
    client.info = recovery?.stored ? null : account.info || null;
    client.signedout = !account.cookie;
  }

  new notify.SoopNotify(client, {
    editor: () => {
      const origin = getConfig('origins')?.[0];

      return session && origin
        ? new URL(`/${session.port - session.range.start + 1}/`, origin).href : origin || editor?.url;
    }
  });

  client.on('live', data => {
    if (data.result === -1 && data.message) {
      log.warn('[알림]', `\x1b[1m${data.message}\x1b[0m`);

      return;
    }

    let message = '';

    switch (data.code) {
      case 3:
        message = `${data.bjNick}(${data.bjId})님 방송은 오프라인입니다.`;
        break;

      case 2:
        message = `${data.bjNick}(${data.bjId})님 방송은 비밀번호 입력 후 입장이 가능합니다.`;
        break;

      case 1:
        return;

      case 0:
        return;

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

  const contents = {
    post: ['게시글', '새 글을 작성했습니다.'],
    edit: ['게시글 수정', '게시글을 수정했습니다.'],
    clip: ['클립', '새 클립을 등록했습니다.'],
    catch: ['캐치', '새 캐치를 등록했습니다.']
  };

  for (const [event, [label, action]] of Object.entries(contents)) {
    client.on(event, data => {
      if (isLink && data.url) {
        log.load(`[${label}]`, data.url);
      }

      const content = ['post', 'edit'].includes(event) && data.type === 'post'
        ? notify.preview(data.content, Infinity) : '';
      const message =
        `${data.bjNick}님이 ${action} | `
        + `제목: ${data.title} | `
        + `작성일: ${data.regDate}`
        + (content ? ` | 내용: ${content}` : '');

      log.info('\x1b[94m[알림]\x1b[0m', `\x1b[1m${message}\x1b[0m`);
    });
  }

  for (const event of ['remove', 'visibility']) {
    client.on(event, data => {
      const label = { post: '게시글', clip: '클립', catch: '캐치' }[data.type];
      let action;

      if (event === 'remove') {
        action = '삭제';
      }
      else {
        if (data.public) {
          action = '공개 전환';
        }
        else {
          action = '비공개 전환';
        }
      }

      if (isLink && data.url) {
        log.load(`[${label}]`, data.url);
      }

      log.info(`[${label} ${action}]`, data.title);
    });
  }

  const comments = {
    comment: '작성',
    update: '수정',
    delete: '삭제'
  };

  for (const [event, action] of Object.entries(comments)) {
    client.on(event, data => {
      const label = data.parentCommentNo ? '답글' : '댓글';

      if (isLink && data.url) {
        log.load(`[${label}]`, data.url);
      }

      log.info(
        `[${label} ${action}]`,
        `${data.userNick}(${data.userId}) | 게시글: ${data.title} | ${notify.preview(data.message, Infinity)}`
      );
    });
  }

  for (const event of ['like', 'unlike']) {
    client.on(event, data => {
      const content = { post: '게시글', clip: '클립', catch: '캐치' }[data.contentType || data.type] || '게시글';
      const label = { comment: '댓글', reply: '답글' }[data.type] || content;
      const action = event === 'like' ? '좋아요' : '좋아요 취소';

      if (isLink && data.url) {
        log.load(`[${label}]`, data.url);
      }

      let message = `${content}: ${data.title}`;

      if (['comment', 'reply'].includes(data.type)) {
        message += ` | 작성자: ${data.userNick}(${data.userId}) | ${data.message}`;
      }

      message += ` | ${data.before} → ${data.likes}개`;
      log.info(`[${label} ${action}]`, message);
    });
  }

  client.on('open', data => {
    let message = '';

    if (data.broad.title) {
      message += `방송 제목: ${data.broad.title} | `;
    }

    if (data.broad.category) {
      message += `카테고리: ${data.broad.category} | `;
    }

    if (data.broad.hashtag) {
      message += `태그: ${data.broad.hashtag} | `;
    }

    message += `${data.bjNick}(${data.bjId})님 방송에 입장하였습니다.`;

    log.info('[시작]', `\x1b[1m${message}\x1b[0m`);
  });

  client.on('join', data => {
    let message = '';

    if (data.userId) {
      message = `${data.userNick}(${data.userId})님이 대화방에 참여했습니다.`;
    }
    else {
      message = `비로그인 사용자가 대화방에 참여했습니다.`;
    }

    log.info('[입장]', `[${data.role}]`, `\x1b[1m${message}\x1b[0m`);
  });

  client.on('rule', data => {
    if (data.chat_rule_display > 0) {
      log.info('[규칙]', `\x1b[1m${data.chat_rule}\x1b[0m`);
    }
  });

  client.on('title', data => {
    log.warn('[제목 변경]', `\x1b[1m${data.prev} → ${data.title}\x1b[0m`);
  });

  client.on('category', data => {
    log.warn('[카테고리 변경]', `\x1b[1m${data.prev} → ${data.category}\x1b[0m`);
  });

  client.on('hashtag', data => {
    const before = data.prev || '없음';
    const after = data.hashtag || '없음';

    log.warn('[태그 변경]', `\x1b[1m${before} → ${after}\x1b[0m`);
  });

  client.on('bridge', data => {
    log.debug('[BRIDGE]', `\x1b[1m${data}\x1b[0m`);
  });

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

  client.on('dumb', data => {
    let message = '';

    if (data.count > 2) {
      message =
        '님이 채팅금지 횟수 초과로 블라인드 처리 되었습니다. '
        + `${data.count}초 동안 채팅과 방송화면을 볼 수 없습니다.`;
    }
    else {
      message = `님이 채팅금지(${data.time}초) ${data.count}회가 되었습니다.`;
    }

    const admin = client.userList.get(data.adminId);
    const name = admin ? admin.name : data.adminId;

    log.error(
      '[채금]',
      `\x1b[1m${data.userNick}(${data.userId})${message}`,
      `(처리자: ${name})\x1b[0m`
    );
  });

  client.on('userList', data => {
    if (isList) {
      const start = client.userList.size - data.length;

      const list = data
        .map((user, index) => {
          const result = `${start + index + 1}. ${user.name}(${user.id}) [${user.role}]`;

          return result;
        })
        .join('\n');

      log.info(`[참여인원]\n${list}`);
    }
  });

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

    message = `${data.user.name}(${data.user.id})님이 강퇴되었습니다. (누적 ${data.user.count}회)`;

    log.error('[퇴장]', `[${data.user.role}]`, `\x1b[1m${message}\x1b[0m`);
  });

  client.on('chat', data => {
    if (!showChat(data)) {
      return;
    }

    if (isLink) {
      const extras = client.findAssets(data);

      for (const item of extras.emoticons) {
        log.info('\x1b[38;5;187m[이모티콘]', item.keyword, item.smallUrl);
      }

      if (extras.tierUrl) {
        log.load('[구독]', extras.tierUrl);
      }
    }

    let badge;

    if (data.tier) {
      badge = `${data.tierName} | ${data.subMonth}개월] [${data.role}`;
    }
    else {
      badge = data.role;
    }

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

    log.info(
      '\x1b[94m[채팅]\x1b[0m',
      badge,
      `${data.userNick}(${data.userId}): ${data.message}`
    );
  });

  client.on('directChat', data => {
    if (isLink) {
      const extras = client.findAssets(data);

      for (const item of extras.emoticons) {
        log.info('\x1b[38;5;187m[이모티콘]', item.keyword, item.smallUrl);
      }

      if (extras.tierUrl) {
        log.load('[구독]', extras.tierUrl);
      }
    }

    let message = '';

    if (data.type === 1) {
      message = `${data.fromNick}(${data.fromId})님의 귓말 ${data.message}`;
    }
    else {
      message = `${data.toNick}(${data.toId})님에게 귓말 ${data.message}`;
    }

    let badge;

    if (data.tier) {
      badge = `${data.tier} | ${data.subMonth}개월] [${data.role}`;
    }
    else {
      badge = data.role;
    }

    log.load('[귓속말]', `\x1b[1m[${badge}]`, `${message}\x1b[0m`);
  });

  client.on('userFlag', data => {
    const flag = data.flag.isBlock ? '거부' : '허용';

    log.debug(
      '[알림]',
      `${data.userNick}(${data.userId})님이 귓속말 ${flag} 하셨습니다.`
    );
  });

  client.on('subBj', data => {
    let message;

    if (data.flag.isManager) {
      message = '님이 매니저가 되셨습니다.';
    }
    else {
      message = '님이 매니저에서 해임 되셨습니다.';
    }

    log.cmd('[알림]', `\x1b[1m${data.userNick}(${data.userId})${message}\x1b[0m`);
  });

  client.on('nickName', data => {
    log.debug(
      '[알림]',
      `${data.oldNick}(${data.userId})님이 ${data.newNick} 닉네임으로 변경 하셨습니다.`
    );
  });

  client.on('sticker', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    log.warn(
      '[스티커]',
      `\x1b[1m${data.userNick}(${data.userId})님이 스티커 ${data.count}개를 선물 하셨습니다.\x1b[0m`
    );

    if (data.supporterOrder > 0) {
      log.info(
        '\x1b[38;2;117;170;92m\x1b[1m[서포터]',
        `${data.userNick}님이 ${data.supporterOrder}번째 서포터가 되셨습니다.\x1b[0m`
      );
    }
  });

  client.on('iceMode', data => {
    if (data.index === 0) {
      log.cmd('[얼음]', '\x1b[1m채팅을 녹였습니다. 채팅에 참여 하실 수 있습니다.\x1b[0m');

      return;
    }

    const { auth, count, date } = data;

    const names = [
      auth.isStreamerAllowed && '스트리머',
      auth.isTopFanAllowed && '열혈팬',
      auth.isSubscriberAllowed && (date > 0 ? `구독팬(${date}개월↑)` : '구독팬'),
      auth.isFanClubAllowed && (count > 0 ? `팬클럽(${count}개↑)` : '팬클럽'),
      auth.isSupporterAllowed && '서포터',
      auth.isManagerAllowed && '매니저'
    ].filter(Boolean);

    log.cmd(
      '[얼음]',
      `\x1b[1m채팅을 얼렸습니다. ${names.join(', ')}만 채팅에 참여할 수 있습니다.\x1b[0m`
    );
  });

  client.on('slowMode', data => {
    if (data.count > 0) {
      log.debug(
        '[알림]',
        '저속모드가 활성화되었습니다.',
        `${data.count}초 간격으로 채팅 입력이 가능합니다.`
      );
    }
    else {
      log.debug(
        '[알림]',
        '저속모드가 비활성화되었습니다.',
        '지연 없이 채팅 입력이 가능합니다.'
      );
    }
  });

  client.on('managerChat', data => {
    if (isLink) {
      const extras = client.findAssets(data);

      for (const item of extras.emoticons) {
        log.info('\x1b[38;5;187m[이모티콘]', item.keyword, item.smallUrl);
      }

      if (extras.tierUrl) {
        log.load('[구독]', extras.tierUrl);
      }
    }

    let badge;

    if (data.tier) {
      badge = `${data.tierName} | ${data.subMonth}개월] [${data.role}`;
    }
    else {
      badge = data.role;
    }

    switch (data.role) {
      case '스트리머':
        badge = `\x1b[38;2;255;102;0m[${badge}]\x1b[0m\x1b[1m`;
        break;

      default:
        badge = `\x1b[38;2;83;177;174m[${badge}]\x1b[0m`;
        break;
    }

    log.info(
      '\x1b[91m[매니저 채팅]\x1b[0m',
      `\x1b[1m${badge}`,
      `${data.userNick}(${data.userId}): ${data.message}\x1b[0m`
    );
  });

  client.on('quickview', data => {
    if (!data.item) {
      log.warn('[퀵뷰 선물]', '알 수 없는 퀵뷰 타입입니다.');

      return;
    }

    log.warn(
      data.item?.plus ? '[퀵뷰 플러스 선물]' : '[퀵뷰 선물]',
      `${data.fromNick}(${data.fromId})님이`,
      `${data.toNick}(${data.toId})님에게`,
      `${data.item.name} ${data.item.days}일권 선물 하셨습니다.`
    );
  });

  client.on('poll', async data => {
    let message = '';
    let poll = null;

    try {
      poll = await client.sendPollList(data.surveyNo);
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

    const list = (poll.data?.list || [])
      .map(item => `${item.answer_no}. ${item.answer_title}. (${item.answer_total}표)`)
      .join('\n');

    log.load(`\x1b[1m${poll.data?.title} (${poll.data?.start_tm})\n${list}\x1b[0m`);
  });

  client.on('banWord', data => {
    if (data.after?.[0]) {
      log.info(
        '[알림]',
        '금칙어가 적용되어있습니다.',
        `(금칙어: ${data.after.join(', ')} /`,
        `대체어: ${data.before})`
      );
    }
  });

  client.on('adminNotice', data => {
    log.warn('[SOOP 안내]', `\x1b[1m${data.message}\x1b[0m`);
  });

  client.on('kickCancel', data => {
    if (data.type === 0) {
      log.debug(
        '[알림]',
        `${data.userNick}(${data.userId})님이 강제퇴장했습니다.`,
        data.message
      );
    }
    else {
      log.debug(
        '[알림]',
        `${data.userNick}(${data.userId})님의 강제퇴장이 취소되었습니다.`,
        data.message
      );
    }
  });

  client.on('kickList', data => {
    if (data.length === 0) {
      log.info('[알림]', '강제퇴장 인원이 없습니다.');

      return;
    }

    log.info(
      '[알림]',
      '강제퇴장',
      `총 인원 (${data.length})`,
      '\n──────────────────────────────\n'
        + data
          .map((item, i) => {
            return [
              `${i + 1}. ${item.userNick}(${item.userId})`,
              `   처리 시간: ${item.date}`,
              `   처리자: ${item.adminNick}(${item.adminId})`
            ].join('\n');
          })
          .join('\n\n')
        + '\n──────────────────────────────\n'
    );
  });

  client.on('kickState', data => {
    const enabled = data.index === 0 ? '켜짐' : '꺼짐';

    log.debug('[알림]', `유저에게 강제 퇴장 메시지 표시: ${enabled}`);
  });

  client.on('follow', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    const tier = data.tier === 1 ? '베이직' : '플러스';

    const tierName = tier !== data.tierName ? `${tier} ${data.tierName}` : `${tier}`;

    log.warn(
      '[구독]',
      `\x1b[1m${data.userNick}(${data.userId})님이 ${tierName} ${data.month}개월 구독하였습니다.\x1b[0m`
    );
  });

  client.on('followEffect', data => {
    if (isLink) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    const tier = data.tier === 1 ? '베이직' : '플러스';

    const tierName = tier !== data.tierName ? `${tier} ${data.tierName}` : `${tier}`;

    log.warn(
      '[연속 구독]',
      `\x1b[1m${data.userNick}(${data.userId})님이 ${tierName} ${data.month}개월째 구독 중입니다. (누적 ${data.accMonth}개월)\x1b[0m`
    );
  });

  client.on('translationState', data => {
    const enabled = data.index === 1 ? '켜짐' : '꺼짐';

    log.debug('[알림]', `채팅 번역 기능: ${enabled}`);
  });

  client.on('translation', data => {
    if (data.preview) {
      return;
    }

    log.info(
      '[번역]',
      `\x1b[1m${data.message} (${data.before.label} → ${data.after.label})\x1b[0m`
    );

    if (data.mode === 2) {
      rl.write(data.message);
    }
  });

  client.on('notice', data => {
    if (data.state > 0) {
      log.info('[공지]', `\x1b[1m${data.message}\x1b[0m`);
    }
  });

  client.on('subscription', data => {
    if (!data.item) {
      log.warn('[구독권 선물]', '알 수 없는 구독권 타입입니다.');

      return;
    }

    let tierName;

    if (data.item.tierName !== data.tierName) {
      tierName = `${data.item.tierName} ${data.tierName}`;
    }
    else {
      tierName = data.item.tierName;
    }

    log.warn(
      '[구독권 선물]',
      `\x1b[1m${data.fromNick}(${data.fromId})님이 `
        + `${data.toNick}(${data.toId})님에게 `
        + `${tierName} ${data.item.month}개월 구독권을 선물 하셨습니다.\x1b[0m`
    );
  });

  client.on('ogq', data => {
    if (!showChat(data)) {
      return;
    }

    let badge;

    if (data.tier) {
      badge = `${data.tierName} | ${data.subMonth}개월] [${data.role}`;
    }
    else {
      badge = data.role;
    }

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

    if (isLink) {
      const extras = client.findAssets(data);

      for (const item of extras.emoticons) {
        log.info('\x1b[38;5;187m[이모티콘]', item.keyword, item.smallUrl);
      }

      if (extras.tierUrl) {
        log.load('[구독]', extras.tierUrl);
      }

      log.warn(
        '[OGQ]',
        badge,
        `${data.userNick}(${data.userId})${message}`,
        data.imageUrl
      );
    }
    else if (data.message) {
      log.info(
        '\x1b[94m[채팅]\x1b[0m',
        badge,
        `${data.userNick}(${data.userId})${message}`
      );
    }
  });

  client.on('drops', data => {
    log.info(
      '[알림]',
      `\x1b[1m${data.message} 드롭스 추첨 완료! 당첨자에게 쪽지가 전달되었습니다.\x1b[0m`
    );
  });

  client.on('ogqGift', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    log.warn(
      '[OGQ 선물]',
      `\x1b[1m${data.fromNick}(${data.fromId})님이 `
        + `${data.receivedName}(${data.receivedId})님에게 `
        + `${data.title} OGQ 이모티콘을 선물 하셨습니다.\x1b[0m`
    );
  });

  client.on('adInBroad', data => {
    let message = '';

    if (data.ad_in_room === 1) {
      message = '쉬는시간이 설정되었습니다. 쉬는시간에도 채팅입력이 가능합니다.';
    }
    else {
      message = '쉬는시간이 종료되었습니다.';
    }

    log.warn('[알림]', message);
  });

  client.on('balloon', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    log.warn(
      '[후원]',
      `\x1b[1m${data.userNick}(${data.userId}) 별풍선 ${data.count}개를 선물 하셨습니다.\x1b[0m`
    );

    if (data.fanOrder > 0) {
      log.info(
        '\x1b[38;2;117;170;92m\x1b[1m[팬클럽]',
        `${data.userNick}님이 ${data.fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`
      );
    }

    if (data.topFan > 0) {
      log.info(
        '\x1b[38;2;214;91;143m\x1b[1m[열혈팬]',
        `${data.userNick}님이 열혈팬이 되셨습니다.\x1b[0m`
      );
    }
  });

  client.on('adcon', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    log.warn(
      '[후원]',
      `\x1b[1m${data.userNick}(${data.userId}) 애드벌룬 ${data.count}개를 선물 하셨습니다.\x1b[0m`
    );

    if (data.fanOrder > 0) {
      log.info(
        '\x1b[38;2;117;170;92m\x1b[1m[팬클럽]',
        `${data.userNick}님이 ${data.fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`
      );
    }

    if (data.topFan > 0) {
      log.info(
        '\x1b[38;2;214;91;143m\x1b[1m[열혈팬]',
        `${data.userNick}님이 열혈팬이 되셨습니다.\x1b[0m`
      );
    }
  });

  client.on('videoBalloon', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    log.warn(
      '[영상 후원]',
      `\x1b[1m${data.userNick}(${data.userId}) 영상 풍선 ${data.count}개를 선물 하셨습니다.\x1b[0m`,
      data.raw
    );

    if (data.fanOrder > 0) {
      log.info(
        '\x1b[38;2;117;170;92m\x1b[1m[팬클럽]',
        `${data.userNick}님이 ${data.fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`
      );
    }

    if (data.topFan > 0) {
      log.info(
        '\x1b[38;2;214;91;143m\x1b[1m[열혈팬]',
        `${data.userNick}님이 열혈팬이 되셨습니다.\x1b[0m`
      );
    }
  });

  client.on('vodBalloon', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    log.warn(
      '[후원]',
      `\x1b[1m${data.userNick}(${data.userId}) VOD 별풍선 ${data.count}개를 선물 하셨습니다.\x1b[0m`
    );
  });

  client.on('vodAdcon', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    log.warn(
      '[후원]',
      `\x1b[1m${data.userNick}(${data.userId}) VOD 애드벌룬 ${data.count}개를 선물 하셨습니다.\x1b[0m`
    );

    if (data.fanOrder === 1) {
      log.info(
        '\x1b[38;2;117;170;92m\x1b[1m[팬클럽]',
        `${data.userNick}님이 ${data.fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`
      );
    }

    if (data.topFan === 1) {
      log.info(
        '\x1b[38;2;214;91;143m\x1b[1m[열혈팬]',
        `${data.userNick}님이 열혈팬이 되셨습니다.\x1b[0m`
      );
    }
  });

  client.on('stationAdcon', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

    log.warn(
      '[후원]',
      `\x1b[1m방송국에서 ${data.userNick}(${data.userId})님이 애드벌룬 ${data.count}개를 선물 하셨습니다.\x1b[0m`
    );
  });

  client.on('challenge', data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

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

  client.on('battle', async data => {
    if (isLink && data.imageUrl) {
      log.info('\x1b[38;5;187m[이미지]', data.imageUrl);
    }

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

    if (data.test) {
      return;
    }

    let mission;

    try {
      mission = await client.sendMissionList();
    } catch (error) {
      log.error('[대결미션]', error);

      return;
    }

    if (!mission.ok) {
      log.warn('[대결미션]', mission.message);

      return;
    }

    log.load(
      '\x1b[1m'
        + [
          `[대결미션] ${mission.title}`,
          `상태: ${mission.status}`,
          `총 후원: ${mission.total}개`,
          `팀:\n${mission.teams}`
        ].join('\n')
        + '\x1b[0m'
    );
  });

  client.on('missionSettle', data => {
    let fanOrder = Number(data.fanOrder);

    for (const item of data.list) {
      const userId = item[0];
      const userNick = item[1];
      const count = item[2];
      const isFanClub = item[3];
      const isTopFan = item[4];

      log.warn(
        '[후원]',
        `\x1b[1m${userNick}(${userId})님 미션 정산으로 별풍선 ${count}개를 받았습니다.\x1b[0m`
      );

      if (isFanClub === 1) {
        log.info(
          '\x1b[38;2;117;170;92m\x1b[1m[팬클럽]',
          `${userNick}(${userId})님이 ${fanOrder}번째 팬클럽이 되셨습니다.\x1b[0m`
        );

        fanOrder++;
      }

      if (isTopFan === 1) {
        log.info(
          '\x1b[38;2;214;91;143m\x1b[1m[열혈팬]',
          `${userNick}님이 열혈팬이 되셨습니다.\x1b[0m`
        );
      }
    }
  });

  client.on('subCeremony', data => {
    log.warn(
      '[구독]',
      `\x1b[1m${data.userNick}(${data.userId})님이 ${data.month}개월 구독중입니다.\x1b[0m`
    );
  });

  client.on('subtitle', data => {
    log.info('\x1b[91m[자막]\x1b[0m', `\x1b[1m${data.message}\x1b[0m`);
  });

  client.on('userLang', data => {
    let message = '';

    if (data.index < 0) {
      message = '자막 언어 설정이 꺼져있습니다.';
    }
    else {
      message = '자막 언어 설정이 변경되었습니다.';
    }

    log.info('[알림]', message, data.lang.label);
  });

  client.on('session', data => {
    log.warn(
      '[세션]',
      `방송 세션이 변경되어 재연결합니다.\n`
        + `제목: ${data.before?.TITLE} → ${data.after?.TITLE}\n`
        + `BNO: ${data.before?.BNO} → ${data.after?.BNO}\n`
        + `CHATNO: ${data.before?.CHATNO} → ${data.after?.CHATNO}`
    );
  });

  client.on('error', error => {
    log.error('[에러]', error);
  });

  client.on('close', data => {
    clearTimeout(login);
    login = null;

    let message = '';

    if (data.message) {
      message =
        `종료 메시지: ${data.message}\n`
        + `${data.bjNick}(${data.bjId})님 방송이 종료되었습니다.\n`
        + '방송이 종료된 후에는 채팅에 참여하실 수 없습니다.';
    }
    else {
      message = `${data.bjNick}(${data.bjId})님 방송을 퇴장하였습니다.`;
    }

    log.info('[종료]', message);
  });

  client.on('packet', data => {
    log.warn('[PACKET]', {
      CODE: data.service,
      SIZE: data.length,
      FLAG: data.flag,
      DATA: data.fields
    });
  });

  client.on('macro', data => {
    log.info('[매크로]', data.type === 'send' ? '전송 완료' : data.message);
  });

  macro = new SoopMacro(client, {
    file: process.env.MACROS || undefined,
    weflab: () => getConfig('weflab')
  });

  if (getConfig('editor') !== false) {
    try {
      await edit();
    } catch (error) {
      log.error('[설정]', error.message || '편집 화면 열기 실패');
    }
  }

  const authenticate = async () => {
    if (cookie) {
      client.cookie = cookie;

      return;
    }

    const result = await client.login(
      getConfig('userId'),
      getConfig('password'),
      getConfig('secondPw')
    );

    if (result !== 1) {
      throw new Error('로그인 실패');
    }
  };

  let authenticating;

  client.on('live', data => {
    const required = [-6, -8].includes(Number(data.code));
    const configured = cookie || getConfig('userId');

    if (
      !required
      || !configured
      || client.cookie
      || authenticating
      || stopTask
      || client.signedout
    ) {
      return;
    }

    const bjId = client.bjId;

    authenticating = client
      .safe(async () => {
        await client.connecting;

        if (stopTask || client.closed || client.bjId !== bjId || client.signedout) {
          return;
        }

        await authenticate();

        if (stopTask || client.closed || client.bjId !== bjId) {
          return;
        }

        await client.connect();
      })
      .finally(() => {
        authenticating = null;
      });
  });

  client.on('join', () => {
    clearTimeout(login);
    login = null;

    if (
      stopTask
      || client.cookie
      || client.signedout
      || (!cookie && !getConfig('userId'))
    ) {
      return;
    }

    const bjId = client.bjId;
    const delay = 120000 + Math.floor(Math.random() * 60001);

    login = setTimeout(() => {
      login = null;

      void client.safe(async () => {
        if (stopTask || client.closed || !client.isOpen() || client.bjId !== bjId) {
          return;
        }

        if (client.cookie || client.signedout) {
          return;
        }

        const signal = client.cancellation ?? client.signal;

        if (cookie) {
          client.cookie = cookie;
        }
        else {
          try {
            const result = await client.login(
              getConfig('userId'),
              getConfig('password'),
              getConfig('secondPw')
            );

            if (result !== 1) {
              throw new Error('로그인 실패');
            }
          } catch (error) {
            if (signal?.aborted) {
              return;
            }

            throw error;
          }
        }

        if (stopTask || signal?.aborted || !client.isOpen() || client.bjId !== bjId) {
          return;
        }

        client.disconnect(false);
        await client.connect();
      });
    }, delay);

    login.unref();
  });

  if (bjId && (cookie || !recovery && getConfig('userId'))) {
    const channel = await client.safe(() => client.sendLiveInfo());

    if (stopTask || client.closed) {
      return;
    }

    const result = Number(channel?.RESULT);

    if ([0, 1, -6, -8].includes(result)) {
      await authenticate();
    }
  }

  if (stopTask || client.closed) {
    return;
  }

  if (client.bjId) {
    await client.connect();
  }
})().catch(error => {
  log.error(error);
  prompt();
});

function shutdown() {
  if (stopTask) {
    return stopTask;
  }

  stopRecovery();

  clearTimeout(login);
  login = null;

  pause();
  close();

  stopTask = Promise.resolve().then(async () => {
    let code = 0;

    try {
      await editor?.close({ forget: Boolean(session) });
      await macro?.close();
      await client?.destroy();
    } catch {
      log.error('[종료]', '연결 종료 실패');
      code = 1;
    }

    process.exit(code);
  });

  return stopTask;
}

function prompt() {
  if (!rl.closed) {
    rl.prompt();
  }
}

function pause() {
  if (!rl.closed) {
    rl.pause();
  }
}

function close() {
  if (!rl.closed) {
    rl.close();
  }
}

function loadConfig() {
  load('./config.json');
  parseEnv(undefined, false);
}

function getConfig(name) {
  if (recovery?.settings && Object.hasOwn(recovery.settings, name)) {
    return recovery.settings[name];
  }
  if (session && Object.hasOwn(session, name)) {
    return session[name];
  }

  const result = process.env[get()?.[name]] ?? get()?.[name];

  if (typeof result === 'string') {
    if (result.toLowerCase() === name.toLowerCase()) {
      return null;
    }

    const value = result.trim();

    if (name === 'origins') {
      const origins = value.split(/[,\r\n]+/).map(origin => origin.trim()).filter(Boolean);

      return origins;
    }

    if (['auto', 'editor', 'isLink', 'isList'].includes(name)) {
      if (value.toLowerCase() === 'true') {
        return true;
      }

      if (value.toLowerCase() === 'false') {
        return false;
      }

      return null;
    }

    if (['pver', 'subtitle', 'mode', 'port'].includes(name)) {
      const output = value && Number.isFinite(Number(value)) ? Number(value) : null;

      return output;
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
    const output = isTopFan || isManager || isStreamer || isAdmin;

    return output;
  }

  if (mode === 2) {
    const value = isManager || isStreamer || isAdmin;

    return value;
  }

  if (mode === 3) {
    const result = isStreamer || isAdmin;

    return result;
  }

  return false;
}

function testDonation(name, count) {
  const events = {
    balloon: ['별풍선', 'balloon'],
    adcon: ['애드벌룬', 'adcon'],
    videoBalloon: ['영상풍선', 'videoBalloon'],
    vodBalloon: ['VOD별풍선', 'vodBalloon'],
    vodAdcon: ['VOD애드벌룬', 'vodAdcon'],
    stationAdcon: ['방송국애드벌룬', 'stationAdcon'],
    sticker: ['스티커', 'sticker'],
    quickview: ['퀵뷰', 'quickview'],
    subscription: ['구독권', 'subscription'],
    follow: ['구독', 'follow'],
    subCeremony: ['구독갱신', 'subCeremony'],
    ogqGift: ['OGQ선물', 'ogqGift'],
    challengeGift: ['도전후원', 'challenge', { type: 'CHALLENGE_GIFT' }],
    challengeSettle: ['도전정산', 'challenge', { type: 'CHALLENGE_SETTLE' }],
    battleGift: ['대결후원', 'battle', { type: 'GIFT' }],
    battleSettle: ['대결정산', 'battle', { type: 'SETTLE' }],
    missionSettle: ['미션정산', 'missionSettle'],
    fanClub: ['팬클럽', 'balloon', { fanOrder: count }],
    topFan: ['열혈팬', 'balloon', { topFan: 1 }]
  };
  const entry = Object.entries(events).find(([key, value]) => {
    const result =
      key.toLowerCase() === name?.toLowerCase()
      || value[0].toLowerCase() === name?.toLowerCase();

    return result;
  });

  if (!entry) {
    log.warn(
      '[명령어]',
      '사용법: /테스트 종류 [개수]',
      '\n'
        + Object.values(events)
          .map(value => value[0])
          .join(' / ')
    );

    return;
  }

  const [, [label, event, options]] = entry;
  let item;

  if (event === 'quickview') {
    item = { name: '퀵뷰', days: count, plus: false };
  }
  else {
    item = { tierName: '베이직', month: count };
  }

  const data = {
    test: true,
    userId: 'test',
    userNick: '테스트유저',
    fromId: 'test',
    fromNick: '테스트유저',
    toId: 'test-fan',
    toNick: '테스트팬',
    user_id: 'test',
    user_nick: '테스트유저',
    receivedId: 'test-fan',
    receivedName: '테스트팬',
    count,
    month: count,
    gift_count: count,
    settle_count: count,
    tier: 1,
    tierName: '베이직',
    title: '테스트 후원',
    fanOrder: 0,
    topFan: 0,
    supporterOrder: 0,
    item,
    list: [['test', '테스트유저', count, 0, 0]],
    raw: [],
    ...options
  };

  if (['balloon', 'vodBalloon'].includes(event)) {
    data.imageUrl = client.makeBalloonUrl(data);
  }
  else if (event === 'sticker') {
    data.imageUrl = client.makeStickerUrl();
  }
  else if (event === 'follow') {
    data.imageUrl = client.makeGudokUrl(count);
  }
  else if (event === 'videoBalloon') {
    data.imageUrl = new URL('/new_player/items/m_video_balloon.png', DOMAIN.res).href;
  }
  else if (event === 'ogqGift') {
    const pack = client.findOgq();

    if (pack) {
      data.title = pack.item.ogq_title;
      data.imageUrl = client.makeOgqUrl();
    }
  }

  log.info('[테스트]', `${label} ${count}`);
  client.emit(event, data);
}

async function edit(browser = true) {
  const port = getConfig('port') ?? 0;

  editor = await openEditor(macro, {
    browser: recovery && !recovery.stored ? false : session?.browser ?? browser,
    token: recovery?.editor?.token || session?.token,
    accessToken: recovery?.editor?.accessToken,
    recovery: recovery?.editor,
    accounts: recovery?.accounts,
    root: !session,
    sessionReady: session?.sessionReady,
    fixed: recovery?.editor?.fixed ?? (!session && Boolean(getConfig('bjId'))),
    basicAccount: getConfig('basicAccount') || (!session ? getConfig('userId') : ''),
    count: getConfig('count') ?? 10,
    range: session?.range,
    password: getConfig('screenPw') ?? '',
    videoEnabled: getConfig('videoEnabled') !== false,
    accessPassword: getConfig('accessPw') === 'ACCESSPW' ? '' : getConfig('accessPw') ?? '',
    stop: session ? shutdown : undefined,
    host: getConfig('host') ?? '127.0.0.1',
    port,
    origins: getConfig('origins') ?? [],
    account: () => ({
      cookie: getConfig('cookie'),
      userId: getConfig('userId'),
      password: getConfig('password'),
      secondPw: getConfig('secondPw')
    })
  });

  if (!browser) {
    await editor.open();
  }
}

async function sendCommand(label, request, message) {
  const result = await request;

  if (result !== true) {
    let reason;

    if (client.idle) {
      reason = '접속 유지 모드에서는 사용할 수 없습니다.';
    }
    else {
      if (!client.isOpen()) {
        reason = '방송에 연결되어 있지 않습니다.';
      }
      else {
        reason = '요청 전송 실패';
      }
    }

    log.warn(label, reason);

    return false;
  }

  log.info(label, message);

  return true;
}

async function command(cmd) {
  const input = cmd.trim();
  const [name, ...args] = input.split(/\s+/);
  const text = input.slice(name.length).trim();

  try {
    if (client.notify?.command(input)) {
      prompt();
      return;
    }

    if (name.startsWith('!')) {
      const result = await macro.handle(
        {
          message: input,
          userId: client.userId,
          userNick: client.info?.LOGIN_NICK || client.userId,
          source: 'console'
        },
        'console'
      );

      if (!result) {
        log.warn('[매크로]', '미실행: 설정, 권한, 대기 시간을 확인하세요.');
      }

      prompt();

      return;
    }

    switch (name) {
      case '/내정보':
      case '/myinfo': {
        const i = await http.getPrivateInfo({
          ...client.network.httpOptions,
          cookie: client.cookie
        });

        if (!i) {
          log.warn('[내정보]', '계정 정보를 불러오지 못했습니다.');
          break;
        }

        const info = {
          로그인: Number(i.IS_LOGIN) === 1 ? '로그인' : '비로그인',
          아이디: i.LOGIN_ID || '',
          닉네임: i.LOGIN_NICK || '',
          이메일: i.LOGIN_EMAIL || '',
          '방송국 번호': i.STATION_NO || '',
          '새 쪽지': Number(i.NOTE_NEW) > 0 ? '있음' : '없음',
          국가: i.COUNTRY_CODE || i.NATION_CODE || ''
        };

        log.info('[내정보]');
        log.table(
          Object.fromEntries(
            Object.entries(info).map(([name, value], index) => [
              index + 1,
              { 항목: name, 내용: value }
            ])
          )
        );
        break;
      }

      case '/조회':
      case '/find': {
        const targetId = args[0];

        if (!targetId) {
          log.warn('[명령어]', '사용법: /조회 아이디');
          break;
        }

        const info = await http.getStation(targetId, client.network.httpOptions);

        if (!info) {
          log.warn('[조회]', `${targetId}: 사용자를 찾을 수 없습니다.`);

          break;
        }

        const result = await http.getSection(targetId, 'broad', {
          ...client.network.httpOptions,
          cookie: client.cookie
        });

        if (result) {
          log.info(
            '[조회]',
            `${info.station?.user_nick || targetId}(${targetId}): 방송 중`
          );
        }
        else {
          log.info(
            '[조회]',
            `${info.station?.user_nick || targetId}(${targetId}): 오프라인`
          );
        }

        break;
      }

      case '/연결':
      case '/connect': {
        const targetId = args[0];
        const password = args[1] || '';

        if (!targetId) {
          log.warn('[명령어]', '사용법: /연결 아이디 [방송 비밀번호]');
          break;
        }

        const info = await http.getStation(targetId, client.network.httpOptions);

        if (!info) {
          log.warn('[연결]', `${targetId}: 사용자를 찾을 수 없습니다.`);
          break;
        }

        await client.disconnect(false);
        await client.connect(targetId, password);
        break;
      }

      case '/비밀번호':
      case '/password': {
        const password = args.join(' ');

        if (!password) {
          log.warn('[명령어]', '사용법: /비밀번호 [방송 비밀번호]');
          break;
        }

        client.broadPw = password;

        log.load('[비밀번호]', '방송 비밀번호 설정 완료');

        await client.disconnect(false);
        await client.connect();
        break;
      }

      case '/연결해제':
      case '/disconnect': {
        await client.disconnect();
        break;
      }

      case '/자동':
      case '/auto': {
        const arg = args.join(' ');

        if (arg !== 'true' && arg !== 'false') {
          log.warn('[명령어]', '사용법: /자동 값', '\ntrue: 켜기\nfalse: 끄기');
          break;
        }

        const value = arg === 'true';

        if (client.auto === value) {
          log.warn('[자동]', `방송 대기: ${value ? '켜짐' : '꺼짐'} (현재 설정)`);
          break;
        }

        client.auto = value;

        if (value) {
          client.startLive();
        }
        else {
          client.stopLive();
        }

        log.load('[자동]', `방송 대기: ${value ? '켜짐' : '꺼짐'}`);
        break;
      }

      case '/목록': {
        const result = await control.requestMulti('status');

        log.table(Object.fromEntries(result.map(({ id, ...data }) => [id, data])));

        break;
      }

      case '/로그인':
      case '/login': {
        const id = args[0];
        const password = args[1];
        const secondPw = args[2];

        if (client.cookie) {
          log.warn('[로그인]', '이미 로그인되어 있습니다.');
          break;
        }

        if (!id || !password) {
          log.warn('[명령어]', '사용법: /로그인 아이디 비밀번호 [2차 비밀번호]');
          break;
        }

        clearTimeout(login);
        login = null;

        const result = await client.login(id, password, secondPw);

        if (result === -1) {
          log.error('[로그인]', '아이디/비밀번호 오류');
          break;
        }

        if (result === -2) {
          log.error('[로그인]', '2차 비밀번호 오류');
          break;
        }

        if (result !== 1) {
          log.error('[로그인]', '로그인 실패');
          break;
        }

        const info = await http.getStation(id);

        log.info('[로그인]', `${info?.station?.user_nick || id}(${id}): 로그인 완료`);

        const re = client.closeWs();

        if (re) {
          await client.connectWs();
        }

        break;
      }

      case '/로그아웃':
      case '/logout': {
        clearTimeout(login);
        login = null;

        const result = await client.logout();

        if (!result) {
          log.warn('[로그아웃]', '로그인되어 있지 않습니다.');
          break;
        }

        log.info('[로그아웃]', '로그아웃 완료');
        break;
      }

      case '/닉네임':
      case '/nickname': {
        const nickname = text.trim();

        await sendCommand(
          '[닉네임]',
          client.sendNickName(nickname),
          nickname ? `닉네임 변경 요청: ${nickname}` : '닉네임 변경 요청 완료'
        );
        break;
      }

      case '/채팅':
      case '/chat':
        if (!text) {
          log.warn('[명령어]', '사용법: /채팅 내용');
          break;
        }

        await sendCommand('[채팅]', client.sendChat(text), '채팅 전송 요청 완료');
        break;

      case '/매니저':
      case '/manager':
        if (!text) {
          log.warn('[명령어]', '사용법: /매니저 내용');
          break;
        }

        await sendCommand(
          '[매니저]',
          client.sendManagerChat(text),
          '매니저 채팅 전송 요청 완료'
        );
        break;

      case '/귓속말':
      case '/to': {
        const targetId = args[0];
        const message = args.slice(1).join(' ');

        if (!targetId || !message) {
          log.warn('[명령어]', '사용법: /귓속말 아이디 내용');
          break;
        }

        await sendCommand(
          '[귓속말]',
          client.sendDirectChat(message, targetId),
          `귓속말 전송 요청: ${targetId}`
        );
        break;
      }

      case '/답장':
      case '/re': {
        const message = args.join(' ');

        if (!client.direct) {
          log.warn('[답장]', '받은 귓속말이 없습니다.');
          break;
        }

        if (!message) {
          log.warn('[명령어]', '사용법: /답장 내용');
          break;
        }

        await sendCommand(
          '[답장]',
          client.sendDirectChat(message, client.direct),
          `귓속말 답장 요청: ${client.direct}`
        );
        break;
      }

      case '/이모티콘':
      case '/ogq': {
        const ogqId = args[0];
        const subId = args[1] === undefined ? 1 : Number(args[1]);
        const message = args.slice(2).join(' ');

        const list = client.ogq?.data?.map(
          (item, index) => `${index}. ${item.ogq_title}`
        );

        if (!list?.length) {
          log.warn('[OGQ]', 'OGQ 목록이 없습니다.');
          break;
        }

        if (!ogqId) {
          log.warn(
            '[명령어]',
            '사용법: /이모티콘 OGQ [번호] [내용]',
            '\n' + list.join('\n')
          );
          break;
        }

        const ogq = client.findOgq(ogqId);

        if (!ogq) {
          log.warn('[OGQ]', 'OGQ를 찾을 수 없습니다.');
          break;
        }

        if (!Number.isSafeInteger(subId) || subId < 1 || subId > ogq.max) {
          log.warn('[OGQ]', `이모티콘 번호: 1 ~ ${ogq.max}`);
          break;
        }

        const result = await client.sendOgq(message, ogq.id, subId);

        if (result?.code !== 1) {
          log.warn('[OGQ]', 'OGQ 전송 실패', result?.message || '');
          break;
        }

        log.load('[OGQ]', `${ogqId}: 이모티콘 ${subId}번 전송 완료`);
        break;
      }

      case '/위임':
      case '/op': {
        const targetId = args[0];

        if (!targetId) {
          log.warn('[명령어]', '사용법: /위임 아이디');
          break;
        }

        await sendCommand(
          '[위임]',
          client.sendSubBj(targetId, 1),
          `매니저 지정 요청: ${targetId}`
        );
        break;
      }

      case '/해임':
      case '/-op': {
        const targetId = args[0];

        if (!targetId) {
          log.warn('[명령어]', '사용법: /해임 아이디');
          break;
        }

        await sendCommand(
          '[해임]',
          client.sendSubBj(targetId, 0),
          `매니저 해제 요청: ${targetId}`
        );
        break;
      }

      case '/채금':
      case '/m': {
        const targetId = args[0];
        const message = args.slice(1).join(' ') || '채팅금지';

        if (!targetId) {
          log.warn('[명령어]', '사용법: /채금 아이디 [사유]');
          break;
        }

        await sendCommand(
          '[채금]',
          client.sendDumb(targetId, message),
          `채팅금지 요청: ${targetId}`
        );
        break;
      }

      case '/강퇴':
      case '/k': {
        const targetId = args[0];
        const message = args.slice(1).join(' ') || '강제퇴장';

        if (!targetId) {
          log.warn('[명령어]', '사용법: /강퇴 아이디 [사유]');
          break;
        }

        await sendCommand(
          '[강퇴]',
          client.sendKick(targetId, 0, message),
          `강퇴 요청: ${targetId}`
        );
        break;
      }

      case '/강퇴취소':
      case '/-k': {
        const targetId = args[0];

        if (!targetId) {
          log.warn('[명령어]', '사용법: /강퇴취소 아이디');
          break;
        }

        await sendCommand(
          '[강퇴취소]',
          client.sendKick(targetId, 1),
          `강퇴 취소 요청: ${targetId}`
        );
        break;
      }

      case '/강퇴인원':
      case '/kicklist':
        await sendCommand('[강퇴인원]', client.sendKickList(), '강퇴 목록 요청 완료');
        break;

      case '/얼음':
      case '/ice': {
        if (client.iceMode) {
          log.warn('[얼음]', '이미 채팅이 얼어 있습니다.');
          break;
        }

        const result = await client.sendIceMode('ice_on', 100001);

        if (!result) {
          log.warn('[얼음]', '채팅 얼리기 요청 실패');
          break;
        }

        log.info('[얼음]', '채팅 얼리기 처리 결과', result);
        break;
      }

      case '/땡':
      case '/-ice': {
        if (!client.iceMode) {
          log.warn('[땡]', '채팅이 얼어 있지 않습니다.');
          break;
        }

        const result = await client.sendIceMode('ice_off', 0);

        if (!result) {
          log.warn('[땡]', '채팅 녹이기 요청 실패');
          break;
        }

        log.info('[땡]', '채팅 녹이기 처리 결과', result);
        break;
      }

      case '/저속':
      case '/slow': {
        const count = args[0] === undefined ? 0 : Number(args[0]);

        if (!Number.isSafeInteger(count) || count < 0) {
          log.warn('[명령어]', '사용법: /저속 초');
          break;
        }

        await sendCommand(
          '[저속]',
          client.sendSlowMode(count),
          `채팅 입력 간격 요청: ${count}초`
        );
        break;
      }

      case '/룰렛':
      case '/roulette': {
        const count = Number(args[0]);
        const user = getConfig('weflab');

        if (!user) {
          log.warn('[룰렛]', '.env의 WEFLAB을 설정해주세요.');
          break;
        }

        if (!Number.isInteger(count) || count < 1) {
          log.warn('[명령어]', '사용법: /룰렛 개수');
          break;
        }

        const rule = macro.rules.find(
          rule =>
            rule.action === 'roulette'
            && rule.enabled !== false
            && macro.matchesRoulette(rule, String(count))
        );
        let index;

        if (typeof rule?.index === 'object') {
          index = rule.index[count] ?? 0;
        }
        else {
          index = rule?.index ?? 0;
        }

        const result = await weflab.roulette(user, count, index);

        log.load(weflab.format(result, count, rule?.numbers, rule?.title));

        break;
      }

      case '/도전':
      case '/challenge': {
        const challenge = await client.sendChallengeList();

        if (!challenge?.ok) {
          log.warn('[도전미션]', challenge?.message || '목록 조회 실패');
          break;
        }

        if (!challenge.list.length) {
          log.warn('[도전미션]', '진행 중인 도전미션이 없습니다.');
          break;
        }

        const text = challenge.list
          .map(item => {
            const status = {
              REQUEST: '요청',
              PROGRESS: '진행 중',
              SUCCESS: '성공',
              FAIL: '실패',
              CANCEL: '취소'
            };

            const lines = [
              `[도전미션] ${item.title}`,
              `상태: ${status[item.status] || item.status}`,
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
          })
          .join('\n\n');

        log.info(`\x1b[1m${text}\x1b[0m`);
        break;
      }

      case '/대결':
      case '/battle': {
        const mission = await client.sendMissionList();

        if (!mission?.ok) {
          log.warn('[대결미션]', mission?.message || '목록 조회 실패');
          break;
        }

        log.info(
          '\x1b[1m'
            + [
              `[대결미션] ${mission.title}`,
              `상태: ${mission.status}`,
              `총 후원: ${mission.total}개`,
              `팀:\n${mission.teams}`
            ].join('\n')
            + '\x1b[0m'
        );
        break;
      }

      case '/투표':
      case '/poll': {
        const index = Number(args[0]);

        if (!client.poll) {
          log.warn('[투표]', '진행 중인 투표가 없습니다.');
          break;
        }

        if (!Number.isSafeInteger(index) || index < 1) {
          log.warn('[명령어]', '사용법: /투표 번호');
          break;
        }

        const result = await client.sendPoll(index);

        if (!result) {
          log.warn('[투표]', '투표 요청 실패');
          break;
        }

        log.info('[투표]', '투표 처리 결과', result);
        break;
      }

      case '/매크로': {
        if (args[0] === '편집') {
          await edit(false);
          break;
        }
        else if (args[0] === 'true' || args[0] === 'false') {
          macro.setEnabled(args[0] === 'true');
        }
        else if (args[0] === '새로고침') {
          macro.load();
        }
        else if (args.length) {
          log.warn(
            '[명령어]',
            '사용법: /매크로 [설정]',
            '\ntrue: 켜기\nfalse: 끄기\n새로고침: 설정 불러오기\n편집: 편집 화면 열기'
          );
          break;
        }

        log.info('[매크로]', macro.enabled ? '켜짐' : '꺼짐');
        log.table(
          Object.fromEntries(macro.list().map((rule, index) => [index + 1, rule]))
        );
        break;
      }

      case '/테스트':
      case '/test': {
        const count = args[1] === undefined ? 100 : Number(args[1]);

        if (args.length > 2 || !Number.isSafeInteger(count) || count < 1) {
          log.warn('[명령어]', '사용법: /테스트 종류 [개수]');
          break;
        }

        testDonation(args[0], count);
        break;
      }

      case '/참여인원':
      case '/userlist': {
        if (!(await client.sendUserList())) {
          log.warn('[참여인원]', '참여자 목록 조회 실패');
          break;
        }

        if (!isList) {
          const list = [...client.userList.values()]
            .map((user, index) => {
              const result = `${index + 1}. ${user.name}(${user.id}) [${user.role}]`;

              return result;
            })
            .join('\n');

          log.info('[참여인원]', list ? '\n' + list : '참여자가 없습니다.');
        }

        break;
      }

      case '/자막':
      case '/subtitle': {
        const index = Number(args[0]);

        if (![-1, 0, 1].includes(index)) {
          log.warn('[명령어]', '사용법: /자막 번호', '\n-1: 끄기\n0: 한국어\n1: 영어');
          break;
        }

        await sendCommand(
          '[자막]',
          client.sendSubtitle(index),
          `자막 변경 요청: ${{ [-1]: '끄기', 0: '한국어', 1: '영어' }[index]}`
        );
        break;
      }

      case '/번역':
      case '/t': {
        const mode = Number(args[0]);
        const message = args.slice(1).join(' ');

        if (!Number.isSafeInteger(mode) || mode < 1 || !message) {
          log.warn('[명령어]', '사용법: /번역 모드 내용');
          break;
        }

        await sendCommand(
          '[번역]',
          client.sendTranslation(message, mode),
          `번역 전송 요청: 모드 ${mode}`
        );
        break;
      }

      case '/모드':
      case '/mode': {
        const value = Number(args[0]);

        if (![0, 1, 2, 3].includes(value)) {
          log.warn(
            '[명령어]',
            '사용법: /모드 번호',
            '\n0: 전체 채팅\n1: 열혈팬 이상\n2: 매니저 이상\n3: 스트리머'
          );
          break;
        }

        mode = value;

        const name = {
          0: '전체 채팅',
          1: '열혈팬 이상',
          2: '매니저 이상',
          3: '스트리머'
        }[mode];

        log.info('[모드]', `채팅 표시: ${name}`);
        break;
      }

      case '/지우기':
      case '/clear':
        console.clear();
        break;

      case '/도움':
      case '/help':
        log.table(
          Object.fromEntries(
            [
              ['/내정보', '', '내정보 확인'],
              ['/조회', '아이디', '방송 상태 확인'],
              ['/연결', '아이디\n방송 비밀번호', '방송 채팅 연결'],
              ['/비밀번호', '방송 비밀번호', '방송 비밀번호 입력'],
              ['/연결해제', '', '현재 연결 해제'],
              ['/자동', 'true\nfalse', '방송 대기 설정'],
              ['/목록', '', '연결 상태 확인'],
              ['/알림', '[항목] 켜기|끄기\n목록|다시읽기', 'ntfy 알림 설정'],
              ['/로그인', '아이디\n비밀번호\n2차 비밀번호', '로그인'],
              ['/로그아웃', '', '로그아웃'],
              ['/닉네임', '[이름]', '임시 닉네임 변경'],
              ['/채팅', '내용', '일반 채팅 전송'],
              ['/매니저', '내용', '매니저 채팅 전송'],
              ['/귓속말', '아이디\n내용', '귓속말 전송'],
              ['/답장', '내용', '귓속말 답장'],
              ['/이모티콘', 'OGQ\n번호\n내용', 'OGQ 전송'],
              ['/위임', '아이디', '매니저 지정'],
              ['/해임', '아이디', '매니저 해제'],
              ['/채금', '아이디\n사유', '채팅금지'],
              ['/강퇴', '아이디\n사유', '강퇴'],
              ['/강퇴취소', '아이디', '강퇴 취소'],
              ['/강퇴인원', '', '강퇴 목록 요청'],
              ['/얼음', '', '채팅 얼리기'],
              ['/땡', '', '채팅 녹이기'],
              ['/저속', '초', '채팅 입력 간격 설정'],
              ['/룰렛', '개수', 'Weflab 룰렛 확률 조회'],
              ['/도전', '', '도전미션 조회'],
              ['/대결', '', '대결미션 조회'],
              ['/투표', '번호', '투표 참여'],
              ['/매크로', 'true\nfalse\n새로고침\n편집', '매크로 설정'],
              ['/테스트', '종류\n개수', '후원 알림 테스트'],
              ['/참여인원', '', '참여자 목록'],
              ['/자막', '번호', '자막 언어 변경'],
              ['/번역', '모드\n내용', '채팅 번역'],
              ['/모드', '번호', '채팅 표시'],
              ['/지우기', '', '실행창 지우기'],
              ['/도움', '', '명령어 목록 출력'],
              ['/종료', '', '연결 종료']
            ].map(([command, parameters, description], index) => [
              index + 1,
              { 명령어: command, 파라미터: parameters, 설명: description }
            ])
          )
        );
        break;

      case '/종료':
      case '/exit':
        await shutdown();

        return;

      default:
        log.warn(
          '[명령어]',
          '알 수 없는 명령어입니다.',
          '/도움으로 사용법을 확인하세요.'
        );
        break;
    }
  } catch (error) {
    log.error('[명령어]', `${name}: ${error.message || '명령 실행 실패'}`);
  }

  prompt();
}

rl.on('line', async input => {
  const cmd = input.trim();
  const name = cmd.split(/\s+/)[0];
  const hidden = [
    '/로그인',
    '/login',
    '/비밀번호',
    '/password',
    '/연결',
    '/connect'
  ].includes(name);

  log.input(hidden ? `${name} [숨김]` : input);

  if (!cmd) {
    prompt();

    return;
  }

  await command(cmd);
});

rl.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
