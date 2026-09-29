# 아이맘 스튜디오 (ai-mom)

중학생과 부모를 위한 콘텐츠 채널 3개를 한 사람이 운영하는 관리자 앱입니다.

| 채널 | 하는 일 |
|---|---|
| 아이맘 · 도전·진학 | 전국단위 자사고·영재학교·과학고 입시, STEM 캠프·대회, 영재교육원 공고를 모으고 확인 |
| 아이맘 · 하루 과학 대화 | 과학 질문 하나로 5~10분 대화할 거리를 근거와 함께 준비 |
| 아이맘 · 하루 시사 대화 | 사실·관점·가치를 나눠 시사 주제로 대화할 거리를 준비 |

흐름은 **수집 → 원문 확보 → 자동 추출·초안 → 사람이 검토 → 카드 이미지 → 최종 승인 → 게시**입니다.
자동으로 만든 결과는 모두 "검토 대기"로 들어가고, 사람이 승인해야만 게시 단계로 넘어갑니다.

지금 구현된 것과 아직 안 된 것은 [BUILD_STATUS.md](BUILD_STATUS.md)에 정리되어 있습니다.

---

## 구성 한눈에 보기

```
[Render 무료 웹서비스]  관리자 화면(React) + API 서버(Express)
        │
        ▼
[Neon 무료 PostgreSQL]  모든 설정·자료·이력 저장 (앱을 다시 시작해도 유지)
        ▲
        │
[GitHub Actions]        워커: 한 번 실행하고 끝나는 작업
   ├ collect.yml        네이버 검색·공식 게시판 수집 → 원문 확보 → 구조화 추출
   └ process.yml        화면에서 등록한 수집 요청 처리 + 예약된 게시 전송
```

- 웹서버는 15분 동안 접속이 없으면 잠들고, 다시 열 때 1분쯤 걸립니다(Render 무료 플랜 특성).
- 수집·게시는 웹서버가 아니라 GitHub Actions 워커가 합니다. 그래서 웹서버가 잠들어도 워커는 DB에 직접 붙어 일합니다.
- 서버 안에서 계속 도는 반복 작업은 없습니다. 모든 작업은 DB에 쌓이고, 워커가 실행될 때 처리됩니다.

## 안전 스위치 (기본값)

| 변수 | 기본 | 의미 |
|---|---|---|
| `DRY_RUN` | `true` | 게시 단계에서 모든 검사를 하지만 **실제로 게시하지 않습니다**(모의 실행). |
| `AUTO_PUBLISH` | `false` | `DRY_RUN=false`여도 이 값이 `true`가 아니면 게시하지 않습니다. |
| `AUTO_COLLECT` | `false` | 예약(schedule) 실행에서 수집하지 않습니다. 수동 실행은 가능합니다. |
| `AUTO_GENERATE` | `false` | 과학·시사 초안 자동 생성은 하지 않습니다(화면의 버튼으로만 생성). |
| `DEMO_MODE` | `false` | 개발 환경에서만 샘플 모드 로그인을 허용합니다. 운영에서는 켜도 동작하지 않습니다. |

화면의 **채널 설정 → 전역 정지** 버튼을 누르면 모든 수집과 게시가 멈춥니다.

---

## 처음 설정하기 (순서대로)

### 1단계. Neon에서 데이터베이스 만들기

1. https://neon.tech 에 가입 → **New Project**
2. Region은 한국과 가까운 **AWS Asia Pacific (Singapore)**를 고르세요.
3. 만들어진 **Connection string**(`postgresql://...?sslmode=require`)을 복사해 둡니다. 이 값이 `APP_DATABASE_URL`입니다.

> **APP_DATABASE_URL과 DATABASE_URL의 관계**: 앱은 `APP_DATABASE_URL`을 먼저 읽고, 없을 때만 `DATABASE_URL`을 씁니다. Replit이나 다른 서비스가 자동으로 넣는 `DATABASE_URL`(개발용 DB일 수 있음)과 헷갈리지 않도록, 운영에서는 항상 `APP_DATABASE_URL`에 Neon 주소를 넣으세요. 웹서버(Render)와 워커(GitHub Actions)에 **같은 주소**를 넣어야 합니다.

### 2단계. 운영자 비밀번호 해시 만들기

비밀번호 원문은 어디에도 저장하지 않고, 해시(되돌릴 수 없게 바꾼 값)만 저장합니다.
Node.js 22가 설치된 컴퓨터에서:

```bash
git clone https://github.com/boramsama01-code/ai-mom_studio
cd ai-mom_studio
npm ci
npm run hash-password -- "12자 이상 비밀번호"
```

출력된 `$2a$12$...` 값이 `ADMIN_PASSWORD_HASH`입니다.

### 3단계. Render에 배포

1. https://render.com 가입 → **New → Blueprint** → 이 GitHub 저장소 선택
   (저장소에 있는 `render.yaml`을 읽어 설정을 자동으로 채웁니다. Region은 Singapore로 되어 있습니다.)
2. 값을 물어보는 항목은 3개뿐입니다(빈칸으로 둘 수 없음):
   - `APP_DATABASE_URL`: 1단계의 Neon 주소
   - `ADMIN_USERNAME`: 원하는 운영자 아이디
   - `ADMIN_PASSWORD_HASH`: 2단계 결과
   - 네이버·Claude·텔레그램 등 나머지 키는 배포 후 서비스의 **Environment** 화면에서 추가합니다(없으면 "미연결"로 표시).
   - 사이트 주소(`APP_BASE_URL`)는 Render가 자동으로 알려 주는 값을 쓰므로 넣지 않아도 됩니다. 나중에 개인 도메인을 쓰면 그때 넣으세요.
3. 배포가 끝나면 주소로 접속 → 로그인.
   서버가 시작할 때 DB 구조(마이그레이션)와 초기 채널 3개·검색어를 자동으로 만듭니다. 이미 있으면 덮어쓰지 않습니다.

확인: `https://(주소)/api/health` 에 `{"ok":true,"db":"connected","auth":"configured"}`가 보이면 정상입니다.

### 4단계. 채널·검색어 확인

- 왼쪽 **현재 채널**에서 채널을 고릅니다. "전체"는 보기 전용이고, 쓰기 작업은 채널 하나를 골라야 합니다.
- **검색 설정**: 처음에는 6개 검색어만 켜져 있습니다(하나고 입학설명회, 경기과학고 모집요강, 세종과학예술영재학교 모집요강, KAIST 청소년 캠프, 중학생 올림피아드 모집, 청소년 영재교육원 모집[블로그]). 나머지는 "일시정지" 후보입니다.
  - 검색어 1개 + 뉴스 = 실행마다 네이버 호출 1회. 뉴스·블로그 둘 다 고르면 2회입니다. 화면 위쪽에 예상 호출 수가 나옵니다.
  - **대량 추가·후보 생성** 탭: 학교 유형 × 입시 키워드 조합을 만들 수 있습니다. 모두 켜면 호출이 크게 늘어나니, 미리보기 후 일시정지 상태로 저장하고 필요한 것만 켜세요.
  - **시험 검색**: 버튼을 누를 때만 1회 호출, 최대 5건. 자동 저장하지 않고, 고른 것만 수집함에 저장합니다.
- **공식 출처** 탭: 학교 38곳이 "도메인 미확인·수집기 미연결" 상태로 들어 있습니다. 학교 누리집에서 직접 확인한 도메인을 넣고 "확인했음"을 체크하면, 그 도메인의 원문은 "공식 원문 확인"으로 판정됩니다. 공지 게시판을 자동으로 읽으려면 게시판 URL과 CSS 선택자를 넣고 "게시판 시험 읽기"로 확인하세요.

### 5단계. 연결 키 입력 (화면에서)

로그인 후 **채널 설정 → 서비스 연결**에서 키를 붙여 넣고 **저장 → 연결 확인**을 누르면 됩니다.

- 입력한 키는 암호화(AES-256-GCM)되어 데이터베이스에 저장되고, 웹 화면과 GitHub Actions 워커가 함께 씁니다. 비밀값은 저장 후 화면에 다시 보이지 않습니다.
- 암호를 푸는 열쇠는 Render의 `APP_SESSION_SECRET`입니다(데이터베이스에는 없음). 이 값을 바꾸면 저장된 키를 다시 입력해야 합니다.
- Render의 Environment에 같은 이름의 값을 직접 넣어 두었다면 그 값이 우선하고, 화면 입력은 막힙니다.

| 항목 | 발급처 |
|---|---|
| 네이버 검색 API (Client ID/Secret) | https://developers.naver.com → Application 등록 → 사용 API: **검색** |
| Claude API (API 키, 모델 ID) | https://console.anthropic.com · 모델 ID는 https://docs.claude.com 의 모델 목록. 사용량만큼 요금 발생 |
| 텔레그램 (봇 토큰, 검토 알림 채팅 ID) | 텔레그램 @BotFather → `/newbot` |
| Cloudinary (인스타그램 쓸 때) | https://console.cloudinary.com |
| 채널별 게시 목적지 토큰·채널 ID | 채널 설정 → 게시 목적지에서 목적지를 추가하면 입력칸이 생김 |

Claude 비용은 **채널 설정 → 입력/출력 단가**를 넣으면 실행 기록에 추정 비용이 표시됩니다(실제 청구와 다를 수 있음).

### 6단계. (선택) 환경변수로 직접 넣기

화면 대신 Render의 Environment / GitHub Secrets에 `NAVER_CLIENT_ID` 같은 이름으로 직접 넣어도 됩니다. 이 경우 그 값이 화면 입력보다 우선합니다.

### 7단계. GitHub Actions 워커 연결

저장소 → **Settings → Secrets and variables → Actions**

**Secrets** (필수 2개 — 연결 키는 화면에서 입력했다면 여기 넣을 필요 없음):

| 이름 | 값 |
|---|---|
| `APP_DATABASE_URL` | Render와 **같은** Neon 주소 |
| `APP_SESSION_SECRET` | Render → Environment의 `APP_SESSION_SECRET` 값을 그대로 복사(화면에서 입력한 키를 풀 때 필요) |

**Variables** (선택): `APP_BASE_URL`(Render 주소, 텔레그램 알림 속 링크용), 필요하면 `DRY_RUN`, `AUTO_PUBLISH`, `AUTO_COLLECT`.

그다음 **Actions 탭 → collect → Run workflow**로 수동 실행해 보세요. 화면의 **실행 기록**에 결과가 나옵니다.

- 화면의 **수집 요청** 버튼은 DB에 작업만 등록합니다. **process** 워크플로가 실행되어야 처리되고, 그 전에는 "대기 중 · 워커 미연결"로 보입니다.
- 자동 실행은 처음엔 꺼져 있습니다. 각 워크플로 파일의 `schedule` 주석을 풀면 켜집니다.
  - collect 제안: 매일 07:13 / 19:13(KST). 예약 실행에서 실제로 수집하려면 Variables에 `AUTO_COLLECT=true`.
  - process 제안: 매시 7분. **비공개 저장소 무료 한도는 월 2,000분**이고 작업마다 1분 단위로 올림되어, 15분 간격은 한도를 넘습니다.
  - GitHub 예약 실행은 정시를 보장하지 않습니다. 예약 시각 이후 다음 정상 실행에서 처리됩니다.

### 8단계. 텔레그램

1. 텔레그램에서 **@BotFather** → `/newbot` → 받은 토큰이 `TELEGRAM_BOT_TOKEN`
2. **개인 검토 알림**: 만든 봇과 1:1 대화에서 `/start`를 먼저 보내야 봇이 메시지를 보낼 수 있습니다. 내 채팅 ID를 `TELEGRAM_REVIEW_CHAT_ID`에 넣습니다. 새 자료가 수집되면 묶어서 한 번에 알려줍니다. 알림이 실패해도 자료 저장은 취소되지 않습니다.
3. **공개 채널 게시**: 채널을 만들고 봇을 **관리자(메시지 게시 권한)**로 추가 → 채널 설정 화면에서 "텔레그램 채널" 목적지 추가 → 표시된 환경변수(예: `TG_OPPORTUNITIES_CHAT_ID`)에 `@채널아이디`를 넣습니다.

### 9단계. 인스타그램 (선택)

- **Instagram API with Instagram Login** 방식만 씁니다(Facebook 페이지 토큰과 섞지 않음).
- 계정을 프로페셔널(비즈니스/크리에이터) 계정으로 바꾸고, Meta 개발자 앱에서 본인 계정을 연결해 토큰을 받는 것은 직접 해야 합니다. 이 앱은 계정을 만들거나 권한을 대신 받지 않습니다.
- 필요 값: `INSTAGRAM_API_VERSION`(공식 문서에서 확인), 목적지별 `IG_(채널)_ACCESS_TOKEN`, `IG_(채널)_USER_ID`, 그리고 이미지를 공개 주소로 올릴 **Cloudinary** 키 3개.
- 공식 문서: https://developers.facebook.com/docs/instagram-platform/content-publishing/

### 10단계. 실제 게시 켜기 (충분히 확인한 뒤)

1. 먼저 `DRY_RUN=true` 상태에서 승인 → process 실행 → 발행함에 **모의 실행(게시 안 함)**으로 나오는지 확인
2. 게시해도 되는 콘텐츠 하나와 목적지 하나를 정한 뒤, Render와 GitHub Variables 양쪽에 `DRY_RUN=false`, `AUTO_PUBLISH=true`
3. process 실행 → 발행함에서 결과와 게시 링크 확인

---

## 매일 쓰는 방법

1. **오늘의 작업**: 검토 대기·근거 확인 필요·발행 준비 건수와 다음 검토 항목
2. **수집함**: 제목을 눌러 상세 화면으로
   - 왼쪽(모바일은 "원문·근거" 탭): 실제 원문, 게시·확인 시각, 첨부(HWP 등은 "수동 확인 필요"), 근거 구절
   - 오른쪽 "편집": 자동 추출값을 고치고 **새 버전으로 저장**(이전 버전은 이력에 남음)
   - "원문에서 자동 추출"(공고) / "Claude로 초안 생성"(과학·시사)
3. **검토 완료** 표시 → **카드 만들기** → 캡션(인스타그램·텔레그램 따로) 확인 → **최종 승인**
   - 최종 승인은 "이 버전 + 이 카드 파일 + 이 캡션 + 예약 시각"에 묶입니다. 하나라도 바뀌면 승인이 무효가 되고 다시 승인해야 합니다.
   - 접수가 끝난 공고는 승인할 수 없고, 게시 직전에도 다시 검사합니다.
4. **발행함**: 목적지별 결과. 한 곳만 실패하면 그곳만 재시도합니다. "결과 불명"은 실제로 게시됐을 수 있으니 채널을 직접 확인한 뒤에만 재시도하세요.

## 문제가 생겼을 때

| 증상 | 확인할 곳 |
|---|---|
| 화면에 "DB 미연결" | Render의 `APP_DATABASE_URL` |
| 로그인 버튼이 비활성 | `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `APP_SESSION_SECRET` |
| 로그인 5번 실패 후 막힘 | 15분 후 다시 시도 |
| 수집 요청이 계속 "대기 중" | GitHub Actions의 process 실행 여부, Secrets의 `APP_DATABASE_URL` |
| 실행 기록 "실패: 네이버 API 키 미연결/인증" | 네이버 키(Render가 아니라 GitHub Secrets에도 필요) |
| "Claude API 미연결" | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| 카드 "편집 필요: 영역 넘침" | 제목·요약을 줄여서 다시 저장 후 카드 다시 만들기 |
| 게시 실패 "권한 없음" | 텔레그램 봇이 채널 관리자인지, 인스타그램 토큰 권한·만료 |
| 게시 "결과 불명" | 채널/계정에서 실제 게시 여부 확인 후 "게시 안 됨 확인 후 재시도" |

## 개발자용

```bash
npm ci
cp .env.example .env   # 값 채우기 (로컬 PostgreSQL 필요)
npm run db:migrate && npm run db:seed        # --sample 을 붙이면 개발용 샘플 1건(운영 거부)
npm run dev            # API 서버 :5000
npx vite               # 화면 개발 서버 :5173 (API는 :5000으로 프록시)
npm run typecheck && npm test && npm run build
```

- `.env`는 자동으로 읽지 않습니다. 셸에서 `export` 하거나 `node --env-file=.env`를 쓰세요.
- 테스트는 실제 PostgreSQL을 씁니다: `TEST_DATABASE_URL=postgres://.../aimom_test npm test` (그 DB는 테스트 때마다 비워집니다).
- 명령: `collect:once`(수집 1회) · `jobs:once`(대기 작업 처리) · `publish:once`(예약 게시 처리) — 모두 한 번 실행 후 종료합니다.
- `scripts/ai_mom_prepare.sh inspect|prepare`: 프로젝트 파일 이름·의존성 목록만 점검하는 보조 도구(파일·DB를 바꾸지 않음).

### 기술 구성

TypeScript · React 19 + Vite · Express 5 · PostgreSQL + Drizzle ORM · Zod · Cheerio · unpdf(텍스트 PDF) · Anthropic SDK · opentype.js + resvg + sharp(카드) · Cloudinary SDK. Node 22.

카드는 브라우저(Chromium) 없이 만듭니다. 한글 폰트(Pretendard, SIL OFL — `assets/fonts/Pretendard-LICENSE.txt`)의 글자 모양을 벡터로 바꿔 그리기 때문에, Render 무료 서버에서도 같은 결과가 나옵니다. 폰트 파일이 없으면 다른 폰트로 대체하지 않고 실패로 표시합니다.

### 참고 문서

- 네이버 검색 API: https://developers.naver.com/docs/serviceapi/search/news/news.md
- Claude 모델: https://docs.claude.com/en/docs/about-claude/models/overview
- Instagram 게시: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Telegram Bot API: https://core.telegram.org/bots/api
- GitHub Actions 이벤트: https://docs.github.com/actions/using-workflows/events-that-trigger-workflows
- GitHub Actions 요금: https://docs.github.com/en/billing/concepts/product-billing/github-actions
