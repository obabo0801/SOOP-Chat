<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/node.js-24.16.0-brightgreen">
  <img src="https://img.shields.io/badge/version-v1.0.0-blue">
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

## 📌 소개
SOOP Live 채팅 구조를 직접 분석하면서 만든  
Node.js 기반 채팅 클라이언트입니다.

공식 라이브러리는 아니며, 개발용으로 사용합니다.

사용 시 [SOOP 서비스 이용 정책](https://developers.sooplive.com/?szWork=support&sub=terms)을 준수해주세요.

---

## ✨ 기능
- Chat WebSocket 방송 채팅 연결
- Bridge WebSocket 방송 정보 수신
- 방송 제목, 카테고리, 태그 변경 알림
- 일반 채팅, 매니저 채팅, 귓속말 수신
- 참여자 목록 및 입퇴장 처리
- 별풍선, 스티커, 애드벌룬 선물 알림
- 구독권, 퀵뷰, OGQ 선물 알림
- 투표, 도전·대결미션, 자막 이벤트 처리
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
    console.log(`${data.userName}: ${data.message}`);
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

또는

```bash
start.bat
```

---

## 🔐 .env

`.env`는 공개하지 마세요.

`config.json`에서 값 대신 환경변수 이름을 적어두면  
`.env` 값을 불러와 사용할 수 있습니다.

```env
BJID="WHO_BJID"
BROADPW="WHO_BROADPW"

USERID="YOUR_ID"
PASSWORD="YOUR_PASSWORD"
SECONDPW="YOUR_SECONDPW"
```

## ⚙️ 설정

| 이름 | 설명 |
| --- | --- |
| `bjId` | 방송 스트리머 아이디 |
| `broadPw` | 방송 비밀번호 |
| `cookie` | 로그인 쿠키 .A32··· |
| `isLink` | 이모티콘 링크 표시 |
| `isList` | 참여자 목록 표시 |
| `pver` | 참여자 목록 및 입퇴장 수신 |
| `subtitle` | 자막 언어 설정 |
| `mode` | 채팅 로그 범위 |

## 🪟 명령어

| 명령어 | 설명 |
| --- | --- |
| `/조회 아이디` | 방송 상태 확인 |
| `/연결 아이디` | 방송 채팅 연결 |
| `/연결해제` | 현재 연결 해제 |
| `/로그인 아이디 비밀번호 2차비밀번호` | 로그인 |
| `/로그아웃` | 로그아웃 |
| `/채팅 내용` | 일반 채팅 전송 |
| `/매니저 내용` | 매니저 채팅 전송 |
| `/귓속말 아이디 내용` | 귓속말 전송 |
| `/참여인원` | 현재 참여자 목록 요청 |
| `/강퇴인원` | 강퇴 목록 요청 |
| `/자막 번호` | 자막 언어 변경 |
| `/모드 번호` | 채팅 로그 표시 범위 |
| `/도움` | 명령어 목록 출력 |

---

## 📬 문의
기타 문의는 아래 연락처로 부탁드립니다.

- **이메일** [obabo0801@gmail.com](mailto:obabo0801@gmail.com)
- **디스코드** `unjongjjing`