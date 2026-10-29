# 가계부 · Render

이 브랜치는 가계부의 독립 배포 소스입니다. 기존 스튜디오의 main 브랜치와 별도로 운영합니다.

## 기능

결제일·카테고리·항목·원화 금액, 교육비 현우·정우 구분, 기간 합계, 검색·필터, 지출 수정·삭제, CSV 내보내기, JPG·PNG·WebP·PDF 영수증 첨부·보기·다운로드를 지원합니다. 영수증은 지출당 최대 5개, 파일당 10MB, 총 20MB입니다.

## 실행

Node 24.22.1에서 `npm ci --include=dev`, `npm run build`, `npm start`를 실행합니다. `PORT`(기본 4173)와 `DATA_DIR`(로컬 기본 .data)를 사용합니다. Render에서는 DATA_DIR를 반드시 영구 디스크 마운트 경로로 지정합니다. Render 서비스의 일반 파일시스템에는 영수증이나 DB를 저장하지 않습니다.

## 계정

사이트 주소는 공개 접근이 가능하지만 지출·영수증 API는 로그인한 소유자만 접근할 수 있습니다. 첫 소유자 생성은 환경변수 `OWNER_SETUP_KEY`와 일치하는 비밀 키가 필요하며, 계정이 만들어지면 추가 가입을 닫습니다. 초기 설정 주소는 사이트 주소에 `/#setup=`과 URL 인코딩한 키를 붙입니다. 키는 URL fragment에서 읽은 직후 주소에서 지우고 서버 로그·저장소·브라우저 저장소에는 남기지 않습니다. 키나 비밀번호를 소스에 적지 마세요.

관리자 아이디는 영문·숫자·밑줄·마침표·하이픈 3~40자, 비밀번호는 12~128자입니다. 비밀번호와 세션 토큰은 해시로 저장하고, 운영 세션 쿠키는 Secure/HttpOnly/SameSite=Strict를 사용합니다.

## Render 배포 구성

render.yaml은 싱가포르의 단일 웹서비스(0.5 CPU, 512MB)와 1GB 영구디스크, /api/health 상태확인, 서버 재시작 후 보존되는 SQLite 및 영수증 폴더를 정의합니다. 소스 브랜치는 `woori-ledger-render`입니다. OWNER_SETUP_KEY는 Render가 최초 생성 시 안전하게 만듭니다.

2026-10-29 확인한 기본 예상비용은 웹서비스 월 $7 + 디스크 1GB 월 $0.25 = 월 $7.25이며, 세금·추가 사용량은 별도입니다. 현재 비용 발생 서비스의 생성은 사용자 확인 대기입니다. 공식 근거: https://render.com/docs/compute-plans, https://render.com/pricing, https://render.com/docs/disks.

## 검증

- `npm run check`: TypeScript
- `npm run build`: 프로덕션 정적 파일
- `npm test`: 임시 로컬 SQLite와 로컬 HTTP로 인증·범위합계·CRUD·PNG/PDF·파일검증·세션·CSRF·중복저장·서버재시작 보존 확인

테스트/미리보기 내역은 로컬에만 있습니다. .data, .env, node_modules, dist는 소스에 포함하지 않습니다. 실제 배포는 빈 DB에서 시작하며, 기존 Sites의 기록은 기존 Sites에 보존됩니다.

## 디자인 참고

https://www.monarch.com/features/tracking
https://lunchmoney.app/features/analytics/
https://www.copilot.money/

기간과 총액은 짧게, 내역과 입력은 가까이 배치합니다. 감성 문구·소개 문구·장식용 푸터를 사용하지 않습니다.
