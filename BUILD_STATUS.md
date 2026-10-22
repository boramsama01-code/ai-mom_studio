# BUILD_STATUS — 우주펭귄상회 Studio

마지막 갱신: 2026-10-22
기준 명세: `ai_mom_all_in_one.md`(2026-09-28) — Replit 대신 **Render(웹) + Neon(DB) + GitHub Actions(워커)**로 구현

표기: ✅ 완료·검증 / 🟡 구현했으나 실제 외부 서비스로는 미검증 / ⛔ 차단(이 개발 환경에서 불가) / ⬜ 미구현

## Render 통합 업데이트 (2026-10-22)

- 대화 중단 복구 기록과 재개 순서: `RESUME.md`. 운영 배포 완료 여부는 해당 문서의 최신 검증 기록을 우선합니다.
- 2026-10-22 11:32 KST 기존 Render 서비스 배포 live 완료. DB 헬스 200, 보호 API 비로그인 401, 새 JS/CSS·웹폰트 200, 캐릭터 4개와 예시 웹툰의 운영 원본 해시 일치, 저장된 연결 키 7개 로드 및 로그인 화면을 확인했습니다. 로그인 후 실제 유료 생성은 실행하지 않았습니다.

- Studio Board를 첫 화면으로 통합. 펭귄상회·Highway·Fryday·시사 기획, 원고, 이미지, 버전 기록을 같은 로그인으로 관리합니다.
- GPT 기본 글 생성·수정, 선택적 Claude 재작성·비교, 캐릭터 참조를 활용한 OpenAI 한 컷 생성. API 호출은 모의 응답으로 검증했으며 실제 유료 생성은 실행하지 않았습니다.
- 원고·대사와 그림을 분리하고, 네 컷 PNG 다운로드를 제공합니다. Studio 결과를 기존 SNS 발행함으로 자동 전송하는 기능은 포함하지 않습니다.
- 기존 Sites의 수정되지 않은 기본 기획 7개·메모와 참고 공고 7개를 이전합니다. 참고 공고는 샘플로 보존합니다. 별도 소유자 계정이나 키는 복사하지 않습니다.
- 추가 마이그레이션만 적용하며 기존 PostgreSQL 데이터·암호화 키·로그인을 유지합니다. 생성 요청 UUID 중복 방지, 단계 변경 시 내용 보존, 동시 편집 보존, 전역 정지를 적용합니다.
- PR #4 병합 완료. PostgreSQL 16 GitHub CI에서 15개 파일·120개 테스트, 타입 검사, 프로덕션 빌드 모두 통과했고 병합 후 main CI도 성공했습니다. Render 배포와 운영 검증 결과는 `RESUME.md`를 우선합니다. 실제 유료 API 생성은 실행하지 않았습니다.
- GitHub 참고: TanStack Query 50,455 stars(MIT, 10/22 push), Trigger.dev 16,592 stars(Apache-2.0, 10/21 push), pg-boss 4,075 stars(MIT, 10/21 push), 2026-10-22 조회. TanStack Query는 기존 의존성을 활용하며 나머지는 설계 참고입니다. 별도 자동화 서버·Redis·유료 서비스는 추가하지 않았습니다.
- TanStack의 mutation 상태·오류 처리 패턴을 PNG 다운로드에 적용했습니다. 다운로드 오류는 편집기 안에서 표시하고, 작업 상태 조회가 일시 실패해도 편집기를 유지합니다. Trigger.dev의 idempotency 주의사항에 따라 요청 UUID 중복 방지와 유료 호출 재시도 금지를 분리합니다. 보드를 다시 열면 저장된 대기 작업을 확인하며, 이미 실행한 유료 호출은 만료되어도 자동 재실행하지 않습니다.
- 참고 문서: https://tanstack.com/query/latest/docs/framework/react/guides/mutations · https://trigger.dev/docs/idempotency · https://github.com/timgit/pg-boss . 코드를 복사한 것이 아니라 기존 구현에 맞춰 패턴을 적용했습니다.

> 이 개발 환경의 셸은 외부 웹사이트에 접속할 수 없었습니다(패키지 저장소·GitHub만 허용). 그래서 네이버·Claude·텔레그램·인스타그램·Cloudinary·학교 게시판에 **실제로 요청을 보낸 검증은 하지 않았습니다**. 이 서비스들과의 연동은 공식 문서의 요청·응답 형식대로 만들고, 가짜 응답으로 흐름만 테스트했습니다.

## 1. 핵심 운영 — ✅
- ✅ 브랜드 UI(사이드바 224px, 토큰, 채널별 강조색), 모바일 320/390px 가로 넘침 없음(브라우저 반응형 검사 — 실제 휴대폰 기기 검증은 아님)
- ✅ 채널 3개 시드(중복 생성 없음, 재실행해도 사용자 변경을 덮어쓰지 않음), 채널 설정 편집(낙관적 잠금)
- ✅ PostgreSQL + Drizzle 마이그레이션(`migrations/0000_init.sql`), 서버 시작 시 자동 적용
- ✅ 단일 운영자 인증: bcrypt 해시, Postgres 세션, 허용 아이디 1개, CSRF 토큰 + Origin 검사, 15분 5회 실패 차단. 인증 미설정 시 운영 API 차단
- ✅ 키워드: 추가/수정/일시정지/soft delete/복구, Unicode·공백 정규화 중복 방지(DB UNIQUE), 줄 단위 대량 추가 + 저장 전 미리보기, 학교×키워드 후보 생성, 제외어(수집 후 적용, 사유 보존), 예상 호출 수 표시
- ✅ 시험 검색(1검색어·1endpoint·5건, 저장 없음) → 선택 자료만 저장
- ✅ 수집함(검색·상태·카테고리·일정·근거 필터, 페이지네이션), 상세(원문·근거 | 편집), 버전 이력, 감사 로그
- ✅ 미저장 편집 보호(저장/버리기/취소 모달, 새로고침 경고), 동시 수정 충돌(409) 시 입력 유지
- ✅ '전체' 채널은 조회 전용, 채널 전환 시 이전 채널 캐시 제거

## 2. 실제 자료 — 🟡
- 🟡 네이버 검색 API HUB 이관 대응: `naverapihub.apigw.ntruss.com/search/v1/{news|blog}` + `X-NCP-APIGW-API-KEY(-ID)` 우선, 인증 거부 시 기존 `openapi.naver.com` 자동 시도(2027-06-30까지) — 가짜 응답 테스트만
- 🟡 네이버 뉴스·블로그 검색(불리언 문법 자동 삽입 없음, 429/5xx 제한 백오프, 인증 오류 즉시 중단) — 가짜 응답으로만 검증
- 🟡 원문 확보: 공개 HTTP(S)만, 리디렉트마다 재검사, 연결 시점 DNS 재검사(리바인딩 방지), 크기·시간·횟수 제한, 텍스트 PDF 추출, HWP/HWPX/스캔 PDF는 수동 확인 사유 기록
- 🟡 설정형 공식 게시판 수집기(`generic_board`): 확인한 도메인의 링크만, 목록→상세→근거. **실제 학교 게시판 1곳 대상 검증은 못 함(⛔ 네트워크)**. 운영자가 선택자를 넣고 "게시판 시험 읽기"로 확인해야 함
- ⬜ 베리타스알파 어댑터: 공개 페이지 구조·접근 조건을 이 환경에서 확인할 수 없어 구현하지 않음(미연결로 표시)
- ✅ 중복: URL 정규화(추적 파라미터만 제거) + UNIQUE, 같은 URL 내용 변경 시 재검토, 비슷한 항목은 표시만(자동 병합 없음)
- ✅ 날짜: KST 기준, 뉴스(시각)·블로그(날짜) 정밀도 분리, 접수/행사/예약/결과 구분, 날짜만 있는 마감은 그날 끝까지, 원문에 없는 시각 추가 안 함
- ✅ 실행 예산(네이버 12 / 결과 60 / 원문 대상 20·호출 40 / LLM 20), 계획·실제 호출 분리 기록, 실패를 "정상 0건"으로 숨기지 않음

## 3. 콘텐츠 제작 — 🟡
- 🟡 Claude 구조화 추출(공고) / 과학·시사 초안: 도구 호출로 JSON 강제 → Zod 검증 → 1회 수정 재시도, 근거 구절이 원문에 실제로 있는지 서버가 재검사, URL 생성 금지, 모델·프롬프트 버전·토큰 기록 — **실제 API 미호출(키 없음)**, 가짜 결과로 흐름 검증
- ✅ 운영자 편집본은 재추출로 덮어쓰지 않음, 일정·대상 변경 시 재검토
- ✅ 한글 카드 1080×1350 RGB JPEG(Pretendard OFL 포함), 폭 기준 줄바꿈·최대 줄·넘침 → "편집 필요", 폰트 없으면 실패, 미리보기·다운로드
  - 명세의 Chromium/Playwright 대신 opentype.js+resvg+sharp 사용: Render 무료 서버에 브라우저 설치가 어렵기 때문. 결과는 같은 형식
- ✅ 검토 완료 ≠ 최종 승인. 최종 승인 = revision + 카드 해시 + 목적지별 캡션 + 예약 시각, 변경 시 무효

## 4. 외부 연동 — 🟡
- 🟡 Cloudinary 업로드(HTTPS·JPEG 확인), Telegram(개인 검토 알림/공개 채널 분리, message_id 저장, 응답 유실=결과 불명), Instagram(Instagram Login 방식, 컨테이너→상태 폴링→게시→permalink, 토큰 만료·한도 구분, 처리 중이면 다음 실행에서 이어감)
- ✅ DRY_RUN=true 기본: 외부 요청 0건, succeeded로 저장 안 함(테스트로 확인)
- ✅ 부분 성공 시 실패 목적지만 재시도, 결과 불명은 "게시 안 됨 확인" 후에만 재시도(가짜 텔레그램 응답으로 확인)
- ✅ 목적지 비밀값은 환경변수 **이름**만 DB 저장, 채널 slug에 묶인 허용 패턴만 읽음

## 5. 반복 운영 — 🟡
- ✅ DB 작업 큐(FOR UPDATE SKIP LOCKED, lease·heartbeat, 만료 복구, 중복 요청 방지), 워커 실행 기록
- ✅ `collect:once` / `jobs:once` / `publish:once` (한 번 실행 후 종료, DB 연결 실패 시 exit 1)
- 🟡 GitHub Actions: `ci.yml`(타입검사·테스트·빌드), `collect.yml`·`process.yml`(수동 실행만, schedule 주석) — **Actions에서 실제 실행은 Secrets 등록 후 확인 필요**
- 🟡 Render Blueprint(`render.yaml`, Singapore, free) — 실제 배포는 사용자 계정에서 진행 필요
- ✅ 과학·시사 초안 자동 생성: 자동 화제 발굴로 고른 화제에 한해, 채널 설정 "초안 자동 생성"이 켜져 있고 Claude가 연결돼 있을 때

## 6. 화면 v2 · 카드 템플릿 — ✅ / Canva 🟡
- ✅ 사이드바 그룹(작업/설정)·건수 배지, Ctrl/⌘K 명령 팔레트(페이지·동작·채널·콘텐츠 검색), 알림 토스트
- ✅ 오늘의 작업: "시작하기" 체크리스트(실제 연결 상태로 완료 판정), 숫자 카드 클릭 시 해당 필터로 이동
- ✅ 수집함: 키보드 처리(J/K/Enter/X/H/E), 여러 건 선택 후 보류·제외·되돌리기(`POST /channels/:cid/items/bulk`)
- ✅ 콘텐츠 상세: 진행 단계 표시(수집→원문→초안→검토→카드→승인) + "다음 할 일" 버튼, 인스타그램 미리보기, 항목별 글자 복사
- ✅ 발행함: 주간 달력 / 목록 전환
- ✅ 카드 템플릿: 기본 4종 + 사용자 배경 업로드(1080×1350로 자동 맞춤, 글자색·덮개 농도), 채널 기본값, 콘텐츠별 선택, 미리보기(예시 문구) — `migrations/0002_templates.sql`
- ✅ Canva 대량 제작용 CSV(UTF-8 BOM) 내보내기, 망고보드용 글자 복사 칸
- 🟡 Canva Connect API: OAuth(PKCE) 연결, 브랜드 템플릿 목록·데이터 필드, 자동 채우기(autofill) → 편집 링크, PNG 내보내기 → 카드로 가져오기(내용이 바뀌었으면 409). **실제 Canva 계정으로는 미검증**(가짜 응답 테스트만). Canva Pro 이상 필요
- ⬜ 망고보드 자동 입력: 공개 API를 확인하지 못함

## 7. 자동 화제 발굴·즉시 수집 — ✅ / 실제 네이버 응답 🟡
- ✅ 과학·시사 채널: 검색어 없이 탐색 주제(채널별 기본 4개, 화면에서 변경)로 뉴스 최신 100건씩 → 사건 묶기(제목·요약 핵심 낱말 겹침) → 언론사 수로 화제도 → 부적절 주제 제외 → 최근 5일 같은 사건 제외
- ✅ Claude 연결 시 채널 성격에 맞춰 선정(이유·대화 질문 저장), 실패하면 화제도 순으로 대체. 고른 화제는 원문 + 다른 언론사 보조 기사 2건 확보 후 대화 초안 자동 생성(검토 대기로 들어감) — `migrations/0003_discovery.sql`
- ✅ "지금 수집": 웹 서버에서 바로 처리(같은 DB 대기열·lease 사용, `INLINE_WORKER=false`면 기존처럼 워커 대기)
- ✅ 자동 수집 스위치(화면) + collect 워크플로 예약 켬(Secrets 없으면 건너뜀)
- 🟡 사건 묶기 기준(겹침 0.5)은 가짜 기사로만 확인 — 실제 뉴스에서 너무 잘게/크게 묶이면 조정 필요

## 실행한 명령과 결과 (이 환경, 로컬 PostgreSQL 16)
- `npm run typecheck` → 오류 0
- `npm test` → 9개 파일, 83개 테스트 통과 (날짜·URL·SSRF·키워드·카드·캡션·게시판·대비·API/워커 통합·비밀값 저장·템플릿/CSV/일괄처리/Canva 가짜 응답)
- `npm run build` → 화면 354KB(gzip 105KB), 서버 번들 생성, `node dist/server/index.js`로 /api/health·SPA 경로 확인
- Playwright로 1440/390/320px 화면 확인: 콘솔 오류 0, 가로 넘침 0 (로컬 테스트 자료로 확인, 저장소에는 포함 안 함)
- 색 대비: 본문·보조·강조·경고·오류 모두 WCAG AA 4.5:1 이상(테스트로 고정)
- 사용량: 이 환경의 개발 작업 외에 외부 유료 API(네이버·Claude·Cloudinary 등) 호출 0회

## 필요한 변수 이름
`APP_ENV, APP_BASE_URL, APP_DATABASE_URL, APP_SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_REVIEW_CHAT_ID, CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, APP_SECRETS_KEY(선택), INSTAGRAM_API_VERSION, IG_<채널>_ACCESS_TOKEN, IG_<채널>_USER_ID, TG_<채널>_CHAT_ID, DEMO_MODE, DRY_RUN, AUTO_COLLECT, AUTO_GENERATE, AUTO_PUBLISH`

## 다음 작업 (우선순위)
1. Neon·Render 배포 → 로그인·채널·키워드 저장이 새로고침/재시작 후 유지되는지 운영 환경에서 확인
2. GitHub Secrets 등록 → collect 수동 실행 → 네이버 실제 결과로 수집·원문 확보 확인(예산 내 최대 10건 대조)
3. Claude 키·모델 → 공고 10건 추출값을 원문과 대조, 과학·시사 각 1건 수동 생성·검토
4. 대표 학교 공식 게시판 1곳: 도메인 확인 → 선택자 입력 → 시험 읽기 → 2~3곳으로 확장
5. 텔레그램 검토 알림 → 공개 채널 DRY_RUN → 지정한 1건 실게시 검증 → 인스타그램 동일
6. (Canva 사용 시) 개발자 앱 등록 → 연결 → 브랜드 템플릿 1개로 자동 채우기·가져오기 확인
7. 자동 실행(schedule) 켜기 — Actions 무료 한도(월 2,000분) 고려

## 중단 후 이어서 할 때
이 파일과 실제 코드·`git log`를 먼저 대조하고, 완료한 기능을 다시 만들지 말 것. 샘플 성공과 외부 API 실제 성공을 구분하고, 실게시·자동 스케줄은 꺼 둔 상태로 유지.

