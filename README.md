<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/node.js-24.16.0-brightgreen">
  <img src="https://img.shields.io/badge/version-v1.0.7-blue">
  <img src="https://img.shields.io/badge/status-experimental-orange">
</p>

<h1 align="center">
🌳 SOOP Chat
</h1>

<p align="center">
    <img src="https://github.com/user-attachments/assets/7f1b3d67-0bd4-445d-a5d9-a843f39128b2" width="99%">
</p>

<p align="center">
    <strong>Node.js SOOP Chat</strong>
</p>

<p align="center">
  <a href="https://github.com/obabo0801/SOOP-Chat/archive/refs/heads/main.zip">
    <img src="https://img.shields.io/badge/Download-ZIP-blue?style=for-the-badge" alt="Download ZIP">
  </a>
</p>

```bash
git@github.com:obabo0801/SOOP-Chat.git
```

---

<details>
<summary>❗ 업데이트 내역</summary>

## ❗ 버전 1.0.7
- 매크로 편집 화면 추가
  - 이모티콘, OGQ 선택 지원
  - `/매크로 편집` 명령어 추가
- 방송 대기 접속 처리 변경
  - 비로그인 입장 후 2~3분 뒤 로그인
  - 이미 방송 중이면 로그인 후 접속
- 게시글, 댓글, 답글 좋아요 변경 알림 추가
- 게시글, 댓글 삭제 확인 개선
- 연속 구독 매크로 누락 수정
- 미션 제목 변수 `{제목}` 추가
- 후원 알림 테스트 이미지 표시
- 기본 `.env` 자동 생성
- 코드 스타일 정리

## ❗ 버전 1.0.6
- 채팅 매크로 기능 추가
  - 자동답변, 자동관리, 후원 알림 지원
  - 매니저 채팅에서 명령어 수정 지원
- 채금, 강퇴 채팅 기록 추가
- 후원 알림 테스트 추가
- 임시 닉네임 변경 명령어 추가
- 룰렛 개수 범위 인식 수정
- OGQ 전송 오류 수정
- 명령어 안내, 로그 출력 정리
- 연결 취소, 시간 초과 처리 개선
- 브라우저 로그인, 프록시 기능 제거
- 멀티 설정 변수 `TENANTS`로 변경

## ❗ 버전 1.0.5
- 멀티 기능 추가
- 번호별 로그인 설정 지원
- 접속 유지 모드 추가
- 개별 프록시 설정 지원

## ❗ 버전 1.0.4
- Weflab 룰렛 확률 조회 기능 추가
  - /룰렛 개수 명령어 지원

## ❗ 버전 1.0.3
- 게시글, 클립, 캐치 알림 개선
  - 삭제 및 공개 상태 변경 알림 추가
  - 게시글 삭제 시 잘못된 알림 수정
  - 방송 대기 중 알림 유지
- 댓글과 답글 작성, 수정, 삭제 알림 추가
- PC, 모바일 시청자 수 변경 이벤트 추가
- 방송 스트림 조회 및 숲 패키지 연결 추가
  - 화질 변경 및 오류 시 재연결 처리
- OGQ 선물 수신자 표시 오류 수정
- 방송 정보 갱신, 로그인 및 연결 오류 처리 개선
- 환경변수 처리 및 배포 파일 구성 개선

## ❗ 버전 1.0.2
- 브라우저 로그인 기능 추가
  - 로그인 상태 저장 및 재사용
- SOOP 서비스 점검 메시지 표시
- 로그인 패킷 오류 수정
- 자동 연결 및 세션 오류 처리 개선
- 로그와 환경변수 처리 개선

## ❗ 버전 1.0.1
- 방송 자동 대기 기능 추가
- 방송 상태 안내 메시지 추가
  - 오프라인, 비밀번호, 연령 제한, 플러스 구독
- Bridge 인증 흐름 개선
  - 비밀번호 방송 연결 실패 처리
  - 실패 시 Timeout 문제 수정
  - Bridge 인증 성공 후 Chat 연결
- 스트리머 새 게시글 알림 추가
- 방송 입장 로그와 채팅 참여 로그 분리
- 도전미션 목록 조회 추가
- 대결미션 결과 알림 개선
  - 승리 팀 / 무승부 처리 분리

</details>

---

## 📌 소개
SOOP Live 채팅 구조를 분석하면서 만든  
Node.js 기반 채팅 클라이언트입니다.

공식 라이브러리는 아니며, 개발용으로 사용합니다.

사용 시 [SOOP 서비스 이용 정책](https://developers.sooplive.com/?szWork=support&sub=terms)을 준수해주세요.

---

## ✨ 기능
- Chat WebSocket 방송 채팅 연결
- Bridge WebSocket 방송 정보 수신
- 방송 대기 및 자동 접속
- 방송 제목, 카테고리, 태그 변경 알림
- 일반 채팅, 매니저 채팅, 귓속말 수신
- 참여자 목록 및 입퇴장 처리
- 별풍선, 스티커, 애드벌룬 선물 알림
- 구독권, 퀵뷰, OGQ 선물 알림
- 투표, 도전, 대결미션, 자막 이벤트 처리
- 게시글, 클립, 캐치 변경 알림
- 댓글과 답글 변경 알림
- 게시글, 댓글, 답글 좋아요 변경 알림
- 시청자 수 변경 알림
- 방송 스트림 조회 및 숲 패키지 연결
- Weflab 룰렛 확률 조회
- 로그인, 2차 로그인, 로그아웃 지원
- 콘솔 명령어 테스트 지원

---

## 🛠 개발 환경
- Node.js (ESM)
- dotenv 17.4.2
- ws 8.21.0

---

## 📦 패키지

```js
import { SoopClient } from 'soop-chat';

const client = new SoopClient({
    bjId: '스트리머 아이디'
});

client.on('chat', data => {
    console.log(`${data.userNick}: ${data.message}`);
});

await client.connect();
```

---

## 🚀 설치
```bash
npm install
```

---

## 🪟 실행
```bash
npm start
```

| 항목 | 처리 |
| --- | --- |
| 방송 중 실행 | 로그인 후 접속 |
| 대기 후 접속 | 비로그인 입장<br>2~3분 뒤 로그인 |
| 방송 대기 | 5초 간격 확인 |

배치 파일 실행

```bash
start.bat
```

```bash
npm run start:multi -- 3
```

`tenants.json`에서 번호별  
접속 정보를 설정합니다.  
첫 실행 시 연결 개수에 맞춰  
`tenants.json`을 생성합니다.  
미설정 번호는 `.env`의 `BJID`로  
비로그인 접속합니다.  

```bash
npm run stop:multi
```

실행 창에서 `Ctrl+C`로 종료합니다.

---

## 🔐 .env

`.env`는 공개하지 마세요.

| 파일 | 처리 |
| --- | --- |
| 기본 `.env` 없음 | 최초 실행 시 생성 |
| 기존 `.env` | 유지 |
| 지정한 설정 파일 없음 | 오류 |

`config.json`에서 값 대신 환경변수 이름을 적어두면  
`.env` 값을 불러와 사용할 수 있습니다.

```env
BJID="WHO_BJID"
BROADPW="WHO_BROADPW"

USERID="YOUR_ID"
PASSWORD="YOUR_PASSWORD"
SECONDPW="YOUR_SECONDPW"

IDLE="true"
# TENANTS="tenants.json"
```

- `IDLE`: 접속 유지 모드
- `TENANTS`: 연결 설정 파일

## ⚙️ 설정

| 이름 | 설명 |
| --- | --- |
| `bjId` | 방송 스트리머 아이디 |
| `broadPw` | 방송 비밀번호 |
| `auto` | 방송 대기 연결 |
| `delay` | 자동 대기 연결 시간 |
| `cookie` | 로그인 쿠키 .A32··· |
| `weflab` | Weflab 사용자 ID |
| `isLink` | 이모티콘 링크 표시 |
| `isList` | 참여자 목록 표시 |
| `pver` | 참여자 목록 및 입퇴장 수신 |
| `subtitle` | 자막 언어 설정 |
| `mode` | 채팅 로그 범위 |

## 🤖 매크로

| 항목 | 내용 |
| --- | --- |
| 편집 화면 | `config.json`의 `editor`로 자동 열기 설정 |
| 편집 기능 | 추가<br>수정<br>삭제<br>OGQ 선택 |
| 설정 파일 | `macros.json` |
| 설정 반영 | 파일 저장 시 자동 반영 |
| 답변 권한 | 로그인한 매니저 이상 |
| 파일 없음 | 기본 설정 생성 |
| 개인 설정 | 배포 제외 |

`rules`에 규칙을 추가합니다.

```json
{
    "enabled": true,
    "rules": [
        {
            "name": "인사",
            "kind": "command",
            "pattern": [
                "!인사",
                "!안녕"
            ],
            "reply": [
                "{이름}님 안녕하세요!",
                "반갑습니다!"
            ],
            "ogq": "이모티콘 이름 1",
            "cooldown": 5
        }
    ],
    "history": {
        "remarks": []
    }
}
```

| 설정 | 값 | 설명 |
| --- | --- | --- |
| `enabled` | `true`<br>`false` | 켜기<br>끄기 |
| `kind` | `command` | 명령어 |
|  | `text` | 단어 포함 |
|  | `regex` | 단어 경계 |
|  | `event` | 알림 |
|  | `interval` | 타이머 |
| `pattern` | 문자열<br>배열 | 인식할 내용 |
| `action` | `reply` | 답변 |
|  | `roulette` | 룰렛 |
|  | `mute` | 채금 |
|  | `kick` | 강퇴 |
|  | `warn` | 경고 |
| `access` | `all` | 전체 |
|  | `manager` | 매니저 이상 |
|  | `streamer` | 스트리머 |
| `input` | `both` | 전체 |
|  | `chat` | 방송 채팅 |
|  | `console` | 실행창 |
| `output` | `chat` | 일반 채팅 |
|  | `manager` | 매니저 채팅 |
|  | `direct` | 귓속말 |
| `reply` | 문자열<br>배열 | 답변<br>한 줄씩 입력 |
| `ogq` | 이름<br>번호 | OGQ 선택 |
| `commands` | `true` | 없는 명령어 숨김 |
| `edit` | `true` | 매니저 채팅 수정 |
| `count` | 1 ~ 3 | 채금 횟수 |
|  | 빈 값<br>미설정 | 경고만 전송 |
| `reason` | 내용 | 자동관리 사유 |
| `cooldown` | 초 | 재실행 대기 시간 |
| `interval` | 초 | 반복 시간 |

| 항목 | 내용 |
| --- | --- |
| 명령어 | 대소문자 구분 없음 |
| 정규식 | 단어 경계 자동 처리 |
| OGQ 이름 | `/ogq` 목록에서 확인 |
| 빈 답변 | 응답 끄기<br>OGQ 전용 제외 |
| 답변 수정 | 매니저 채팅<br>`!명령어 내용` |
| 답변 삭제 | 매니저 채팅<br>명령어만 입력 |
| 줄바꿈 | `\n` 입력 |
| 후원 테스트 | 실행창에만 표시 |

매니저 채팅

| 명령어 | 파라미터 | 전체 채팅 |
| --- | --- | --- |
| `!공지` | 내용 | `!공지/내용` |
| `!공지` |  | `!공지/삭제` |
| `!시간` | 내용 | `!시간/내용` |
| `!시간` |  | `!시간/업타임` |

룰렛

| 설정 | 예시 | 설명 |
| --- | --- | --- |
| `title` | `[{개수} 룰렛]` | 제목 |
| `default` | `50` | 기본 개수 |
| `ranges` | `[[50, 51]]` | 인식 범위 |
| `index` | `0` | 조회 순서 |
|  | `{"34": 1}` | 개수별 순서 |
| `numbers` | `[50, 51]` | 제목 아래 번호 |
|  | `[[50, 51], [500, 501]]` | 번호별 목록 |

답변

| 값 | 내용 |
| --- | --- |
| `{이름}`<br>`{아이디}` | 입력한 사용자 |
| `{내용}`<br>`{인수}` | 채팅 내용<br>명령어 뒤 입력값 |
| `{개수}`<br>`{개월}` | 후원 개수<br>구독 개월 |
| `{받는이}` | 선물 받는 사용자 |
| `{제목}` | 미션 제목 |
| `{후원종류}`<br>`{팬순번}` | 후원 종류<br>팬클럽 가입 순번 |

처리

| 항목 | 내용 |
| --- | --- |
| 채금 | `logs/날짜/mute.log` |
| 강퇴 | `logs/날짜/kick.log` |
| 채팅 내역 | 최근 30분<br>최대 10개 |
| 저장 형식 | JSON |
| 날짜<br>방송<br>처리 | 처리 정보 |
| 처리자<br>대상자 | 닉네임<br>아이디 |
| 횟수<br>시간 | 채금 정보 |
| 채팅 | 최근 채팅 |
| 비고 | `history.remarks` 설정 |

`history.remarks` 예시

```json
[
    {
        "name": "욕설",
        "words": ["금지어"]
    }
]
```

패키지 사용

```js
import { SoopClient, SoopMacro } from 'soop-chat';

const client = new SoopClient({
    bjId: '스트리머 아이디'
});
const macro = new SoopMacro(client, {
    file: 'macros.json',
    weflab: 'Weflab 아이디'
});

client.on('error', error => {
    console.error(error.message);
});

client.on('history', record => {
    console.log(macro.history.row(record));
});

await client.login('아이디', '비밀번호', '2차 비밀번호');
await client.connect();

// 종료
await macro.close();
await client.destroy();
```

## 🪟 명령어

| 번호 | 명령어 | 파라미터 | 설명 |
| --- | --- | --- | --- |
| 1 | `/내정보` |  | 내정보 확인 |
| 2 | `/조회` | 아이디 | 방송 상태 확인 |
| 3 | `/연결` | 아이디<br>방송 비밀번호 | 방송 채팅 연결 |
| 4 | `/비밀번호` | 방송 비밀번호 | 방송 비밀번호 입력 |
| 5 | `/연결해제` |  | 현재 연결 해제 |
| 6 | `/자동` | true<br>false | 방송 대기 설정 |
| 7 | `/목록` |  | 연결 상태 확인 |
| 8 | `/로그인` | 아이디<br>비밀번호<br>2차 비밀번호 | 로그인 |
| 9 | `/로그아웃` |  | 로그아웃 |
| 10 | `/닉네임` | [이름] | 임시 닉네임 변경 |
| 11 | `/채팅` | 내용 | 일반 채팅 전송 |
| 12 | `/매니저` | 내용 | 매니저 채팅 전송 |
| 13 | `/귓속말` | 아이디<br>내용 | 귓속말 전송 |
| 14 | `/답장` | 내용 | 귓속말 답장 |
| 15 | `/이모티콘` | OGQ<br>번호<br>내용 | OGQ 전송 |
| 16 | `/위임` | 아이디 | 매니저 지정 |
| 17 | `/해임` | 아이디 | 매니저 해제 |
| 18 | `/채금` | 아이디<br>사유 | 채팅금지 |
| 19 | `/강퇴` | 아이디<br>사유 | 강퇴 |
| 20 | `/강퇴취소` | 아이디 | 강퇴 취소 |
| 21 | `/강퇴인원` |  | 강퇴 목록 요청 |
| 22 | `/얼음` |  | 채팅 얼리기 |
| 23 | `/땡` |  | 채팅 녹이기 |
| 24 | `/저속` | 초 | 채팅 입력 간격 설정 |
| 25 | `/룰렛` | 개수 | Weflab 룰렛 확률 조회 |
| 26 | `/도전` |  | 도전미션 조회 |
| 27 | `/대결` |  | 대결미션 조회 |
| 28 | `/투표` | 번호 | 투표 참여 |
| 29 | `/매크로` | true<br>false<br>새로고침<br>편집 | 매크로 설정 |
| 30 | `/테스트` | 종류<br>개수 | 후원 알림 테스트 |
| 31 | `/참여인원` |  | 참여자 목록 |
| 32 | `/자막` | 번호 | 자막 언어 변경 |
| 33 | `/번역` | 모드<br>내용 | 채팅 번역 |
| 34 | `/모드` | 번호 | 채팅 표시 |
| 35 | `/지우기` |  | 실행창 지우기 |
| 36 | `/도움` |  | 명령어 목록 출력 |
| 37 | `/종료` |  | 연결 종료 |

---

## 📬 문의
기타 문의는 아래 연락처로 부탁드립니다.

- **이메일** [obabo0801@gmail.com](mailto:obabo0801@gmail.com)
- **디스코드** `unjongjjing`
