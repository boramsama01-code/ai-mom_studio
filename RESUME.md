# 우주펭귄상회 작업 재개 체크포인트

갱신: 2026-10-22 (KST). 긴 대화 전체 대신 이 문서와 GitHub·Render의 현재 상태부터 대조합니다.

## 최신 상태 · 채널 순서와 AI 선택 (2026-10-22)
- PR #7 병합. 운영 커밋 `03be30a9006cedf3c0ec99d9c90ff2de933d7573`, Render `dep-dbcsf4u1egvs73f347tg` 17:22 KST live.
- 내 채널 → 순서 변경 → 드래그 또는 위/아래 버튼 → 순서 저장. 모든 채널 선택 목록과 제작 보드에 같은 순서 적용. 기존 순서는 배포 시 변경하지 않습니다.
- 순서는 app_settings의 channel_display_order 배열에 별도 저장합니다. 전체 ID 검증, 이전 순서 대조, 트랜잭션 잠금, 감사 로그로 누락·중복·동시 덮어쓰기를 막고 새 채널은 마지막에 붙입니다.
- AI_PROVIDER는 키가 아닌 auto/openai/anthropic 선택 항목. 선택란·실제 적용 AI·키 등록 여부·각 키 입력 위치를 명확히 표시합니다. 서버 환경변수가 있으면 우선권을 그대로 유지합니다.
- 운영 확인 시 AI_PROVIDER는 화면 저장 openai, 실제 선택 GPT, GPT용 키 미등록 상태였습니다. 키·선택값·환경변수는 이번 작업에서 변경하지 않았습니다.
- CI `39746894912`, job `119717496488`: 18개 파일 / 129개 테스트, 타입 검사·빌드 통과. 운영 새 JS `index-BYDtPvXY.js`와 신규 문구 확인. 채널 ID 순서와 카드 7개 데이터 해시가 배포 전후 동일.
- 카드뉴스 참고 이미지 확인: Canva Studio Shodwe의 White Black and Orange Plain Professional Informational Tips 표지, Dribbble Supergut 음식 캐러셀, Behance Culturiety 매거진. Mobbin 유료 제한을 재시도하지 않았고, 샘플은 참고용이며 앱 템플릿으로 설치하지 않았습니다.
- 참고 링크: https://www.canva.com/instagram-posts/templates/carousel/?continuation=550 · https://dribbble.com/shots/25538378-Instagram-Carousel-Design-for-Supergut · https://www.behance.net/gallery/233512919/Culturiety
- 운영 검증 `.git/channel-order-before.json`, `.git/channel-order-after.json`. 브라우저 로그인 후 시각 검증은 미완료입니다.

## 이전 기록 · 채널 관리와 설정 UX (2026-10-22)
- PR #6 병합, 운영 커밋 `224909cab8a541d71fab93cb7d3e1fbe070abbc7`, Render `dep-dbcr7n61egvs73f1qjb0` 15:58 KST live.
- 설정 첫 화면에 채널 목록·추가·수정 기능. 내 채널 / 서비스 연결 / 운영 설정으로 분리하고 비용·게시 계정 진단은 접어서 표시합니다.
- Studio와 수집 화면은 같은 DB 채널명 사용. 기존 `highway`→`opportunities`, `news`→`current-dialogue` 식별자 연결 유지. 펭귄상회·Fryday를 기존 채널과 함께 관리하며, 기존 과학·시사 이름을 임의 변경하지 않았습니다.
- 새 채널은 자동 수집·게시 예산 0, 화제 발굴 꺼짐으로 생성합니다. 기존 개인 전용 링크·인증·CSRF 유지.
- CI `39736954934`, job `119684782414`: 18개 파일 / 127개 테스트, 타입 검사·빌드 모두 통과. 최초 CI의 시사 채널 alias 호환성 실패를 수정 후 재검증했습니다.
- 운영 HTTP 검증: 채널 5개, 카드 7개, 새 JS `index-DdcPbute.js` 제공 확인. 카드 전체 데이터 해시가 배포 전후 동일. health 200, 비로그인 채널 API 401. 운영 업무 데이터 직접 변경과 유료 AI 실행은 하지 않았습니다.
- Mobbin 화면·흐름 검색은 모두 paid-plan-required로 차단됨. 실제 샘플 이미지는 보지 못했고 이를 사용자에게 알렸습니다. 브라우저는 로그인 상태가 아니어서 개편 화면의 시각 검증은 미완료입니다.
- 실행 체크포인트 `.git/channel-ux-task.json`, 전후 검증 `.git/channel-ux-before.json`, `.git/channel-ux-after.json`.

## 이전 기록 · 개인 전용 링크
- 사용자 요청에 따라 아이디·비밀번호 입력 없이 전용 링크로 접속하는 기능을 배포했습니다. 일반 주소만으로 운영 데이터가 공개되지는 않습니다.
- PR #5: https://github.com/boramsama01-code/ai-mom_studio/pull/5
- 운영 코드 커밋: `4c2bbaf99ec386939e1cd4eeef61c0b5ce3abbd6`, Render 배포 `dep-dbcnl8jm8hqs73ah6rug` (2026-10-22 11:56 KST live).
- CI `39713040636`, job `119608608914`: PostgreSQL 16에서 17개 파일·125개 테스트, 타입 검사, 빌드 통과.
- 실제 운영 확인: 전용 링크 교환 200 → 운영자 세션·Studio 카드 7개 조회 200. 잘못된 링크 401, 비로그인 조회 401, 로그아웃 후 조회 401. 업무 데이터 변경·유료 생성은 하지 않았습니다.
- 운영 쿠키의 Secure·HttpOnly·SameSite=Lax와 30일 유지 확인. 원본 토큰은 URL fragment에서 읽고 요청 전에 주소창에서 지우며 브라우저 저장소에는 남기지 않습니다.
- 기존 Render 환경변수를 보존하고 `APP_PRIVATE_LINK_SHA256` 하나만 추가했습니다. 원본 토큰과 전용 링크를 GitHub 코드·문서·로그에 넣지 않습니다. 링크는 사용자에게만 전달합니다.
- 검증값 교체·제거 후 재배포하면 이전 링크와 해당 링크로 만든 세션이 무효화됩니다. 기존 비밀번호 로그인은 복구용으로 유지합니다.
- 서버에서 기존 연결 키 7개 로드 및 정상 기동 확인. 실행 기록은 `.git/private-link-task.json`, 운영 검증 결과는 `.git/private-link-verification.json`에 있습니다.

## Studio 통합 기록
- 사용자가 준비한 코드·캐릭터·웹툰 예시 원본의 비공개 저장소 업로드 및 DB 테스트 통과 후 기존 Render 배포를 명시적으로 승인했습니다. 과거 자동 승인 거부는 이후 해소됐습니다.
- PR #4 병합 완료: https://github.com/boramsama01-code/ai-mom_studio/pull/4
- 검증한 PR 커밋: `a5b98e484e8655ccdb499e016f85a35c3e6f599d`.
- 운영 통합 커밋: `03a5f19340d110a6978f09a611ce262d119fd251`.
- CI `39711407602` / job `119603393382`: PostgreSQL 16에서 15개 파일·120개 테스트, 타입 검사, 프로덕션 빌드 모두 성공. 병합 후 main CI `39711566570`도 성공했습니다.
- 첫 CI 설치 지연으로 같은 코드로 한 번 재실행했습니다. 두 실행의 테스트는 모두 통과했고, 재실행 CI는 전체 success입니다.
- Render 배포 `dep-dbcn9jmk1f9s73arn9p0`가 2026-10-22 11:32 KST에 live로 완료됐고, 운영 HTTP·브라우저 검증도 통과했습니다.

## 대상
- GitHub: `boramsama01-code/ai-mom_studio` (비공개)
- 운영 주소: https://ai-mom-studio.onrender.com/
- Render 서비스: `srv-dat0vbg473hc73e9l5r0`, 워크스페이스: `tea-d90sffurnols73f0jiog` (My Workspace)
- 병합한 브랜치: `codex/studio-render-integration-20261022`
- 통합 전 운영: 커밋 `6ecedb8c4a29b9b36c626a03b25cef7cc1dbbd6f`, 배포 `dep-dbacgtm1egvs73dhj5v0`.

## 구현·보존한 기능
- 첫 화면에 5단계 Studio Board, 펭귄상회·Highway·Fryday·시사 4개 채널, 검색·메모·백업 가져오기.
- GPT/Claude 원고 생성·수정, 선택한 한 컷 생성, 네컷 PNG, 버전 비교·복원, 생성 중 직접 편집 보존.
- 요청 UUID 중복 방지, 유료 호출 자동 재시도 금지, 전역 정지.
- 기존 Highway 수집·제작과 기존 로그인·PostgreSQL 운영 데이터·암호화 키 유지. 추가 DB 마이그레이션만 적용.
- 기존 Sites 기본 기획 7개·메모, 참고 공고 7개를 중복 없이 이전. 참고 공고는 샘플·재검토 대상.
- 기존 웹폰트 등 비변경 파일 보존과 변경 파일 73개의 원격 Git blob 해시 일치 확인.
- 캐릭터 4개 원본과 웹툰 예시 원본 유지. 예시 PNG는 19개 조각을 빌드 시 바이트 그대로 복원하고 해시 검증.
- 예시 PNG: 1,780,026 bytes, SHA-256 `4ee47517e8b4699e313d66e07320779c71d0aee7051064a1f06cc60dc9e9b459`. CI에서도 복원 검증 통과.

## 검증 범위·남은 확인
- 로컬 타입 검사·빌드·선별 단위 테스트 15개, GitHub 전체 DB 통합 테스트 120개 통과.
- 실제 유료 AI 생성·SNS 게시·이메일 전송은 실행하지 않았습니다. 외부 API 흐름은 모의 응답으로 검증했습니다.
- 운영자 로그인 화면 표시 확인. 로그인한 운영 계정으로 실제 저장·생성·다운로드는 확인하지 않았습니다.
- ChatGPT 연결 앱 권한이 Render 서버의 상시 API 자격증명으로 자동 이전되지는 않습니다.
- 운영 확인: `/api/health` 200·DB connected·auth configured, `/api/auth/me` 비로그인·demo 불가, `/api/studio/cards` 비로그인 401.
- 배포한 JS `index-DFzaZ-Tn.js`와 CSS `index-CY_7KcsV.css`, 기존 웹폰트가 모두 200으로 제공됩니다. 캐릭터 4개·예시 웹툰 1개의 운영 응답 바이트와 원본 SHA-256이 모두 일치합니다.
- 새 서버 시작 로그에서 저장된 연결 키 7개 로드와 정상 기동을 확인했습니다. 해당 키의 실제 외부 서비스 유효성은 검증하지 않았습니다.
- 브라우저 로그인 화면 정상 표시. 관찰한 콘솔 오류는 브라우저 확장 프로그램의 메타데이터 전송 오류이며 앱 자체 오류는 관찰되지 않았습니다.
- 이번 승인 범위의 통합·검증·배포 완료. 향후 유료 API 생성과 로그인 후 실제 운영 흐름 확인은 별도 실행 범위입니다.

## 재개 원칙
- 공개 전환·SNS 게시·이메일 전송·새 유료 서비스·자격증명 업로드는 승인 범위 밖입니다.
- 관련 없는 `nodeul_news` 프로젝트는 건드리지 않습니다.
- 전체 코드·로그·이미지 Base64를 대화에 반복 출력하지 않습니다. 필요한 구간과 결과만 확인합니다.
- `.git/studio-upload-state.json`에 파일별 해시와 CI·병합 진행 상태를 보관했습니다. 완료한 업로드나 유료 생성을 반복하지 않습니다.
