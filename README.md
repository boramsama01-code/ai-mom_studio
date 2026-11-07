# 우주펭귄상회 Studio

기존 Render 앱 안에 Studio Board, Highscoop 수집함, API 설정을 통합한 운영 앱입니다. 같은 주소와 로그인으로 제작과 수집 작업을 관리합니다.

- 첫 화면 **Studio Board**: 우주펭귄상회·Fryday·Highscoop·Alligodang의 기획, 원고, 제작, 검토, 완료 상태를 관리합니다.
- 콘텐츠 상세: 지시문으로 원고를 만들거나 수정하고, 캐릭터 원본을 기준으로 선택한 한 컷을 다시 그립니다. 네 컷 그림과 대사는 따로 편집합니다.
- 버전 기록: GPT·Claude 결과 비교, 이전 내용 복원. 생성 도중 직접 고친 내용은 덮어쓰지 않습니다.
- **API·채널 설정**: GPT 키, 글 모델, 이미지 모델, 선택적 Claude 키를 기존 암호화 저장소에 저장합니다. 기본 글 AI는 GPT 우선이며 이미지 생성은 OpenAI를 사용합니다. ChatGPT 구독과 API 사용료는 별도입니다.
- 생성 요청과 이미지·원고·이력은 PostgreSQL에 저장합니다. 유료 생성 실패나 결과를 확인하지 못한 요청은 자동 재시도하지 않습니다.

기존 수집·발행 채널은 그대로 유지됩니다. 수집 항목 상세의 **Studio에서 제작**으로 같은 앱의 제작 작업에 연결할 수 있습니다. Studio 제작 결과는 다운로드해 검토하며, 기존 발행함의 승인·모의 실행 조건은 유지됩니다.

| 채널 | 하는 일 |
|---|---|
| Highscoop · 고입 | 특목고 중심 고입, 자사고·영재학교 입시 및 관련 공고를 모으고 확인 |
| Alligodang · 과학 | 과학 질문 하나로 5~10분 대화할 거리를 근거와 함께 준비 |
| Alligodang | 사실·관점·가치를 나눠 시사 주제로 대화할 거리를 준비 |

흐름은 **수집 → 원문 확보 → 자동 추출·초안 → 사람이 검토 → 카드 이미지 → 최종 승인 → 게시**입니다.
자동으로 만든 결과는 모두 "검토 대기"로 들어가고, 사람이 승인해야만 게시 단계로 넘어갑니다.

지금 구현된 것과 아직 안 된 것은 [BUILD_STATUS.md](BUILD_STATUS.md)에 정리되어 있습니다.

## 기존 Render 서비스 업데이트

현재 운영 주소는 [spacepenguin.onrender.com](https://spacepenguin.onrender.com)입니다. Render의 `spacepenguin` 무료 웹 서비스가 이 저장소의 `main`을 배포합니다. 기존 Neon 데이터베이스와 로그인 설정은 `spacepenguin-studio-config` 환경 그룹으로 연결하고, 서비스의 `APP_BASE_URL`은 새 주소를 사용합니다. 기존 `APP_DATABASE_URL`, `APP_SESSION_SECRET`, `APP_SECRETS_KEY`는 유지해야 저장된 키를 계속 읽을 수 있습니다. Render 환경변수에 이미 있는 API 키가 화면에서 저장한 값보다 우선합니다.

운영자 아이디는 `spacepenguin`입니다. **설정 → 계정·비밀번호**에서 현재 비밀번호를 확인하고 직접 새 비밀번호를 저장할 수 있습니다. 잊어버린 경우 소유자가 발급한 일회용 `/password-setup#reset=...` 링크에서 새 비밀번호를 정합니다. 저장 후 모든 기기에서 다시 로그인하며, 이전 비밀번호·기존 전용 접속 링크·이미 발급된 설정 링크는 사용할 수 없습니다. 현재 명칭과 이전 데이터 호환 범위는 [BRANDING.md](BRANDING.md)를 참고하세요.

기존 `ai-mom-studio` 웹 서비스(`srv-dat0vbg473hc73e9l5r0`)는 소유자 승인에 따라 2026-11-06 한국 시간에 삭제했습니다. 이전 주소와 그 주소의 OAuth 콜백은 더 이상 사용하지 않습니다. 메인 `spacepenguin`(`srv-dbjep0ou01pc73f8rf80`)과 공유 DB·환경 그룹은 유지했습니다. 루트 `render.yaml`은 이전 서비스의 Blueprint이므로 다시 적용하거나 이름만 바꿔 동기화하지 마세요. 현재 서비스는 Render 설정에서 관리하며, GitHub Actions의 `APP_BASE_URL` 저장소 변수와 수집·처리 워크플로 기본 주소는 `https://spacepenguin.onrender.com`을 사용합니다.

시작 시 추가 테이블 마이그레이션과 한 번만 실행되는 초기 보드 이전을 수행합니다. 확인한 Sites 자료는 수정되지 않은 기본 기획 7개·메모·참고 공고 7개였습니다. 기획은 초안으로, 과거 참고 공고는 샘플로 보존하며 별도 소유자 정보나 API 키를 복사하지 않습니다. 이 작업은 기존 수집 자료·게시 승인·사용자 설정을 덮어쓰지 않습니다.

기본 `INLINE_WORKER=true`이면 앱에서 요청한 AI 작업을 즉시 처리합니다. 재시작 전에 대기 중이던 요청도 다음 시작 시 확인합니다. 실행 도중 서버가 중단된 유료 요청은 결과가 불명확하므로 실패로 표시하고 재과금하지 않습니다. `INLINE_WORKER=false`이면 기존 GitHub `process` 워커가 작업을 처리해야 합니다.

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
   ├ collect.yml        공개 뉴스 RSS·선택 블로그·공식 게시판 수집 → 원문 확보 → 구조화 추출
   └ process.yml        화면에서 등록한 수집 요청 처리 + 예약된 게시 전송
```

- 무료 웹 서비스는 유휴 중지 후 첫 요청에 기동 대기가 생길 수 있습니다. 화면 로딩 표시와 서버 기동 시간은 별도로 측정합니다.
- 웹 서비스가 깨어 있으면 inline worker가 제작·Canva 처리와 승인된 예약 발행을 확인합니다. 화면을 닫아도 작업과 결과는 PostgreSQL에 남습니다.
- 기존 GitHub `process.yml`은 매시간 17분에 DB의 대기·복구 작업과 시각이 지난 승인 건을 확인합니다. 웹 서비스 유휴 중지와 GitHub 실행 지연이 있으므로 정확한 분 단위의 예약 발행을 보장하지 않습니다.

## 안전 스위치 (기본값)

| 변수 | 기본 | 의미 |
|---|---|---|
| `DRY_RUN` | `true` | 게시 단계에서 모든 검사를 하지만 **실제로 게시하지 않습니다**(모의 실행). |
| `AUTO_PUBLISH` | `false` | `DRY_RUN=false`여도 이 값이 `true`가 아니면 게시하지 않습니다. |
| `AUTO_COLLECT` | `false` | 화면에 자동 수집 설정을 아직 저장하지 않았을 때 쓰는 기본값입니다. 저장된 체크박스 값이 우선하며, 꺼두면 예약 수집을 건너뜁니다. 수동 실행은 가능합니다. |
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
git clone https://github.com/boramsama01-code/content-workbench spacepenguin-studio
cd spacepenguin-studio
npm ci
npm run hash-password -- "12자 이상 비밀번호"
```

출력된 `$2a$12$...` 값이 `ADMIN_PASSWORD_HASH`입니다.

### 3단계. Render에 배포

1. https://render.com 가입 → **New → Blueprint** → 이 GitHub 저장소 선택
   (저장소에 있는 `render.yaml`을 읽어 설정을 자동으로 채웁니다. Region은 Singapore로 되어 있습니다.)
2. 값을 물어보는 항목은 2개입니다(빈칸으로 둘 수 없음):
   - `APP_DATABASE_URL`: 1단계의 Neon 주소
   - `ADMIN_PASSWORD_HASH`: 2단계 결과
   - 운영자 아이디는 `spacepenguin`입니다. 루트 Blueprint는 이전 주소 호환용입니다. 별도 운영 인스턴스를 만들 때는 고유한 서비스 이름을 사용하고 `APP_CANONICAL_REDIRECT_URL`을 비우세요.
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

- **과학·시사 채널은 검색어가 없어도 됩니다 — 자동 화제 발굴**
  - 수집할 때마다 탐색 주제(과학: 연구팀 발견·우주 탐사·인공지능 기술·기후 환경 연구 / 시사: 정부 발표·국회 법안·교육부·국제 정상)로 최신 뉴스를 주제당 100건씩 훑습니다.
  - 제목·요약의 핵심 낱말이 겹치는 기사를 같은 사건으로 묶고, **다룬 언론사 수**를 화제도로 셉니다(1곳만 쓴 기사는 화제로 보지 않음).
  - Claude가 연결돼 있으면 화제 후보 중 채널에 맞는 것을 골라 "고른 이유·대화 질문"을 붙이고 대화 초안까지 만듭니다. 없으면 화제도 순으로 고르고, 강력범죄·자살·마약·연예·주가 같은 주제는 뺍니다.
  - 같은 사건을 다룬 다른 언론사 기사 3건은 보조 근거로 연결합니다(시사 초안의 독립 출처 확인용). 최근 5일 안에 고른 사건은 다시 고르지 않습니다.
  - **검색 설정** 화면 위쪽에서 켜기/끄기, 탐색 주제, 한 번에 고를 수(기본 3), 초안 자동 생성을 바꿀 수 있습니다. 탐색 주제 1개 = 네이버 호출 1회.
  - 검색어는 꼭 챙기고 싶은 주제가 있을 때만 추가하면 됩니다.

### 5단계. 연결 키 입력 (화면에서)

로그인 후 **채널 설정 → 서비스 연결**에서 키를 붙여 넣고 **저장 → 연결 확인**을 누르면 됩니다.

- 입력한 키는 암호화(AES-256-GCM)되어 데이터베이스에 저장되고, 웹 화면과 GitHub Actions 워커가 함께 씁니다. 비밀값은 저장 후 화면에 다시 보이지 않습니다.
- 암호를 푸는 열쇠는 Render의 `APP_SESSION_SECRET`입니다(데이터베이스에는 없음). 이 값을 바꾸면 저장된 키를 다시 입력해야 합니다.
- Render의 Environment에 같은 이름의 값을 직접 넣어 두었다면 그 값이 우선하고, 화면 입력은 막힙니다.

| 항목 | 발급처 |
|---|---|
| 네이버 검색 API (Client ID/Secret) | **NAVER API HUB**(네이버 클라우드) — 아래 "네이버 키 받기" 참고. 개발자센터(developers.naver.com)는 2026-07-31부터 새 등록이 안 됩니다 |
| Claude API (API 키, 모델 ID) | https://console.anthropic.com · 모델 ID는 https://docs.claude.com 의 모델 목록. 사용량만큼 요금 발생 |
| 텔레그램 (봇 토큰, 검토 알림 채팅 ID) | 텔레그램 @BotFather → `/newbot` |
| Cloudinary (인스타그램 쓸 때) | https://console.cloudinary.com |
| 채널별 게시 목적지 토큰·채널 ID | 채널 설정 → 게시 목적지에서 목적지를 추가하면 입력칸이 생김 |

**네이버 키 받기 (NAVER API HUB)**
1. https://www.ncloud.com 에 네이버 아이디로 로그인(처음이면 회원가입·약관 동의, 결제수단 등록을 요구할 수 있음. 검색 API는 현재 무료)
2. 콘솔 → **Services → Application Services → NAVER API HUB**
3. **Subscription**에서 검색 상품 **[서비스 이용 신청]**
4. **Application** 메뉴에서 **[Application 등록]** → 이름(예: Space Penguin Studio) 입력, 검색 API 선택
5. 등록된 Application의 **인증 정보**에서 Client ID와 Client Secret 확인 → 이 앱의 네이버 칸에 붙여 넣기
- 계정 전체용 "API 인증키(Access Key)"가 아니라, Application에서 받은 값이어야 합니다.
- 예전에 개발자센터에서 받은 키가 있다면 그것도 그대로 넣으면 됩니다(2027-06-30까지). 앱이 두 방식을 자동으로 구분합니다.

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

- 화면의 **지금 수집** 버튼은 GitHub 연결 없이 웹 서버에서 바로 실행합니다(보통 1~3분). 이 7단계는 **정해진 시각 자동 수집**과 **예약 게시**에만 필요합니다.
- **자동 수집**: collect 워크플로가 매일 08:00(KST)에 예약됩니다. GitHub 실행은 지연될 수 있습니다. **오늘 → 자동 수집 허용**이 켜져 있을 때만 자료를 수집하고, 꺼두면 예약 확인 후 수집을 건너뜁니다. 저장된 체크박스 값은 Variables `AUTO_COLLECT`보다 우선합니다. 수동 **지금 수집**은 이 스위치와 별개입니다. 필수 DB Secret이 없으면 실패로 표시합니다. 연결 검사만 성공한 것은 자료 수집 완료가 아닙니다.
- **날짜별 결과**: 수집함은 오늘 처음 저장한 자료를 기본으로 표시합니다. ‘전체 기간’으로 이전 자료를 볼 수 있습니다. 아침 수집 브리핑은 채널별 신규 건수·실제 실행·실패 사유를 1분마다 갱신합니다. 열린 화면도 한국 날짜가 바뀌면 ‘오늘’을 갱신합니다. 수집일과 원문 게시일은 별개입니다.
- **추천 검색어**: 브리핑의 채널별 ‘추천 검색어’에서 입시·STEM 80개, 과학 24개, 시사 24개, Fryday 22개를 추가할 수 있습니다. 과학·시사는 8개 탐색 주제씩 별도로 사용합니다. 기존 검색어·일시정지는 유지하며, 호출 한도 때문에 밀린 검색어는 다음 실행에서 먼저 처리합니다. 직접 수집 버튼은 유료 AI·알림·SNS 게시를 하지 않습니다.
- **연결만 확인**: collect → Run workflow → `check_only`를 선택하면 DB 연결·저장된 키 복호화만 검사합니다. 수집·대기 작업·AI·알림·게시는 실행하지 않습니다.
- 예약 수집은 `AUTO_GENERATE`·`COLLECT_REVIEW_NOTIFICATIONS` 설정과 무관하게 자료만 수집합니다. AI 작성·Telegram 검토 알림·SNS 게시는 실행하지 않습니다. 수동으로 누르는 AI 제작 버튼은 별개입니다.
- process(대기 작업·예약 게시 처리)는 매시 17분에 실행합니다. 최종 승인한 게시물만 예약 시각 이후 처리합니다. GitHub 예약 실행은 정시를 보장하지 않습니다.

### 8단계. 텔레그램

1. 텔레그램에서 **@BotFather** → `/newbot` → 받은 토큰이 `TELEGRAM_BOT_TOKEN`
2. **개인 검토 알림**: 만든 봇과 1:1 대화에서 `/start`를 먼저 보내야 봇이 메시지를 보낼 수 있습니다. 내 채팅 ID를 `TELEGRAM_REVIEW_CHAT_ID`에 넣습니다. 새 자료가 수집되면 묶어서 한 번에 알려줍니다. 알림이 실패해도 자료 저장은 취소되지 않습니다.
3. **공개 채널 게시**: 채널을 만들고 봇을 **관리자(메시지 게시 권한)**로 추가 → 채널 설정 화면에서 "텔레그램 채널" 목적지 추가 → 표시된 환경변수(예: `TG_OPPORTUNITIES_CHAT_ID`)에 `@채널아이디`를 넣습니다.

### 9단계. 인스타그램 (선택)

- **Instagram API with Instagram Login** 방식만 씁니다(Facebook 페이지 토큰과 섞지 않음).
- 계정을 프로페셔널(비즈니스/크리에이터) 계정으로 바꾸고, Meta 개발자 앱에서 본인 계정을 연결해 토큰을 받는 것은 직접 해야 합니다. 이 앱은 계정을 만들거나 권한을 대신 받지 않습니다.
- 필요 값: `INSTAGRAM_API_VERSION`(공식 문서에서 확인), 목적지별 `IG_(채널)_ACCESS_TOKEN`, `IG_(채널)_USER_ID`, 그리고 이미지를 공개 주소로 올릴 **Cloudinary** 키 3개.
- 공식 문서: https://developers.facebook.com/docs/instagram-platform/content-publishing/

### 9-1단계. (선택) 카드 디자인 · Canva 자동 채우기

왼쪽 메뉴 **카드 디자인**에서 세 가지 방식 중 고를 수 있습니다.

1. **기본 템플릿 4종**(기본·컬러 헤더·매거진·미니멀): 채널 기본값을 정하면 카드 만들기에 그대로 쓰입니다. 콘텐츠마다 카드 만들 때 다른 템플릿을 고를 수도 있습니다.
2. **내 배경 템플릿**: Canva·망고보드·포토샵에서 **글자 없이 배경만** 1080×1350(4:5)로 만들어 PNG/JPG로 내려받아 올립니다. 제목·일정 같은 글자는 이 앱이 자동으로 얹습니다. 글자색(어두운/흰)과 "가독성 막"(배경을 살짝 덮는 반투명 층) 정도를 정할 수 있습니다.
3. **Canva 자동 채우기**(Canva Pro·Teams·Enterprise 계정 필요):
   1. https://www.canva.com/developers/apps 에서 앱 만들기 → 종류는 **Outside Canva**(Connect API)
   2. Scopes(권한): `design:content:read`, `design:content:write`, `design:meta:read`, `brandtemplate:meta:read`, `brandtemplate:content:read`
   3. Redirect URL(돌아올 주소): `https://(내 Render 주소)/api/canva/callback`
   4. 발급된 Client ID·Client secret을 **채널 설정 → 서비스 연결 → Canva**에 저장 → **카드 디자인** 화면에서 "Canva 연결"
   5. Canva에서 **브랜드 템플릿**을 만들고, 글자 칸에 데이터 필드 이름을 붙입니다. 이름은 카드 디자인 화면 표의 영문 이름(`title`, `schedule`, `summary` 등)과 같아야 자동으로 채워집니다.
   6. 채널의 Canva 브랜드 템플릿을 고른 뒤, 콘텐츠 상세 → 카드·승인 → **Canva로 만들기** → Canva에서 다듬기 → **Canva 결과 가져오기**
   - Canva에서 만든 결과도 이 앱의 최종 승인(버전·카드·캡션 묶음)을 똑같이 거칩니다. 가져온 뒤 내용을 고치면 다시 가져와야 합니다.

**API 없이 쓰는 방법**
- **Canva 대량 제작(Bulk Create)**: 카드 디자인 화면에서 CSV를 내려받아 Canva 대량 제작에 올리면 행마다 디자인이 한 장씩 만들어집니다(Pro 이상, 데스크톱, 한 번에 최대 300행).
- **망고보드**: 공개 API나 대량 제작 기능을 확인하지 못해 자동 입력은 없습니다. 콘텐츠 상세의 **글자 복사** 칸에서 항목별로 복사해 붙여 넣습니다.

### 10단계. 실제 게시 켜기 (충분히 확인한 뒤)

1. 먼저 `DRY_RUN=true` 상태에서 승인 → process 실행 → 발행함에 **모의 실행(게시 안 함)**으로 나오는지 확인
2. 게시해도 되는 콘텐츠 하나와 목적지 하나를 정한 뒤, Render와 GitHub Variables 양쪽에 `DRY_RUN=false`, `AUTO_PUBLISH=true`
3. process 실행 → 발행함에서 결과와 게시 링크 확인

---

## 매일 쓰는 방법

> 단축키: **Ctrl/⌘ + K** 어디서나 검색·이동(페이지, 콘텐츠 제목, 채널 전환). 수집함 목록에서 **J/K** 위아래, **Enter** 열기, **X** 선택, **H** 보류, **E** 제외. 여러 개를 체크해 한 번에 보류·제외할 수 있습니다.

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
| 네이버 API 키 미연결/인증 실패 | 공개 뉴스 RSS는 키 없이 계속 수집합니다. 선택 블로그 수집을 사용하려면 API 키 관리에서 실제 발급 키를 저장·검사하세요. |
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
- 테스트는 실제 PostgreSQL을 씁니다: `TEST_DATABASE_URL=postgres://.../spacepenguin_test npm test` (그 DB는 테스트 때마다 비워집니다).
- 명령: `collect:once`(수집 1회) · `jobs:once`(대기 작업 처리) · `publish:once`(예약 게시 처리) — 모두 한 번 실행 후 종료합니다.
- `scripts/spacepenguin_prepare.sh inspect|prepare`: 프로젝트 파일 이름·의존성 목록만 점검하는 보조 도구(파일·DB를 바꾸지 않음).

### 기술 구성

TypeScript · React 19 + Vite · Express 5 · PostgreSQL + Drizzle ORM · Zod · Cheerio · unpdf(텍스트 PDF) · Anthropic SDK · opentype.js + resvg + sharp(카드) · Cloudinary SDK. Node 22.

카드는 브라우저(Chromium) 없이 만듭니다. 한글 폰트(Pretendard, SIL OFL — `assets/fonts/Pretendard-LICENSE.txt`)의 글자 모양을 벡터로 바꿔 그리기 때문에, Render 무료 서버에서도 같은 결과가 나옵니다. 폰트 파일이 없으면 다른 폰트로 대체하지 않고 실패로 표시합니다.

### 참고 문서

- NAVER API HUB 이관 가이드: https://guide.ncloud-docs.com/docs/apihub-migration
- 네이버 검색 API(기존 문서, 요청·응답 형식): https://developers.naver.com/docs/serviceapi/search/news/news.md
- Claude 모델: https://docs.claude.com/en/docs/about-claude/models/overview
- Instagram 게시: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Telegram Bot API: https://core.telegram.org/bots/api
- GitHub Actions 이벤트: https://docs.github.com/actions/using-workflows/events-that-trigger-workflows
- Canva Connect API(자동 채우기·인증·내보내기): https://www.canva.dev/docs/connect/
- Canva 대량 제작: https://www.canva.com/help/bulk-create/
- GitHub Actions 요금: https://docs.github.com/en/billing/concepts/product-billing/github-actions


### 개인 전용 접속 링크

`/#access=...` 형태의 전용 링크로 아이디·비밀번호 입력 없이 운영 세션을 시작할 수 있습니다. 링크를 가진 사람은 운영자 권한을 가지므로 공유하지 마세요. 비밀값은 주소의 fragment로만 전달되고 화면 시작 시 주소창에서 제거됩니다. 브라우저 저장소에는 보관하지 않으며, 서버에는 원본 대신 `APP_PRIVATE_LINK_SHA256` 검증값만 설정합니다.

토큰은 암호학적 난수 32바이트의 base64url 문자열입니다. 이 문자열의 SHA-256(소문자 64자리)을 기존 Render 서비스 환경변수에 추가합니다. 설정의 원본은 Render 서비스 환경변수이며 Blueprint에는 값을 넣지 않습니다. 원본 링크·토큰을 저장소나 로그에 남기지 마세요. 검증값 교체 또는 제거 후 재배포하면 이전 링크와 그 링크로 만든 세션이 모두 무효화됩니다. 기존 비밀번호 로그인은 복구 수단으로 유지됩니다.

전용 링크 세션은 마지막 사용 후 30일간 유지되며, 기존 HttpOnly/Secure/SameSite 쿠키와 CSRF·Origin 검사를 그대로 적용합니다. 링크가 없거나 잘못되면 운영 데이터에 접근할 수 없습니다.

