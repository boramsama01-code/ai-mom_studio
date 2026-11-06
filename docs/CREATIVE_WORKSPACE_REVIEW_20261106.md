# 검증 진행 중 · 작업 재개 체크포인트

현재 구현은 `ac95665a4ed1a9fad296eb01d13b8246bcdf4c30`, PR #73입니다. 최종 CI 42149151773의 실제 결과를 확인하기 전이며 아래 본문은 검토용 기록입니다. 이미지 메모리 442.79MiB는 직전 0ef1880 측정입니다. 최종 완료 보고는 최신 커밋의 타입·테스트·빌드·브라우저·448MiB 검사와 실제 캡처를 다시 확인한 뒤 이 파일을 갱신합니다. 운영 서비스는 7b2bf40이며 이번 개편은 배포하지 않았습니다.

# 우주펭귄상회 작업 공간 개편 · 구현과 검증

## 반영 상태

- 구현 커밋: `ac95665a4ed1a9fad296eb01d13b8246bcdf4c30`
- PR: [#73](https://github.com/boramsama01-code/ai-mom_studio/pull/73)
- 최신 main의 Canva 인증 수정 PR #74(`7b2bf40c7bff473bcb1f5d91cb328ed4713f7bca`)를 두 부모 병합으로 보존했습니다.
- 이번 UI 개편은 운영 배포하지 않았습니다. 실제 운영 반영 버전은 아래 최종 조회 기록으로 구분합니다.
- 운영 DB에는 마이그레이션·초안·테스트 자료를 쓰지 않았습니다. 새 유료 서버·워커·저장소·플랜을 추가하지 않았습니다.
- 실제 SNS 게시, 외부 게시물 삭제, 유료 생성 요청은 실행하지 않았습니다.

## 중단 원인과 재개 대책

확인한 중단은 세 가지로 구분됩니다. 로컬 실행 서버의 연결이 끊기고 45초 복구가 실패했습니다. 변경 파일은 검증한 GitHub 원문에서 재구성해 커밋했으며 이후 작업은 연결된 저장소와 CI로 계속했습니다. 이 증거만으로 ChatGPT의 APICore 대화 오류 내부 원인을 확정하지 않습니다.

앞선 CI는 WebKit 의존성을 Azure Ubuntu 미러에서 받다가 전체 30분 제한에 걸렸습니다. 공식 Ubuntu 미러로 바꾸고 DB 검사와 브라우저 검사를 독립 실행하며, 핵심 화면 검사 직후 증거를 저장하도록 수정했습니다. 웹 서비스의 장애로 오인하지 않게 실패 단계와 재개 위치를 작업 기록에 남깁니다.

이미지 캡처를 강화한 뒤에는 React가 교체한 이전 이미지의 디코딩 약속이 WebKit에서 중단되는 별도 검사 오류가 발생했습니다. 현재 연결된 화면의 이미지 로드와 안정된 프레임을 확인하도록 바꾸고, 실패 캡처가 같은 검사에서 다시 막히지 않게 했습니다. 깨진 이미지와 실제 레이아웃 실패는 계속 실패로 처리합니다.

## 개선한 업무와 코드

| 업무 | 실제 구현 | 코드 |
|---|---|---|
| 이동 중 자료 저장 | URL·채널을 먼저 저장하고 같은 콘텐츠 ID로 재개. 동일 채널의 URL 중복과 기존 본문 덮어쓰기 방지 | [capture.ts](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/server/routes/capture.ts), [QuickCapture.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/QuickCapture.tsx) |
| 직접 작성·뉴스·사진·영상·완성 이미지 | 출발점을 구분하고 AI와 Canva를 강제하지 않음. 채널별 형식·기본 경로·템플릿·캐릭터·브랜드 기준 저장 | [creativeProfile.ts](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/shared/creativeProfile.ts), [CreativeProfileFields.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/CreativeProfileFields.tsx) |
| 중복·저장 충돌 | PostgreSQL 생성 요청 기록·해시·잠금, 기존 버전 비교 유지, 복귀 시 최신 조회와 미저장 입력 보존 | [studio.ts](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/server/services/studio.ts), [0023](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/migrations/0023_creative_workspace.sql) |
| 제작 공간 | PC 원고와 선택한 컷을 함께 표시, 모바일 접이식 미리보기. 원고를 AI 도구 앞에서 직접 편집 | [Studio.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/pages/Studio.tsx), [StudioWorkingPreview.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/StudioWorkingPreview.tsx) |
| 작업 맥락·상태 | 사용자·채널별 검색·필터·보기·위치 보존. 서버 저장·저장 전·기기 보관·실패를 구분 | [useWorkspaceView.ts](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/useWorkspaceView.ts), [SaveState.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/SaveState.tsx) |
| 자산 탐색 | 디자인 템플릿·승인된 캐릭터/포즈·브랜드 가이드를 연결. 등록 원본 로고를 채널별로 선택·저장하고 해시 검증한 비공개 미리보기 제공 | [Assets.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/pages/Assets.tsx) |
| Canva 이동 | 저장 상태 안내, 편집 링크·복사 대안, 복귀와 최신 결과 가져오기 구분. 기존 원고·출력 보존 | [ExternalDesignLink.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/ExternalDesignLink.tsx), [CanvaEditorial.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/CanvaEditorial.tsx) |
| 영상 구성 | 비율·장면·길이·대본·자막·오디오·표지·완성 파일 참조와 버전 기록. 실제 SRT 다운로드. 자료 소유권·동영상 형식 검증 | [VideoEditor.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/pages/VideoEditor.tsx), [videoProject.ts](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/shared/videoProject.ts) |

영상 합성·인코딩·SNS 영상 전송은 연결되지 않은 상태로 명확히 안내합니다. 사진은 기존 업로드 정책대로 긴 변 1600px 이하 JPEG 편집용 사본, 영상은 업로드한 원본을 보관합니다. 사진 12MB·영상 25MB·작업당 100MB 제한과 사진 원본 별도 보관 안내를 표시합니다.

## 디자인 선택과 실제 검수

A안을 선택했습니다. 밝은 중성 작업 영역과 청록 도구, 큰 미리보기가 긴 한국어 원고와 콘텐츠의 색상을 판단하기에 적합했습니다. 같은 콘텐츠를 사용한 B안은 짙은 탐색 영역, 더 작은 제목과 촘촘한 갤러리로 비교했습니다. B안은 비교 자료이며 제품의 추가 테마 설정으로 노출하지 않습니다.

Buffer Create의 자료 포착→아이디어 정리→제작 연결과 썸네일 중심 작업 탐색 패턴을 참고했습니다. Canva 공식 문서의 편집 URL·비동기 내보내기·폴더 항목 조회를 기준으로 연결 상태를 구분했습니다. Mobbin은 유료 접근 제한으로 화면을 열지 못했으며, 보지 못한 화면을 근거로 사용하거나 플랜을 결제하지 않았습니다.

| 항목 | 구현 기준 |
|---|---|
| 색상 | 배경 `#f5f5f1`, 본문 `#232c2a`, 주요 도구 `#17665b`, 성공·경고·오류는 별도 의미 색상 |
| 서체 | Pretendard·한국어 시스템 대체 서체. 제목 PC 26px/모바일 24px, 주요 입력 모바일 16px |
| 간격·형태 | 4/8/12/16/24/32px, 버튼 8px·패널 12px 모서리, 제한된 그림자 |
| 조작 | 모바일 주요 버튼 48px, 선택 테두리·밑줄·아이콘, 키보드 포커스, 160ms 전환·reduced motion |
| 저장 | 저장 중/서버 저장/미저장/기기 임시 보관/실패를 문구와 아이콘으로 구분 |

실제 렌더링에서 발견해 수정한 문제는 다음과 같습니다.

| 문제 | 재현 경로·영향 | 원인 | 수정·검증 |
|---|---|---|---|
| 긴 새 채널명으로 가로 스크롤 | 채널 추가→설정 저장→콘텐츠 목록, 393px 문서가 405px로 확장 | WebKit 선택상자 155px 내부 문구가 183px까지 넘침 | 선택 문구만 줄임표·범위 제한, 전체 옵션·도움말 유지, 바깥 포커스 링. 393/1280px 채널 검사 |
| 원고 입력이 고급 항목에 묻힘 | 원고 편집에서 반복 펼치기 필요 | 원고와 도구의 위계 역전 | 원고를 앞에 배치하고 안정적인 접근 이름 부여 |
| 모바일 조회 실패의 복구 버튼이 아래로 밀림 | 첫 목록 조회 실패, 첫 화면에 다시 시도 버튼 없음 | 실패를 빈 작업 안내와 함께 배치 | 오류와 복구 행동을 개요 위치에 표시. 스크롤 없이 보이는지 검사 |
| 기존 파란색이 새 토큰을 덮음 | 제작 공간 버튼만 파란색 | 예전 `.studio` 색상 변수 | 공통 토큰 상속, 실제 화면 비교 |
| 선택한 컷과 미리보기 비교가 번거로움 | 원고·그림 편집 왕복 | 함께 보는 영역 부재 | 하나의 선택 상태와 초안으로 원고·편집기·미리보기 연결 |
| 로고가 오기 전에 캡처 | 자산 화면 진입 직후 | 글꼴만 기다리고 이미지 디코딩을 기다리지 않음 | 현재 화면의 이미지 로드와 안정된 두 프레임을 확인한 뒤 캡처. 교체된 이미지의 디코딩 약속은 재사용하지 않음 |

기존 HighScoop·ALLligodang·우주펭귄 원본 로고를 등록 자산 ID로 선택할 수 있게 연결했습니다. 흰색 ALLligodang 원본은 어두운 검수 배경을 사용하며 이미지 필터·원본 변환을 적용하지 않습니다. 로고 읽기 API는 인증과 등록 목록·원본 해시를 확인하며, 임의 파일 경로를 받지 않습니다. 구현은 [BrandAssetPreview.tsx](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/BrandAssetPreview.tsx), [등록 자산 스키마](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/shared/creativeProfile.ts), [보호된 읽기 API](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/server/routes/studio.ts)에 있습니다. 새 채널은 등록 자산 또는 HTTPS 주소로 로고를 지정합니다. fryday에는 저장소에서 확인한 승인 로고가 없어 채널 이름을 표시하며 임의 로고를 만들지 않았습니다.

실패를 숨겨 통과시키지 않습니다. 레이아웃 검사에는 헤더·메뉴·알림·텍스트의 범위와 내부 스크롤 폭이 포함되며, 한 크기가 실패해도 다른 크기의 증거를 수집한 뒤 전체 검사를 실패시킵니다.

## 검증 범위

실제 PostgreSQL에서 생성 중복·응답 유실 재시도·이전 버전 저장 거부·채널 설정/보관/복원 분리·URL 공유 원문 보존·자료 소유권을 확인했습니다. 기존 발행·Canva·원고·자산 회귀 검사도 유지했습니다.

브라우저는 실제 Vite/React 프로덕션 빌드와 WebKit을 사용합니다. API 응답은 합성이며 외부 요청·유료 생성·SNS 게시를 차단했습니다. 별도 저장소를 가진 모바일·PC 브라우저 세션 사이에서 같은 콘텐츠 ID와 원고 저장·복귀를 확인합니다. 360/393/430/768/1440px에서 긴 제목, 원고 충돌 보존, 링크 저장·클립보드 거부, 영상 저장/재접속, 자산, 빈 결과·오류를 확인합니다. 기존 검사에는 320px과 8장 뉴스·발행 제어도 포함됩니다. 실제 휴대전화 키보드·Canva 앱 전환·실제 SNS 전송의 검증과 구분합니다. 템플릿 자산 화면은 Canva 미연결 응답을 사용해 등록된 14개 세트의 표시·썸네일 로드·가로 넘침을 별도로 검사합니다.

| 요구 시나리오 | 검증 방식 |
|---|---|
| 모바일 자료 저장→PC 이어 쓰기→모바일 재접속 | 기기 저장소가 분리된 두 WebKit 세션과 같은 서버 ID. 별도로 실제 PostgreSQL 저장·재시도 검사 |
| 새로고침 후 원고·영상 설정·자료 참조 유지 | 실제 빌드 저장/재열기, DB 영상 자료 소유권·버전 검사 |
| 뉴스·웹툰·영상에 맞는 편집 경로 | 기존 8장 뉴스 편집 검사, 선택 컷/원고 UI, 새 영상 장면/SRT 검사 |
| 채널 추가·보관·복원 분리 | PostgreSQL 다른 채널 행 불변 확인, 393/1280px 실제 채널 이동 검사 |
| Canva 이동·복귀·가져오기 실패 시 보존 | UI 상태·원고 회귀 검사. 실제 계정 OAuth/내보내기 성공과 구분 |
| 중복 클릭·응답 유실·이전 버전 저장 | 동시 DB 요청의 단일 생성·수정된 재시도 거부·이전 원고 충돌 |
| 지금 게시·예약·취소·실패·결과 미확정 | 기존 발행 API/지속 작업 회귀 및 브라우저 제어 검사. SNS 응답은 합성 |
| 360/393/430/768/1440px·긴 한국어·빈 목록·오류 | 실제 WebKit 빌드, 가로 넘침·이미지 로드·첫 화면 복구 위치·하단 조작 중복 검사 |

CI가 비교 PNG·개별 화면·결과 JSON을 생성합니다. 아래 최종 검사 기록과 연결된 실제 캡처를 기준으로 재현할 수 있습니다.

파일·JSON 응답을 끝까지 받기 전에 저장 완료로 처리하지 않도록 API 수신부를 보완했습니다. 저장 요청의 응답이 유실되거나 성공 응답 본문이 끊기면 결과 미확인으로 구분하고 현재 입력을 유지합니다. 업로드도 자료 목록 확인 후 재시도하도록 안내하며 자동 재요청하지 않습니다. [api.ts](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/client/src/api.ts)와 [수신·취소 검사](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/tests/api-cancellation.test.ts)에 구현했습니다.

## 무료 환경의 이미지 메모리 보완

동일한 Node 22·8장 원고 기반 오프라인 작업에서 이전 최대 RSS 529.96MiB를 확인했습니다. 기능 검사가 통과해도 무료 환경의 메모리 적합성을 보장하지 않아, 이미지 메모리 검사를 독립 CI 작업과 448MiB 실패 기준으로 바꿨습니다.

최종 후보는 기존 단일 네이티브 작업·대기 제한을 유지하고, 서버 시작 전에 `MALLOC_ARENA_MAX=2`를 지정하며 Sharp 캐시를 끄고 픽셀 동시 처리를 하나로 제한합니다. 별도 Render 서비스·유료 워커·폰트 교체·출력 축소·강제 GC·힙 상한은 추가하지 않았습니다. 캐시·병렬성보다 메모리 여유를 우선한 설정입니다.

최신 측정은 **442.79MiB**로 기준을 통과했습니다. 선택 페이지·연속 3회 전체 출력·동시 요청 2건·Canva ZIP 복호화와 전경 작업 대기를 포함한 7개 요청을 수행했고, 매번 출력 해시가 일치하는지 확인했습니다. 이 수치는 CI 오프라인 작업의 결과이며 운영 서버의 기동 시간이나 모든 작업의 메모리를 보장하는 수치가 아닙니다.

코드: [시작 설정](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/package.json), [공통 이미지 설정](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/server/services/card.ts), [네이티브 작업](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/server/services/readingCardRasterWorker.mjs), [메모리 검사](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/scripts/cardnews14-memory-qa.mjs), [CI](https://github.com/boramsama01-code/ai-mom_studio/blob/ac95665a4ed1a9fad296eb01d13b8246bcdf4c30/.github/workflows/ci.yml). Linux 메모리 할당과 캐시 설정은 [Sharp 공식 성능 문서](https://sharp.pixelplumbing.com/performance/)를 참고했습니다. 별도 프로세스 실험은 합계 RSS가 586.70MiB로 증가해 최종 코드에서 제거했습니다.

## 운영 조사와 남은 우선순위

읽기 전용 운영 DB 점검에서는 활성 채널 5개와 통합 보관 채널 1개, 콘텐츠 32개(휴지통 12개), 저장 이미지 31개와 업로드 자료 2개를 확인했습니다. 이 자료를 수정하거나 삭제하지 않았습니다. 네 브랜드 목록으로 강제로 줄이지 않았습니다. 원문 수집 상태의 과거 누적은 본문 확보 304건·미조회 4,710건·실패 724건·차단 26건·미지원 342건이었습니다. 이 합계는 현재 실패율이 아니며, 빠른 URL 저장은 본문 미확인 상태를 명시합니다.

기존 Render 무료 웹 서비스와 외부 Neon PostgreSQL, GitHub 시간별 복구 작업을 유지합니다. 유휴 중지·실행 지연 때문에 정확한 분 단위 예약을 보장하지 않습니다. 영속 작업 기록과 기존 중복 게시 방지를 유지합니다. 운영 플랜 변경은 하지 않았습니다.

- 앱 자체의 실제 Canva OAuth 권한·폴더 변경·출력 가져오기는 별도의 실제 계정 검증이 필요합니다. 연결 도구의 Canva 권한과 앱 OAuth는 다릅니다.
- 실제 유료 AI 생성·SNS 게시·SNS 게시물 삭제는 이번 검증에 포함하지 않았습니다.
- 원본 사진 보관과 자동 영상 합성은 저장/실행 구조를 별도로 설계해야 합니다. 비용이 생기는 변경은 승인 전에 적용하지 않습니다.
- 무료 서버의 무거운 작업 동시 실행 제한을 유지하고 이미지 메모리 검사 기준을 추가했습니다. 최종 버전의 초기 다운로드·Render 기동 시간 대조 측정은 수행하지 않았습니다. 스켈레톤은 데이터 조회 대기 상태를 표현합니다.
- 최신 main과 이 PR의 변경을 구분해 단계적으로 배포하고 실제 계정 연결·중단/복귀를 확인하는 것이 다음 순서입니다.


