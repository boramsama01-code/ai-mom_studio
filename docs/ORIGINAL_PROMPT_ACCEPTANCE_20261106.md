# 원본 요구사항 수용 기록 · 2026-11-06

작성 기준: 한국 시간 13:03. 이 문서는 완료 선언이 아니라, 원본 1–13항 및 13A–G를 검증 증거와 남은 확인에 연결하는 수용 기록이다. 수정 코드는 실제 파일, 로컬 검사, 불변 CI, 운영 반영, 외부 서비스 성공을 각각 구분한다.

원본: 사용자가 첨부한 `붙여넣은 텍스트.txt`의 1–13항 및 13A–G. 프로젝트 목적, 업무 흐름, 운영 보존, 기능 검증과 별도 비주얼 기준을 함께 적용한다.

## 기준 버전과 증거

- 검증한 PR #73 코드: `ac95665a4ed1a9fad296eb01d13b8246bcdf4c30`. [CI #259](https://github.com/boramsama01-code/ai-mom_studio/actions/runs/42149151773)는 test·memory·browser 모두 성공했다. job 로그에서 210파일/2,156테스트, 타입 검사·빌드 성공과 Node 22.23.4 RSS 434.27MiB를 직접 대조했다. 메모리 기준은 448MiB이며 worker thread를 포함한다.
- 이 CI에는 이후 로컬의 목록 복귀 상태, 실제 프로세스 강제 종료 검사, 추가 뷰포트, Canva 기능 제한 문구 수정이 포함되지 않는다. 해당 묶음은 별도의 최신 CI가 필요하다.
- 첫 통합 배치 `ecd71ad8464a67fd524b71c835d4ab5b72fd6a60`가 PR73에 반영됐고 CI가 시작됐다. 새 수동 Canva 가져오기 배치는 그 이후 변경으로 별도 최종 불변 CI가 필요하며, 시작만으로 성공을 기록하지 않는다.
- 두 번째 통합 배치 `6f3947f`의 [CI #262](https://github.com/boramsama01-code/ai-mom_studio/actions/runs/42156581689) test는214파일/2,213테스트·타입·빌드 성공, memory는 Node22.23.4·7요청·408.95MiB≤448 성공으로 직접 job 로그를 대조했다. browser는30분 제한으로 설치 단계에서 cancelled됐고 브라우저 assertion은 실행되지 않았다. 완료 job 메타데이터로 확인했으며 전체 성공으로 계산하지 않는다. 다음 CI에서 공식 mirror 포인터 수정·설치 시간 제한을 다시 검증한다. 이후 네이버 안내·자동완성 구분과 수동8장 최초 작성은 세 번째 로컬 배치이므로 다시 최종 CI가 필요하다.
- 운영 `spacepenguin`: 승인된 PR #75 배포 `dep-dbmjnhcs728c73999ma0`, `b3aca65db77c94d015f612a1906f67ff8c985a58`, 11:32:36 live. 별도 GET `/api/health`에서 같은 SHA·DB connected·auth configured를 확인했다. 시작 명령은 `npm start`; 이 운영 버전은 PR #73의 새 작업 공간과 메모리 시작 설정을 포함하지 않는다.
- `work/pr75-deployment-verification.json`: PR #75 실제 운영 증거. `work/canva-source-audit.json`: Canva 연결 도구로 실제 원본 14종/8장/46개 텍스트 필드를 읽은 증거. 원본 디자인과 라이브 앱 OAuth 증거를 혼동하지 않는다.
- 11:49 운영 DB의 명시적 READ ONLY 거래: Canva 폴더 인증 성공·ready·failures=0, 원본 14종, 미리보기 작업 14개 complete, 캐시 112페이지(540×675), 미리보기 오류 0. 실제 앱의 자동 채우기 기능은 false이며 별도 제한으로 남긴다.
- 사용자가 승인한 실제 QA 즉시 게시 1건이 12:00:01에 완료됐다. `studio34 → content17453 → approval7 → delivery2`가 `succeeded/finished`, `provider_verified`, attempts=1, 오류·미확정 없음으로 확인됐다. 계정은 `@spacepenguin.co`, [실제 새 게시물](https://www.instagram.com/p/DfYlxqIE-4p/)이다. 과거 ALLligodang 게시물을 이번 검증 성과로 계산하지 않는다. 예약 취소/재예약의 새 실제 전송은 아직 완료하지 않았다.
- 같은 QA 콘텐츠의 새 승인8을 13:30으로 예약한 뒤 12:08:07에 취소했다. delivery3은 cancelled/finished, attempts=0, append-only 전송 시도0개, request/dispatch 시작 시각·외부 ID/URL 없음이었다. 이는 예정 전 취소가 DB에서 확정되고 provider dispatch 기록이 없음을 입증한다. 이전 성공 승인7/delivery2는 그대로 보존됐다. 재예약 후 실제 전송은 아직 남아 있다.
- 추가 모바일 목록 수용 범위: Inbox/Publish 행·전체 선택의 모바일 레이블 hit area를 48×48로 넓히고 실제 체크박스 크기·PC 밀도를 유지하는 수정이 로컬에 있다. Node22 빌드, 4 UI 파일/38테스트가 통과했다. 실제 Chrome 브라우저의 레이블 여백 터치·정확한 토글·이동 방지·PC 높이·목록 복귀도 393/1280/320/430/768px에서 통과했다. 새 불변 WebKit CI 통과로 계산하지 않는다.
- 원고 자동 채우기가 없는 계정의 콘텐츠용 Canva 복제본을 8장 결과로 가져오는 명시적 수동 경로가 로컬에 구현됐다. 새 PostgreSQL 27검사와 타입 검사가 통과했다. 관련 6파일/147테스트, 전체 Canva17파일/346테스트도 앞선 상태에서 통과했으며 이후 추가된 마지막 계정 재확인 guard와 회귀1개는 새27개 검사로 다시 확인했다. 수동 UI13개+기존 편집UI40개=53테스트가 통과했고, 실제 Chrome320/393/1280px에서 전체 기존 뉴스 흐름+기능 제한 계정의 수동 가져오기·8장 대조 시나리오가 통과했다. 이 브라우저는 합성 공급자 응답과 실제 프로덕션 렌더러 자산을 사용한다. 독립 코드 검토에서 차단 결함을 찾지 않았다. 실제 앱의 새 수동 내보내기/채택·최종 CI·배포는 아직 남아 있다.
- 네이버의 현재 연결은 정상이다. 정상 UI의 최소 검색 검사와 READ ONLY DB를 대조해 12:33:55.999에 NAVER API HUB 검색 결과1건 성공을 확인했다. 저장 키의 변경 시각은10:40:06으로 그대로다. 채널3의10:02 실행88의401은 키 교체 전 기록이며, 교체 후 채널1 실제 실행89는 네이버24회·실패0·규칙24개 성공이었다. 이 사실이 채널3의 새 수집 완료를 뜻하지는 않는다.
- 실제 Canva 폴더 신규/수정 동기화는 QA 복사본만 써서12:38–12:43에 확인했다. 새 디자인 발견→8장 캐시→Canva에서 표지 문구 수정→새 metadata/export/캐시→폴더 밖으로 복귀 순서다. 표지 SHA가 바뀌었고 원본의 제목/버전/8장은 보존됐다. 마지막 폴더14종은 모두8장·미리보기 ready, QA는 missing 보관 상태이며 새8장 캐시를 유지한다. 실제 증거는 `work/canva-folder-change-verification.json`이다.
- 사용자 명시 승인을 받은 Gemini 텍스트 QA는 studio35/job32에서12:53:49 성공했다. 요청1건·기록된 시도1·적용된revision68/v3, 원고444자·캡션175자·4컷 저장과 이전 제목/메모/채널 보존, 현재 내용=revision68을 READ ONLY로 확인했다. 이미지0개다. 당시 generic Studio가 token/provider request ID를 영속화하지 않아 실제 토큰은 unknown이며, 기록된모델gemini-2.5-flash의 actual 응답 여부도 별도 provenance가 없다. `work/gemini-text-qa-verification.json`에 이 경계를 남겼다.

## 운영 검증의 불변 체크포인트

| 확인 시각(KST) | 대상 | 실제 결과 | 범위 |
| --- | --- | --- | --- |
| 11:32:36 | Render `dep-dbmjnhcs728c73999ma0` | `b3aca65db77c94d015f612a1906f67ff8c985a58` live | PR75 진단 수정만 운영 반영. PR73 작업 공간은 미배포. |
| 11:33 | 운영 `/api/health` | 위 SHA, ok=true, DB connected, auth configured | 별도 HTTP GET으로 배포 메타데이터와 대조. |
| 11:45:57 | 실제 앱 Canva 폴더 상태 | authenticated=true, ready, failures=0, autofill=false | 사용자가 활성 Client secret을 수정한 뒤 실제 OAuth·폴더 조회 성공. 토큰은 출력·기록하지 않음. |
| 11:49 | 실제 앱 Canva 미리보기 | 원본 14종, 작업 14개 complete, 112 캐시 페이지, 540×675, 오류 코드 없음 | 명시적 READ ONLY 운영 DB 조회. Autofill·콘텐츠 채택·게시 성공과 별개. |
| 11:52 | 운영 메모리·오류 | 약216MiB/512MiB, 해당 시간대 오류 로그 없음 | 기존 운영 빌드의 실제 폴더 미리보기 처리 후 관측. PR73의 오프라인 메모리 시험과 별개. |
| 11:57 | 임시 기동 유지 상태 확인 | health 정상, b3aca65, DB connected | 사용자 요청에 따른 5분 간격 HTTP 확인. 최대2시간 임시 실행이며 상시 스케줄러로 소개하지 않음. |
| 12:00:01 | 실제 QA 즉시 게시 | `@spacepenguin.co`, delivery2, provider_verified, 전송1회 | [새 permalink](https://www.instagram.com/p/DfYlxqIE-4p/). 승인된 QA 콘텐츠만 전송. DB 읽기 확인 시 오류·미확정 없음. |
| 12:08:07 | 실제 QA 예약 취소 | approval8/delivery3 cancelled, 시도0개, dispatch 시작 없음 | 13:30 KST 예약을 정상 UI에서 취소. 이전 성공 기록과 외부 게시물은 보존. 재예약 실제 전송은 별도 대기. |
| 12:33:55.999 | 네이버 정상 UI 연결 검사 | NAVER API HUB 검색 결과1건, ok=true | 키 저장 없이 현재 저장 키로 수행. 운영 DB의 안전한 결과 메타데이터와 대조. 글 생성·SNS·대량 수집을 실행하지 않음. |
| 12:38:17 → 12:42:22 | Canva 폴더 신규·수정 QA | 복사본의 버전1793936251→1793936409, preview job15→16 complete, 표지 SHA8a134618…→204c3042… | 두 결과 모두8장540×675. 정상 Canva 표지 수정과 실제 운영 캐시 변화 대조. 원본 DAHZ9UpAYzo의1793857066/제목/8장은 그대로. |
| 12:43:31 | Canva QA 폴더 정리 | 원본14종 모두8장/ready, QA는 missing·이전 결과 보존 | QA 복사본만 폴더 밖으로 이동. 최신 QA8장 캐시는 남고 사용자 원본은 삭제·이동하지 않음. |
| 12:45:52 → 12:49:11 | 실제 QA 기록 보관·휴지통·복원 | 채널106의 delivery2/3만 archived→trashed→active, 최종 listVersion4 | 감사390–395, 외부 게시 변경false. 이전 성공 permalink/attempts1과 취소/attempts0 유지; asset57/58의 실제 바이트=저장=승인 SHA. |
| 12:46 | Canva QA 처리 후 운영 관측 | Render 메모리약205MiB,12:37–12:46 error 로그0 | 기존 운영 b3aca65에서의 실제 폴더 내보내기 뒤 상태. PR73 CI 메모리 시험과 구분. |
| 12:53:49 | 실제 Gemini 텍스트 QA | studio35/job32 succeeded·attempts1/max1·revision68 applied, 카드v3 | 원고/캡션/4컷 저장·현재값=저장revision, 제목/메모/채널 보존, 이미지0. 토큰/provider응답ID는 당시 영속 기록이 없어unknown. |

## 1–13항

| 항목 | 구현·현재 확인된 증거 | 남은 수용 확인 / 제한 |
| --- | --- | --- |
| **1. 목적·운영 환경·다양한 시작 경로** | React/Vite/TypeScript/TanStack Query/Wouter, Express/Drizzle/PostgreSQL와 기존 Render 서비스를 유지한다. `shared/creativeProfile.ts`, `CreativeProfileFields.tsx`, `QuickCapture.tsx`, `pages/Studio.tsx`, `pages/VideoEditor.tsx`에 직접 작성·원문·사진/영상·완성 이미지 경로가 있다. 실제 채널은 고정 4개가 아니라 DB의 활성 5개와 보관 채널을 따른다. 독립 모바일/PC 컨텍스트가 같은 콘텐츠 ID를 저장·재접속하는 합성 API 브라우저 시나리오가 CI #259에서 통과했다. | PR #73은 아직 운영 미배포다. 실제 모바일·PC 기기 두 대에서의 운영 이어쓰기와 실제 영상 게시 성공을 주장하지 않는다. 영상은 구성·보관·SRT와 외부 편집 경로를 지원한다. 새 유료 인프라를 만들지 않았다. |
| **2. 수정 전 조사와 우선순위** | `docs/CREATIVE_WORKSPACE_20261106.md`에 기준 SHA·Render·데이터·문제/재현/영향/원인/개선/검증을 남겼다. 재개 시 실제 최신 PR·CI·운영 SHA를 다시 읽었다. 중복 생성, URL 중복, 저장 충돌·응답 유실, 발행 결과 미확정을 우선 검증한다. | 과거 문서의 완료 문구는 현행 성공 증거가 아니다. 11:49 이후 변경·외부 테스트는 최종 기록에 추가해야 한다. |
| **3. 채널의 데이터화와 독립 설정** | `shared/schema.ts`, `shared/creativeProfile.ts`, `pages/ChannelSettings.tsx`, `CreativeProfileFields.tsx` 및 기존 AI·수집·계정 설정을 재사용한다. 허용 형식/시작 경로/기본 디자인/등록 로고·색/서체 가이드/말투/자산 가이드를 채널 버전과 함께 저장한다. `creative-workspace-postgres`, `dynamic-channels-postgres`, `channel-ai-settings-postgres` 등 실제 PostgreSQL 검사와 채널 생성·보관 브라우저 검사가 있다. 계정과 목적지는 별도 모델이다. | 채널 서체는 외부 편집·AI 지시 가이드이며 기존 템플릿 서체를 강제로 바꾸지 않는다. 기존 브랜드 호환 기본값의 조건은 경계에 남아 있다. 새 채널의 실제 계정 연결·예약까지 한 번에 운영 검증한 상태는 아니다. |
| **4. 업무 중심 화면·위치 보존** | 콘텐츠 썸네일·최근 이어하기·검토 대상을 중심으로 내 콘텐츠, 수집함, 자산, 발행함, 설정을 연결한다. Studio 목록은 사용자/채널별 상태를 보존하며 미저장 이동은 공통 guard를 사용한다. `pages/Studio.tsx`, `pages/Assets.tsx`, `StudioWorkingPreview.tsx`, `state.tsx`가 주요 위치다. | 추가 Inbox/Publish 검색·필터·페이지·스크롤 복귀는 새 로컬 변경이다. 목록 복귀/레이블 UI 9테스트와 기존 29테스트·타입 검사, 393/1280/320/430/768px 실제 브라우저 Back/스크롤이 로컬 통과했으며 새 불변 CI에 포함해야 한다. |
| **5. 모바일·PC별 설계** | PC 원고/선택 컷 미리보기, 모바일 접이식 미리보기·단일 하단 조작, 48px 주요 버튼·16px 입력, safe-area·visualViewport 키보드 감지·사용자 동작 클립보드/거부 시 직접 입력이 구현됐다. CI #259: 360/393/430/768/1440px 제작 흐름과 기존 모바일 회귀. 새 로컬 Chrome: 320/360/393/430/768/1440px, 852×393 가로, 393×480 짧은 편집 뷰포트. Inbox/Publish 선택 레이블의 48×48 여백을 실제로 눌러 체크·이동 방지와 PC 밀도 보존을 추가 확인했다. | 짧은 뷰포트는 실제 iOS/Android 소프트 키보드 검증이 아니다. 검사한 두 목록의 레이블을 모든 서비스의 모든 터치 타깃으로 확대해 주장하지 않는다. 새 목록 변경은 불변 WebKit CI가 필요하다. |
| **6. 일관된 디자인·접근성·상태** | `creativeWorkspace.css`가 중성 배경/청록 포인트/상태색·공통 간격·제목·모서리·포커스·160ms 모션을 적용한다. `icons.tsx`, `ui.tsx`, `SaveState.tsx`, `BrandAssetPreview.tsx`, `RecoveryNotice.tsx`를 재사용한다. 실제 로고 3종과 템플릿 14종의 로딩·비율·선택 상태와 오류/빈 화면 캡처를 CI에서 확인했다. | 모든 화면에 대해 자동 대비 점수·스크린리더·물리 기기 키보드를 전수 확인한 것은 아니다. 운영에 새 화면이 반영되었다고 보고하지 않는다. 최종 묶음의 전체 주요 화면 시각 검토가 남는다. |
| **7. 서버 저장·충돌·기기 복구** | 서버 버전/CAS, 사용자·채널·콘텐츠 범위의 복구 저장소, focus/reconnect 최신 조회, 미저장 이동 guard, 저장 중/완료/실패/기기 보관·결과 미확인을 구분한다. `draftRecovery.ts`, `useDraftRecovery.ts`, `SaveState.tsx`, `api.ts`, DB revision/receipt 모델 및 관련 테스트가 증거다. 동시 생성/응답 유실/변경 body409/오래된 저장409/다른 채널 보존을 실제 PostgreSQL에서 검사한다. | 합성 API의 독립 브라우저 컨텍스트와 PostgreSQL 계약 검사는 실제 두 사용자 기기의 운영 장애 재현과 구분한다. 새 API body-read/cancellation 변경 이후 전체 묶음 CI를 유지한다. 자동 저장을 모든 편집기에 강요하지 않는다. |
| **8. 수집·원고·이미지·영상·자산 연결** | URL/직접 입력/사진·영상/완성 이미지 출발점, URL 채널별 중복 방지·기확보 본문 보존·본문 상태 구분, 작업별 AI/원고 직접 편집·선택 컷/페이지 재생성·버전/결과 추적이 있다. `sourceWorkspace.ts`, `QuickCapture.tsx`, `StudioWorkingPreview.tsx`, `pages/VideoEditor.tsx`, `shared/videoProject.ts`, `pages/Assets.tsx` 및 기존 source/AI/recovery 테스트가 연결된다. 영상 장면·길이·대본·자막·오디오·비율·표지·완성 파일 선택·SRT는 실제 코드/DB/브라우저 검사 대상이다. | 사진은 1600px 이하 메타데이터 제거 JPEG 편집본이고 영상은 원본 바이트다. 사진 원본 보존·영상 합성/인코딩/SNS 영상 전송은 제공하지 않으며 화면에서 외부 작업으로 안내한다. 승인된 실제 Gemini 텍스트1작업은 저장·재조회까지 확인했다. AI 이미지 생성과 외부 영상 결과는 이번 테스트로 확인하지 않았다. |
| **9. 실제 Canva 기능에 근거한 연결** | 운영 앱의 잘못된 Client secret을 사용자가 수정한 뒤 정상 OAuth와 실제 폴더 동기화 성공을 확인했다. 14종/112페이지 캐시가 실제 운영 DB에 준비됐다. 원고/원본/편집 링크/복귀/수동 가져오기를 구분하고 미저장 입력·기존 미리보기를 보존한다. `ExternalDesignLink.tsx`, `CanvaTemplateLibrary.tsx`, `canvaRest.ts`, `canvaTemplateLibrary.ts`와 테스트가 근거다. | 실제 연결의 autofill=false다. 연결 도구의 46개 필드 확인은 운영 앱 자동 채우기 성공이 아니다. 콘텐츠용 복제→실제 autofill→내보내기→가져오기 E2E는 제한 상태다. 새 로컬 UI는 기능 제한을 필드 누락과 구분하며 19테스트·타입 검사 통과, 새 CI 필요. 실제 폴더 신규/수정→미리보기 갱신→폴더 밖 복귀는 QA 복사본으로 성공했다. 새 콘텐츠의 실제 수동 내보내기·문구 대조·채택은 별도 운영 확인이 남는다. |
| **10. 영속 작업·발행 신뢰성** | PostgreSQL jobs/lease/requestId/승인 버전·목적지 스냅샷/append-only attempt·event/unknown reconciliation이 기존 구현에 있다. 즉시·예약·KST·취소·개별 실패·미확정/중복 차단·기록 보관/복원은 관련 DB/UI 테스트로 검사한다. 새 로컬 Node22+PostgreSQL16.15 47파일/733테스트가 통과했고, 실제 SIGKILL 2검사에서 dispatch 전 1회 재개와 dispatch 후 unknown/맹목 재시도 금지를 확인했다. 실제 QA 즉시 게시 1건은 위 새 permalink와 provider_verified·1회 전송으로 확인했다. | 격리된 테스트의 공급자는 합성 응답이다. 승인된 예약 취소/재예약 실제 게시 검증이 남는다. 기존 과거 글을 승인하거나 전역 중단을 무심코 해제하면 안 된다. 영상 전송과 외부 Instagram 삭제를 지원한다고 주장하지 않는다. |
| **11. Render·로딩·메모리·예약 제약** | 무료 512MiB, 단일 웹/inline worker·기존 매시17분 복구 워크플로를 확인했다. 자산·원고·작업 상태는 PostgreSQL이며 임시 Render 파일만 의존하지 않는다. 서버 연결 대기/다운로드/조회/장시간 작업을 구분하고 구조형 skeleton·복구를 제공한다. CI #259의 7요청/동시2 이미지 작업 RSS434.27MiB≤448, 해상도/품질/해시 일치 검사를 통과했다. | 운영 b3aca65의 `npm start`는 확인했으나 PR73의 allocator/Sharp 수정은 미배포다. 새 최종 묶음의 같은 예산 검사와 배포 후 actual health/메모리 확인이 필요하다. 과거529.96MiB와 process 실험586.70MiB는 실패 기록으로 보존한다. 초기 script transfer 증가가 있으므로 전체 다운로드/Render cold-start 속도 개선을 주장하지 않는다. 정확한 분 단위 예약은 무료 유휴 중지·GitHub 지연 때문에 보장하지 않는다. |
| **12. 구현·검증·커밋·보고 기준** | 실제 저장소 파일/feature PR73/불변 CI/실행 캡처/작업 재개 기록이 존재한다. 기존 PR22·운영 데이터·동시 진행 커밋을 보존한다. PR75만 별도 승인 후 운영 배포했고 SHA를 검증했다. 원본의 핵심 시나리오에 DB와 브라우저 증거를 매핑한다. | 새 로컬 수정은 아직 최종 불변 커밋/통합 CI가 필요하다. PR73 운영 배포 승인과 실제 기능 확인, 외부 제한을 포함한 최종 보고가 남는다. 코드 작성·검사 통과·운영 배포·외부 성공을 하나의 완료로 합치지 않는다. |
| **13. 기능과 별도의 비주얼 수용** | A/B 실제 React 렌더링, 동일 콘텐츠 개선 전후·PC/모바일 비교, 템플릿과 브랜드 원본의 실제 비율·선택·오류 상태를 캡처했다. A는 따뜻한 중성 작업대·청록 조작·26px 제목·24px 갤러리 간격, B는 짙은 탐색 영역·22px 제목·12px 간격·높은 밀도로 비교했다. | 아래 A–G 기준별 증거와 남은 검토를 별도로 따른다. 브라우저 assertion 통과만으로 전체 디자인의 사용자 수용을 단정하지 않는다. |

## 13A–G 비주얼 수용

| 항목 | 실제 구현·증거 | 남은 확인 |
| --- | --- | --- |
| **13A. 구체적 아트디렉션** | `creativeWorkspace.css`: `#f5f5f1` 배경, `#232c2a` 본문, `#17665b` 주요 행동, 성공/경고/오류 분리; 26px 제목, 18px 소제목, 한글 줄바꿈, 4/8/12/16/24/32 간격, 12px 패널·8px 버튼 모서리, 약한 그림자·160ms 모션. 브랜드는 승인 로고·원본 썸네일로 표현한다. | 기존 세부 화면의 CSS 우선순위와 긴 한국어/상태별 최종 렌더링을 새 묶음에서 다시 확인한다. |
| **13B. 실제 레퍼런스와 두 방향 비교** | 기록에 Buffer Create/Ideas와 Canva 공식 API/UX 근거, Mobbin 유료 접근 제한을 명시했다. 실제 동일 콘텐츠의 A/B를 렌더링했으며 A를 한글 원고·컬러 원본 판단에 유리한 넓은 작업대로 선택했다. `scripts/creative-workspace-regression.mjs`, `creative-workspace-review.mjs`가 재현 경로다. | 보지 못한 Mobbin 화면을 참고 증거로 넣지 않는다. 새 화면까지 A의 언어가 이어졌는지 전체 주요 화면 최종 검수가 필요하다. |
| **13C. 화면별 중심·선택 일치** | 최근 작업/검토 썸네일 중심의 홈, PC 원고+선택 컷 미리보기, 모바일 우선순위 재배치, 원래 비율의 템플릿·브랜드/캐릭터 자산 갤러리를 구현했다. `StudioWorkingPreview.tsx`와 UI 테스트는 선택 컷·대사·미리보기 일치를 확인한다. | 발행 일정·설정·수집함을 포함한 전체 화면 시각 중심은 추가 확인 중이다. 실제 영상 합성 미리보기로 보이게 하지 않는다. |
| **13D. 토큰·공통 컴포넌트** | 상기 색/서체/간격/모서리·공통 버튼/레이블/아이콘/배지/상태 컴포넌트, 16px 모바일 입력과 48px 주요 타깃이 존재한다. 로고 원본을 필터로 바꾸지 않고 ALL 흰 로고는 등록된 어두운 proof 배경에 전시한다. Inbox/Publish 행·전체 선택의 모바일 레이블 48×48와 PC 밀도를 로컬 실제 터치 좌표로 확인했다. | 모든 작은 보조 선택 컨트롤에 대한 전수 검증은 아니다. 새 목록 터치 영역 변경은 통합 WebKit CI와 새 빌드 시각 검증에 포함한다. |
| **13E. 인터랙션·상태** | hover/active/focus/selected/disabled/loading/error/empty/recovery, 버전·미저장·저장 중·결과 미확인, 현재 수행 단계·외부 연결 제한을 구분한다. reduced motion이 전역 transition/animation을 제거한다. 첫 조회 실패의 Retry를 모바일 첫 화면에 배치했다. | Canva capability 제한 문구와 pending 미리보기 문구를 실제 응답에 맞춰 로컬 수정했으며 새 CI/운영 반영이 남는다. 임의 진행 백분율을 넣지 않는다. |
| **13F. 렌더링 기반 반복 검수** | CI #259의 실제 빌드/합성 API 화면에서 모바일/PC 동일 콘텐츠, A/B·before/after·원고/템플릿/자산/오류를 캡처했다. 채널 native select 넘침, 닫힌 원고 필드, 원본 로고 노출, 잘못된 빈 화면/Retry 위치, 캡처 이미지 교체 race를 수정하고 재검증했다. | 새 목록 복귀/터치 영역/추가 뷰포트와 capability 문구를 최종 불변 WebKit CI에서 다시 확인한다. 물리 기기 소프트 키보드와 화면 읽기 도구 검증은 별도다. |
| **13G. 구체적 결과 보고** | `docs/CREATIVE_WORKSPACE_20261106.md`, 별도 문서 브랜치의 `CREATIVE_WORKSPACE_REVIEW_20261106.md`와 비교 PNG, 결과 JSON에 방향/토큰/실제 화면/수정 근거/검증 경계를 남겼다. | 최종 코드 SHA·새 CI·실제 Canva/SNS 결과·운영 배포 여부를 최신화하고 사용자에게 제공해야 한다. 현재 PR 본문의 과거 운영 SHA·외부 미검증 문장은 새 결과로 갱신해야 한다. |

## Canva 공식 근거와 현재 외부 제한

- 현재 공식 [Create design autofill job](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/create-design-autofill-job/)은 Canva Pro(교육·비영리 포함), Teams, Enterprise에서 Autofill을 지원한다고 설명한다. Enterprise 전용이라고 단정하지 않는다. 사용자 대신 실행하는 OAuth 앱에는 `design:content:write`가 필요하다.
- [Get user capabilities](https://www.canva.dev/docs/apps/rest-apis/reference/users/get-user-capabilities/)는 주어진 토큰의 사용자 기능을 조회하며 `profile:read`를 요구한다. 계정 플랜 이름 추정 대신 이 실제 capability 결과로 기능을 제어한다.
- [Autofill guide](https://www.canva.dev/docs/apps/rest-apis/autofill-guide/)는 계정/앱 권한, 필드 준비, OAuth, 비동기 실행/조회 절차를 구분한다.
- 11:49까지 실제 앱의 폴더·내보낸 미리보기 캐시는 성공했으나 `autofill=false`다. 사용자의 플랜·팀 설정 원인을 확정한 것이 아니다. 실제 원고 자동 채우기 성공으로 보고하거나 새 유료 플랜을 선택하지 않는다.

## 네이버 과거 수집 오류와 현재 연결 검사

- 운영 경고의 원인은 선택 채널의 마지막 수집401만 읽고, 그 뒤 공유 키의 연결 검사 성공을 비교하지 않은 안내였다. 실행88(채널3)의10:02–10:08 실패는 보존한다. 실행89(채널1)의10:41–10:43 네이버24회/실패0도 실제 다른 채널의 결과로 구분한다. 실행89의 partial은 공식 출처·본문 처리 한도 때문이며 네이버 인증 실패가 아니다.
- 새 로컬 overview는 연결 검사 성공 여부·시각만 제공한다. 진단 문구·키 값·응답 원문은 넣지 않는다. 화면 키가 검사 이후 바뀌면 이전 검사를 복구 근거로 쓰지 않는다. 서버 환경변수 키는 현재 프로세스 시작 이후의 검사만 신뢰하므로 재배포 전 다른 키의 성공을 현재 복구로 표시하지 않는다. 선택 채널의 모든 완료된 실패 실행보다 늦은 성공 검사일 때만 ‘이후 연결 검사는 성공, 해당 채널의 다음 수집 결과는 아직 미확인’으로 표시한다. 새 실패·미완료 실행·실패 검사·잘못된 시각은 계속 경고하며 과거 실행 상세는 그대로 남긴다.
- 실제 UI에서 브라우저가 저장 로그인 정보를 빈 API 입력칸에 채워 연결 확인을 일시 차단했으나, 운영자는 저장하지 않고 임시 입력만 비운 뒤12:33 검사를 성공했다. 이때 저장된 네이버 키는 변경되지 않았다. Canva의 과거 OAuth 오류 원인으로 확대 해석하지 않는다.
- `Connections.tsx`는 API 전용 필드명·비밀값의 `new-password`·form `autocomplete=off`·1Password ignore 속성으로 로그인 자동완성과 구분한다. [MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion)은 비밀번호 관리자가 `off`를 무시할 수 있음을 설명하며, [1Password 공식 변경 기록](https://releases.1password.com/b5x/stable/)은 ignore 속성을 지원한다. 모든 브라우저/확장 프로그램에서 완전 차단을 입증한 것은 아니며, 새 배포 후 실제 UI 재확인이 남는다.
- Node22.23.4의 격리된 실제 로컬 PostgreSQL API9개, 인증 상태 UI14개, 기존 작업실 UI7개, 키 입력 UI2개가 모두 통과했다. 타입 검사와 diff 검사도 통과했다. 결과는 `test-results/collection-auth/api-final.json`, `ui-final.json`에 있다. API 검사는 오래된401 보존·민감한 진단 미노출·키 교체 후 재검사 요구를 확인한다. 화면 검사는 새 실패/미완료 실행·검사 이전 실패·합성 키 변경/비우기·저장 없는 연결 검사 요청을 구분한다. 운영 수집이나 자격 증명을 수정하지 않았다.

## 수동 Canva 가져오기 독립 검토 · 로컬 배치

- `shared/canvaManualImport.ts`, `server/services/canvaManualImport.ts`, `routes/canvaEditorial.ts`는 사용자 확인을 받은 기존 복사본을 GET 메타데이터로 검증한 후 영속 작업을 만든다. 마스터·dataset·Autofill을 꾸며 만들지 않으며 외부 디자인 원본을 갱신하는 요청을 보내지 않는다. 외부 쓰기는 명시적 export 요청이다.
- 라이브러리/등록 마스터/승인된 원본, 다른 콘텐츠에 묶인 디자인, 현재 OAuth 사용자·팀이 소유하지 않은 디자인을 거부한다. 콘텐츠 행 잠금과 디자인 advisory 잠금으로 동시 바인딩을 직렬화한다.
- 같은 UUID는 원래 영속 receipt를 반환하고 body가 다르면409, 다른 UUID의 진행/미확정 중복은 차단한다. export 접수 응답을 잃으면 unknown으로 남기고 자동 재요청하지 않는다. 명시적 결과 확인·재연결 경로는 별도 기록한다.
- 사용자·팀, 수정 시각, 페이지 순서/크기와 제공되는 페이지 ID를 출력 전에 고정 확인하고 다운로드 후 버전을 다시 확인한다. 공급자가 ID를 생략하면 임의 ID를 만들지 않고 geometry+수정 시각으로 제한된 비교를 한다. 이를 완전한 고정 페이지 ID 검증이라고 설명하지 않는다.
- PNG/JPEG 8장과 출처를 원자적으로 저장하며 원고가 바뀌면 별도 보존/superseded한다. 현재 원고에는 자동 적용하지 않고 문구 대조 후 명시적 채택을 요구한다. 채택의 CAS·승인 무효화와 이후 publication proof가 수동 provenance를 검증한다.
- 실제 PostgreSQL과 PNG persistence를 쓰는 로컬 6파일/147테스트 JSON을 직접 확인했다. 외부 공급자는 합성 응답이며 라이브 게시·Canva 가져오기 성공과 구분한다. 독립 검토는 위 파일과 export/publication/reconciliation·nullable-master 마이그레이션 경계를 읽었으며, 최신 불변 CI를 대신하지 않는다.
- 마지막 guard는 페이지 메타데이터 GET 중 계정이 바뀌는 경우를 export POST 직전에 다시 차단한다. 새 수동 PostgreSQL27개와 타입 검사가 통과했다. UI 독립 검토는 `CanvaManualImport.tsx`의 사용자/복구scope/채널/콘텐츠별 UUID receipt, 정확한 원래 버전·revision·design 응답 비교, 다른 사용자로의 늦은 응답 무시, 원본/외부 URL 거부와 기존8장 로딩·문구 확인·채택 경계를 대조했다. UI53개와 실제 Chrome3폭 성공은 최종 불변 CI나 실제 Canva provider 성공을 대신하지 않는다.

## AI 없는 첫 8장 원고 저장 · 추가 로컬 경로

- 일반 Studio 초안만으로는 근거가 고정된 v2 8장 원고가 생기지 않는 간극을 확인했다. 별도 `familyManual` 최초 저장 경로는 제공 자료 본문·각 요약/정의의 정확한 발췌·발언/전망 유형·운영자 확인으로 새 원고를 만든다. URL 입력만으로 조회했다고 기록하지 않으며, 모든 사실은 `provided_document`/`article_only`, 독립 검증 false다. AI 생성·외부 게시·가짜 모델 기록을 만들지 않는다.
- 신규 작성은 UUID advisory 잠금과 영속 receipt/hash로 응답 유실 뒤 같은 요청을 재조회한다. 기존 원고 전환은 채널/원고 잠금과 version CAS, 이미 v2이면 초기화 거부를 적용한다. 원본 revision/asset을 보존하고 기존 승인만 무효화한다. 기존 canonical 근거 검사를 그대로 거치므로 다른 원고의 fact ID·발언자를 꾸미거나 전망을 사실로 올릴 수 없다.
- 최종 로컬 실제 PostgreSQL/API17개와 타입 검사, 앞선 관련10파일/142개 통과 JSON을 직접 대조했다. 최초 저장→수동 Canva enqueue 연결은 합성 공급자 GET이며 실제 provider 내보내기 성공을 뜻하지 않는다. 백엔드 독립 검토는 차단 결함을 찾지 않았다. 일반8장 입력 UI11개가 통과했다. 독립 검토에서 발견한 파일 읽기 지연 race는 활성 scope·파일 선택 순서·입력 변경 횟수·최신 pending 잠금으로 수정됐고, 지연 파일2개 회귀도 통과해 재검토를 완료했다. 정상 Studio 신규 진입의 실제 빌드 Chrome320/393/1280 검사는 통과했다. 모바일은 일반8장 입력, PC는 선택적 파일 입력으로 기존 편집기·수동Canva 화면과 실제1080×1350 미리보기를 열었다. 관련5UI파일89검사도 통과했다. 공급자·API는 합성이고 외부 호출/게시·콘솔/page 오류는 없었다. 새 불변 WebKit CI와 실제 운영 저장/가져오기는 남는다.

## 일반 Studio 텍스트 AI의 추적 보완 · 새 로컬 배치

- 실제 QA에서 드러난 traceability 간극을 좁게 수정했다. 원고·캡션·한컷 adapter가 기존 provider execution과 정확한 application prompt 입력의 SHA/tool 이름을 전달하고, 안전한 실패에도 이미 받은 provenance를 보존한다. 다른 모델 fallback이나 추가 실제 요청을 만들지 않는다.
- worker는 기존 `job.result`에 provider/requestedModel/actualModel/provider response ID/known usage 또는 unknown/null, prompt hash와 job/운영자 request UUID/카드/sourceVersion/revisionId binding을 저장한다. 새 revision 및 성공 완료와 같은 거래에 반영하므로 사용자 새 입력을 보존한 미적용 후보에도 정확히 연결된다. 잘린 결과·적용 실패의 알려진 provider 사실은 revisionId=null로 남기며 취소되거나 실행 소유자가 바뀐 작업을 다시 쓰지 않는다.
- metadata가 없는 adapter·이전 응답은 호환 모델 문자열이나0 토큰을 actual/known으로 승격하지 않는다. 후기 전용 adapter의 빠진 provenance는 명시적unknown이며 이미지 worker 동작은 이번 좁은 수정의 범위 밖이다. 과거 job32를 역채우거나 실제 공급자 응답을 되찾았다고 주장하지 않는다.
- Node22.23.4의 실제 격리 PostgreSQL+합성 공급자4파일38검사와 타입 검사·diff 검사가 통과했다. 실제/requested 모델 분리·providerID·prompt hash·revision binding·unknown·실패 usage, 기존 사용자 수정/취소/이미지 회귀를 포함한다. `test-results/studio-provenance/targeted.json`이 증거다. 독립 검토에서 차단 결함은 없었으며 최신 사용자 수정 때문에 미적용된 후보의 revision/sourceVersion binding과unknown provenance를 추가 대조했다. `final-studio.json`에 최종 회귀 결과를 남겼으며 새 불변 CI와 운영 반영은 남는다.

## 완료 전 남은 우선순위

1. 새 로컬 배치를 동시 변경을 보존한 실제 커밋에 묶고, 타입·전체 PostgreSQL·WebKit·메모리 예산을 다시 검증한다.
2. 실제 Canva 기능 제한을 정확히 표시하고, 허용되는 연결·미리보기·외부 편집·복귀/가져오기 경로를 확인한다. 실제 Autofill entitlement가 없으면 제한을 확정 기록한다.
3. 즉시 QA 게시의 실제 성공과 새 승인8의 예정 전 취소를 기록했다. 남은 재예약 실제 전송을 QA 콘텐츠의 새 명시적 승인으로 수행한다. 매 게시마다 실제 계정과 새 permalink를 즉시 알리고 과거 콘텐츠를 보내지 않는다.
4. 원본의 주요 화면·모바일/PC·상태·접근성 확인을 새 빌드에서 마무리한다.
5. 승인 범위 안에서 최종 운영 반영 시 배포 ID·live SHA·health·저장/조회·외부 결과를 다시 대조하고, 기능·검사·배포·외부 성공을 구분한 최종 보고를 제공한다.
