# PR #73 원본 요구사항 반영·운영 검증 현황

이 문서는 사용자가 제공한 원본 1–13항 및 13A–G를 실제 구현과 검증 근거에 연결한다. **코드·전체 CI·병합·운영 배포·마이그레이션과 확인한 기존 QA 데이터 보존은 완료**했다. **새 운영 UI의 실제 수동8장/Canva 채택과 QA2 예약 전송은 브라우저 도구 정책 차단으로 미완료**다. 이 경계를 유지하며 전체 프로젝트 완료율이나 일괄 완료를 주장하지 않는다.

## 기준 버전과 검증 상태

| 구분 | 확인한 사실 |
| --- | --- |
| 검토 대상 | [PR #73](https://github.com/boramsama01-code/ai-mom_studio/pull/73), feature [`34d5146460da3d0c9e9902df0e4aa1ee1b159e47`](https://github.com/boramsama01-code/ai-mom_studio/commit/34d5146460da3d0c9e9902df0e4aa1ee1b159e47), tree `8bea6ea1e3c25c54cce59f565debde54781a438e`. 직전 a92 이후 변경은 검사 대역 두 파일이며 제품 실행 코드를 바꾸지 않았다. |
| feature 불변 CI | [CI #268](https://github.com/boramsama01-code/ai-mom_studio/actions/runs/42172556427) **전체 SUCCESS**. head34의 전체 **223파일·2,312검사**, 초기31검사, 타입·빌드·모든 엄격 WebKit 단계가 성공했다. Linux 독립 메모리3회 **392.39/398.91/417.73MiB, 최대417.73≤448**, 출력 일치도 성공했다. |
| 병합 main CI269 | [CI #269](https://github.com/boramsama01-code/ai-mom_studio/actions/runs/42174175582)는 실제 merge `3e0d583a42a34402c11aacdad2dd6daebb3cbcec`에서 **completed / SUCCESS**. 전체223파일·2,312검사, 초기5파일31검사, 타입·빌드, 모든 실제 WebKit 단계, 독립 메모리3회 **410.37/405.11/415.93MiB(최대415.93≤448)**·출력 일치가 전부 성공했다. |
| 직전 통합 근거 | [CI #267](https://github.com/boramsama01-code/ai-mom_studio/actions/runs/42171136275)는 모든 WebKit 단계와 메모리 3회가 성공했지만, 전체 검사는 옛 Wouter 대역에 `useSearch`가 없어 실패했다. 전체 성공으로 계산하지 않는다. |
| 로컬 보완 검증 | Node22.23.4에서 초기 PostgreSQL 포함 5파일·31검사 성공. Wouter 대역 두 곳을 실제 URL 검색 조건에 맞춘 뒤 **전체 jsdom/UI 52파일·465검사 성공, 검사 실패0**, 타입·diff 검사 성공. `work/ui-suite-report.json`, `work/ui-suite-test-paths.json`, `work/wouter-mock-freeze.json`에 원본 결과와 해시가 있다. 이 수치는 CI #268의 전체 검사 수가 아니다. |
| 사전 실제 외부 검증의 운영 버전 | PR #75의 `b3aca65db77c94d015f612a1906f67ff8c985a58`, Render `dep-dbmjnhcs728c73999ma0`에서 아래 Canva/Naver/Gemini/SNS 실제 QA를 수행했다. **지금 운영 중인 PR73 배포와 사전 QA의 실행 버전을 구분한다.** |
| PR #73 병합·현재 운영 | 15:24 KST에 병합된 main/merge SHA는 [`3e0d583a42a34402c11aacdad2dd6daebb3cbcec`](https://github.com/boramsama01-code/ai-mom_studio/commit/3e0d583a42a34402c11aacdad2dd6daebb3cbcec). tree는 feature34와 **정확히 같은 `8bea6ea1e3c25c54cce59f565debde54781a438e`**다. 기존 무료 서비스 `srv-dbjep0ou01pc73f8rf80`의 Render **`dep-dbmn4vtg1s2s73d5jsgg`,15:25:27 KST live**와 별도 health의 같은 merge SHA·ok/DB connected/auth configured를 확인했다. |
| 운영 마이그레이션·스키마 | 15:27:27 KST의 명시적 READ ONLY 운영 조회로 **`0023_creative_workspace`, `0024_canva_manual_import`, `0025_family_manual_requests`의 journal 해시가 소스와 모두 일치**함을 확인했다. 수동 Canva master nullable, 수동8장 receipt 테이블 존재도 확인했다. |
| 배포 후 기존 데이터 보존 | READ ONLY 전후 대조 **6개 구획 모두 동일**: QA34/v4·QA35/v3, Studio revision7개, job32의 원래 요청/결과, approvals7/8·deliveries2/3, assets57/58 실제 바이트/해시, source17453 현재 원고. 기존 성공1회/취소0회 시도 증거도 유지됐다. `work/pr73-live-deployment-verification.json`이 근거다. |
| 배포 직후 관측 | 15:24–15:27:30 KST 조회 구간 error 로그0. 새 인스턴스의 일반 기동/health 표본은 **105.42/107.23MiB**였다. **실제8장 내보내기 부하가 아니며, 이전 약205MiB 폴더 부하 표본과 전후 성능 비교를 하지 않는다.** |
| 배포 후 새 UI 수용 | **NOT DONE — 새 화면 저장·재접속, 실제 운영 Assets 화면 확인, 동일 콘텐츠의 모바일→PC 이어쓰기.** 배포·스키마·기존 데이터 보존 확인과 별개의 항목이다. |
| 실제 외부 미완료 | **NOT DONE — 정상 UI의 첫 수동8장 저장→실제 Canva 사본 내보내기→8장 전부 육안 대조→명시 채택·재접속**, 그리고 **QA2 새 예약·재시작 전후 보존·실제 새 전송/permalink**. 실행 도구의 운영 사이트 정책 거부로 아직 수행하지 못했다. |

이전 수용 기록과 재개 기록의 과거 시각·SHA·‘로컬 변경’·‘대기’ 문구는 당시의 이력이다. 현재 판정은 위 버전표와 아래 근거를 따른다. 기존 자료는 [원본 수용 기록][ledger], [구현 중 재개 기록(14:50)][resume], [설계·시각 검수 이력][design]에 보존돼 있다.

## 원본 1–13항 대조

| 원본 요구 | 반영한 결과와 코드 | 검증 근거와 판정 범위 |
| --- | --- | --- |
| **1. 목적·환경·다양한 제작 경로** | 기존 React/Vite/TypeScript/TanStack Query/Wouter, Express/Drizzle/PostgreSQL와 Render를 유지한다. [Studio][studio]의 원고·뉴스/자료·사진/영상·완성 이미지 시작 경로와 채널 설정을 조합한다. 모든 콘텐츠에 수집·AI·Canva를 강제하지 않는다. AI 없이 첫 v2 8장을 만들 수 있는 [수동 원고 입력][manual-ui]도 추가했다. | 실제 PostgreSQL 계약·독립 모바일/PC 브라우저 컨텍스트·수동8장 WebKit 검사가 있다. 새 유료 서버나 워크플로 빌더는 만들지 않았다. 영상은 편집 구성과 수동 외부 완성 경로를 제공하며, 앱 내 합성·인코딩·SNS 영상 전송을 완성 기능으로 주장하지 않는다. |
| **2. 실제 조사·문제 우선순위** | 기본/feature/main/운영 SHA, 실제 서비스·DB·작업·채널·Canva·발행 상태를 재확인했다. [설계 기록][design]에 문제/재현/영향/원인/개선/검증을 남겼다. URL·요청 중복, 오래된 저장, 응답 유실, 잘못된 승인/게시의 방지를 우선했다. | 과거 완료 문구를 새 성공으로 인용하지 않았다. 실제 오류로 확인한 메모리 초과·이미지 URL 수명·0/8 로딩 표시를 수정했다. 옛 검사 자료가 실제 서버 DTO와 달랐던 경우에는 원인과 대역 수정을 구분하고 제품의 판별 로직을 후퇴시키지 않았다. 개선 전 화면은 고정 baseline 빌드를 실제 렌더링한 비교이며 모든 운영 화면의 수정 전 실사용 전수 조사라고 확대하지 않는다. |
| **3. 채널의 데이터화·독립 설정** | DB 채널·creative profile·허용 형식·기본 제작 경로·기본 디자인·등록 로고/URL·색·서체/말투/자산 가이드와 기존 소분류·수집·작업별 AI·게시 목적지 설정을 재사용한다. [채널 설정][settings]과 [공유 설정 계약][profile]이 근거다. 채널, 제작 형식, 계정, 목적지를 구분한다. | 실제 PostgreSQL에서 생성/수정/CAS·보관/복원·다른 채널 보존을 검사하고, 브라우저에서 새 채널과 미저장 전환을 확인했다. 기존 브랜드의 호환 기본값만 경계에 남긴다. 서체 가이드를 모든 기존 템플릿 폰트의 강제 변경으로 소개하지 않는다. |
| **4. 업무 중심 화면·맥락 유지** | 내 콘텐츠/수집함/자산/발행/설정의 역할을 정리하고, 원고 기반 콘텐츠는 같은 작업 공간에서 카드·원문·게시 준비·기록을 펼친다. 일반 발행 Studio와 canonical 원고를 `sourceReference`로 구분한다. Studio·Inbox·Publish·새 자산 목록의 검색/필터/페이지/스크롤·안전한 선택은 사용자/채널별로 복귀한다. | 단일 편집기·미저장 입력·뒤로/앞으로·채널 분리 회귀와 실제 브라우저 복귀 검사. 새 Assets에서도 채널 전환이 `/assets`에 머물고 상세/정확한 기록 방문 후 검색·범위·페이지·선택이 유지된다. 위험한 일괄 작업 선택이나 복원 실행은 자동 복구하지 않는다. |
| **5. 모바일·PC별 작업 방식** | PC의 원고와 선택 컷 미리보기, 모바일의 접이식 미리보기·단일 주 행동, safe-area/키보드 뷰포트·긴 한글·48px 주요 터치 영역·16px 입력을 적용했다. 목록 행/전체 선택은 레이블 여백으로 실제 48px를 확보하고 PC 밀도는 유지했다. 클립보드는 사용자 동작으로만 읽고 거부 시 직접 입력을 제공한다. | 320/360/393/430/768/1440px, 가로 852×393·짧은 393×480 화면을 포함한 회귀와 실제 좌표 hit 검사. 새 수동8장·자산·Canva 흐름은 320/393/1280px를 검사했다. CSS 뷰포트 시험을 실제 휴대폰의 OS 키보드·물리 기기 검증으로 확대해 주장하지 않는다. |
| **6. 일관된 디자인·접근성·상태** | [공통 스타일][tokens], 아이콘/버튼/배지/저장 상태/복구/오류 컴포넌트를 재사용한다. 승인 브랜드 원본을 필터로 바꾸지 않고 원래 비율로 보여 준다. 로딩·빈 상태·실패·재시도·수정/저장/미확정·키보드 포커스·reduced motion을 구분한다. | 실제 렌더링 A/B·동일 콘텐츠 개선 전후와 주요 화면 캡처, 포커스·오류·복구 UI 검사. 모든 화면의 자동 대비 점수나 스크린리더 전수 검사를 수행했다고 쓰지 않는다. 구체적 비주얼 수용 근거는 아래 13A–G에 분리했다. |
| **7. 서버 저장·충돌·기기 복구·버전 연결** | 서버 version/CAS와 영속 revision/receipt/job을 기준으로 한다. 임시 복구는 사용자·복구 scope·채널·콘텐츠로 구분하고, focus/reconnect 조회가 현재 입력을 지우지 않도록 한다. [API 응답 처리][api]는 성공 헤더만 받고 본문이 끊긴 경우 가짜 저장 완료를 만들지 않는다. | 실제 PostgreSQL의 동시 요청·같은 UUID 재조회/다른 body 거부·오래된 저장409, UI의 새로고침/복구/늦은 응답/이동 보호 검사. 독립 저장소의 모바일/PC 컨텍스트가 같은 ID를 열고 저장·재접속하는 시나리오도 있다. sessionStorage 목록 설정을 서버 동기화라고 설명하지 않는다. |
| **8. 수집·원고·이미지·영상·자산 연결** | URL/직접 입력/파일/완성 자료 출발점과 원문 확보·직접 제공·검증 수준을 구분한다. 실제 제목·본문·표시 문구·캡션·장/컷/칸 지시를 수정하고 AI 제안은 비교 후 채택한다. [수동8장 계약][manual-contract]은 정확한 제공 발췌를 묶되 `provided_document`/`article_only`, 독립 검증 false·AI 실행 없음으로 저장한다. 새 [Assets 결과 탭][assets]은 승인 이미지·저장 영상과 현재/과거 결과를 한곳에서 찾는다. | 제공 템플릿을 검증 뉴스로 올리지 않는다. 수동8장 파일 읽기 race·UUID 응답 유실·기존 v1 보존/CAS·각 필드 저장을 검사했다. 새 자산 API16검사는 **실제 PostgreSQL의 검증용 승인 snapshot**으로 현재 결과 부재·채널/범위·이전 버전·원본 다운로드를 검사하고, UI/브라우저는 합성 API 자료를 사용했다. 운영의 새 Assets 화면 수용과 구분한다. 저장 영상은 **게시 승인 없음**, 사용 중 원본 장면도 포함한다. **후기용 `experienceMedia` 사진 업로드**는 1600px 이하 편집본을 저장하고 영상은 원본 바이트를 저장한다. 이 설명을 원본 브랜드·카드 자산 전체에 적용하지 않으며 후기 사진 원본 보존이나 영상 인코딩을 제공한다고 하지 않는다. |
| **9. 실제 Canva 지원 범위와 복귀** | 실제 OAuth·폴더·미리보기·편집 링크와 수동8장 가져오기를 구분한다. [수동 Canva UI][canva-manual]는 콘텐츠용 독립 사본과 원고 일치의 두 확인, 영속 요청·출력 진행·8장 로딩·문구 대조·명시 채택을 연결한다. 원본/다른 콘텐츠 디자인을 거부하고 연결 해제·만료·권한·미확정에도 원고/기존 결과를 유지한다. | 운영 main75에서 OAuth·14종/112페이지와 QA 폴더 신규→수정→캐시 갱신→폴더 밖 복귀를 실제 확인했다. 앱 토큰은 **autofill=false/capability_missing**이므로 자동 채우기 성공·플랜 원인을 꾸며 쓰지 않는다. 수동 import/export/채택은 PostgreSQL·합성 공급자·실제 앱 WebKit에서 검사했지만 **배포 후 실제 사본의 8장 내보내기·육안 대조·채택은 NOT DONE**이다. |
| **10. 영속 자동화·실제 발행** | PostgreSQL jobs/lease/요청 UUID·승인 버전/목적지 snapshot·append-only attempt/event·unknown 확인을 사용한다. 즉시·KST 예약·취소·개별 목적지 실패·안전한 재전송·기록 보관/휴지통/복원과 외부 게시 삭제를 구분한다. 외부 응답을 잃은 유료 생성/게시를 맹목 재실행하지 않는다. | 실제 SIGKILL 재시작 검사에서 dispatch 전 재개와 dispatch 후 unknown을 확인했다. 기존 운영의 실제 QA 즉시 게시1건, 새 예약의 예정 전 취소/시도0·QA 기록 복원을 확인했다. **QA2 신규 예약→재시작/배포 전후 보존→새 실제 전송은 NOT DONE**이다. 영상 게시와 Instagram 외부 삭제 지원을 주장하지 않는다. |
| **11. Render·로딩·메모리·예약 한계** | 무료 512MiB·기존 단일 서비스/inline worker·DB 영속 저장을 유지한다. [실제 이미지 작업 수명][raster]에서 부모에 남던 임시 이미지 처리와 JPEG 재복사를 줄이고, 단일 admission/시간 제한/작업자 종료·입력 소유권을 지켰다. 단계별 로딩/스켈레톤·복구와 실제 상태명을 제공한다. | Linux Node22의 독립 cold process 3회×동일7요청, 작업자 포함 RSS≤448MiB·출력 해시 일치를 모두 요구한다. CI268은 **392.39/398.91/417.73MiB, 최대417.73**와 출력 일치로 성공했다. 병합 main CI269 메모리도410.37/405.11/415.93MiB로 성공했다. 해상도/품질·예산을 낮추거나 강제GC·숨은 프로세스 제외를 쓰지 않았다. 새 운영 일반 기동 표본105.42/107.23MiB를 실제8장 부하나 이전205MiB와의 개선 비교로 쓰지 않는다. 다운로드 총량·Render cold-start 개선도 주장하지 않는다. 무료 유휴 중지와 GitHub 예약 지연 때문에 정확한 분 단위 발행을 보장하지 않는다. |
| **12. 실제 구현·검사·커밋·재개·보고** | 실제 파일·PR·보존된 동시 변경·불변 커밋/CI·브라우저 결과·[재개 문서][resume]를 제공한다. 구현/테스트/운영/공급자 결과를 나눠 기록하며 새 비용·영구 삭제·공개 범위를 임의로 변경하지 않았다. 사용자가 명시 승인한 실제 QA만 실행했다. | CI268 전체 성공, merge SHA·같은 tree·Render live·health·0023–0025 적용·6개 구획의 데이터 보존을 확인했다. main CI269도 전체 성공했다. 새 운영 UI/수동Canva/QA2 실제 수용은 남아 있다. 자동 승인/접근 정책 거절을 성공으로 덮거나 다른 경로로 우회하지 않는다. 이 검증 현황과 PR 본문에 성공·미완료를 따로 기록한다. |
| **13. 기능과 별도 비주얼 수용** | 두 실제 디자인 방향과 같은 콘텐츠의 개선 전후를 비교해 A를 선택했고, 브랜드 원본·템플릿·원고·컷·모바일·자산 결과를 실제 앱 빌드로 검수했다. 새 수동8장과 Assets도 같은 시각 언어로 구현하고 실제 캡처를 확인했다. | 자동 검사 통과만으로 취향이나 모든 화면의 완벽함을 단정하지 않는다. 아래 A–G에서 방향·토큰·주요 화면·상태·발견/수정 내용을 구체적으로 확인한다. 해당 코드는 운영 반영됐지만 새 운영 화면의 실제 UI 검증은 아직 실행하지 못했다. |

### 자산 복원과 원고 복원을 구분한 결과

- **일반 Studio 작업 버전**: 정확한 해당 카드 revision을 최근60개 밖에서도 읽는다. 현재 입력 보호→최신 서버 버전 조회→두 번째 명시 확인→CAS로 새 초안을 만든다. 저장된 이미지/영상 ID 참조를 다시 선택하며 이전 기록·이미 전송된 외부 게시물은 보존한다. 승인은 다시 필요하다. URL을 열기만 해서는 복원·생성·저장을 실행하지 않는다.
- **원고 기반 콘텐츠**: 과거 원고 비교·복원은 문구에 적용된다. 승인 당시 JPEG나 승인이 복원됐다고 표시하지 않는다. 해당 원본/이미지 묶음 다운로드와 기존 완성 이미지/ZIP 새 콘텐츠 경로를 제공한다. 재업로드 정규화 뒤 게시 JPEG 해시가 옛 승인본과 같다고 약속하지 않는다.
- **현재 결과 비교**: 실제 현재 revision 이미지 또는 현재 `videoProject.outputMediaId`가 있을 때만 오른쪽 비교 파일을 연결한다. 없으면 없다고 표시한다. 과거 승인본을 현재 파일로 대체하지 않는다. 일반 발행 작업의 `sourceOutput`만으로 canonical 원고 편집기로 보내지 않는다.

### 실제로 발견해 수정한 두 이미지 상태 문제

1. `FamilyDialogueEditor`의 이전 렌더 정리 작업이 아직 반영 전인 새 blob URL까지 먼저 해제하던 문제: 선택/작은 미리보기를 원자적으로 갱신하고 실제 교체된 참조만 DOM 반영 후 해제한다. 이전 effect 중 새 URL 생성·연속 교체·반영 전 언마운트의 결정적 회귀3개와 기존25개가 통과했고, 후속 실제 WebKit의 뉴스8장 흐름이 성공했다.
2. Canva 8장 채택 후 메타데이터가 바뀌면 같은 이미지 DOM의 로딩 표시가0/8로 돌아가던 문제: 채널 URL+SHA+재시도별 실제 로딩 증거를 유지하고 현재 자산의 증거만 센다. 동일8장·일부1장 교체·전체 교체·재정렬·채널 변경·늦은 이벤트를 검사했다. 확인 동의는 revision/작업/순서 변화에 별도로 초기화한다. 실제 WebKit에서 채택 뒤8/8을 확인했다.

## 13A–G 비주얼 수용 근거

| 기준 | 실제 반영·검수 결과 | 범위와 근거 |
| --- | --- | --- |
| **A. 구체적인 아트디렉션** | 따뜻한 중성 작업대, 청록색 도구, 승인 브랜드 원본과 큰 미리보기로 방향을 정했다. 인터페이스 장식 대신 콘텐츠에 시각적 무게를 둔다. | 배경 `#f5f5f1`, 본문 `#232c2a`, 주요 행동 `#17665b`; 성공/경고/오류는 별도 의미 색상. [실제 토큰][tokens]과 [설계 이력][design]. |
| **B. 레퍼런스·두 방향 비교** | Buffer Create/Ideas의 콘텐츠 중심 목록·수집 아이디어와 Canva 공식 API/편집 복귀의 지원 패턴을 조사했다. 같은 콘텐츠에서 A(밝고 넓은 원고 작업대,26px 제목·24px 갤러리 간격)와 B(짙은 탐색 영역,22px 제목·12px 간격·높은 밀도)를 실제 렌더링했다. 한글 장문 편집과 컬러 원본 판단의 여유를 근거로 A를 선택했다. | Mobbin은 유료 접근 제한으로 보지 못했으며 참고 근거로 꾸미지 않았다. A/B는 실제 구현 비교이며 B를 제공되는 테마 설정으로 소개하지 않는다. [생성 가능한 비교 검사][creative-script]·[운영 코드 CI269 비교 캡처][creative-artifact]. |
| **C. 화면별 중심·선택 일치** | 홈은 이어 할 작업/검토 대상의 썸네일, 제작 공간은 현재 컷/페이지/장면·원고와 결과, 자산은 원래 비율·확대·현재/과거 버전 비교가 중심이다. 모바일은 목록→필터→선택 결과를 세로 재배치한다. | 선택 컷/대사/미리보기 일치와 14종 템플릿·브랜드·캐릭터/포즈, 새 승인 이미지·저장 영상, 실제/빈 현재 결과를 검사했다. 영상 포스터·재생 제어는 실제 합성/인코딩 성공을 뜻하지 않는다. |
| **D. 토큰·공통 컴포넌트** | 26px 제목/18px 소제목,14–16px 주요 입력·본문과 모바일16px,4/8/12/16/24/32 간격,12px 패널/8px 버튼 모서리, 절제된 그림자·단일 아이콘 계열·포커스 링을 적용했다. 48px 모바일 주요 조작과 레이블 영역을 실제 좌표로 확인했다. | ALL 흰 로고는 등록된 어두운 proof 배경에 원본 그대로 표시한다. UI/스크린 캡처 범위를 모든 보조 컨트롤의 접근성 전수 인증으로 확대하지 않는다. |
| **E. 조작·상태의 완성도** | 기본/hover/active/focus/selected/disabled, 수정/저장 중/완료/실패/기기 보관/미확정·단계별 진행을 구분한다.160ms 전환과 reduced motion, 구조형 skeleton·첫 조회 오류의 보이는 재시도, 명시적 복구/확인을 제공한다. | 기능 제한·연결 해제·과거 오류와 현재 검사 성공·원본 보존·현재/이전 승인·게시 승인 없는 영상의 문구를 실제 상태에 맞췄다. 모르는 진행률을 백분율로 만들지 않았다. |
| **F. 실제 렌더링 반복 검수** | 동일 콘텐츠의 PC/모바일·개선 전후·A/B를 촬영했다. native select 넘침, 닫힌 원고, Retry 위치, 원본 로고 누락, 미리보기 URL 수명·0/8 표시, 터치 여백과 버튼 가림을 찾아 수정했다. 새 Assets6캡처를 육안 확인했고 차단 UX 결함은 발견하지 못했다. | 실제 앱 빌드+합성 API 브라우저와 운영 계정 검증을 구분한다. 긴 요소 캡처 중 고정 상단 메뉴가 중간에 찍히는 현상은 가공하지 않고 기록했다. CI268의 엄격 WebKit은 성공했고 같은 tree의 운영 배포도 확인했다. 실제 새 운영 UI 캡처·수용은 별도로 남아 있다. |
| **G. 구체적 결과 보고** | [설계 이력][design], [기존 수용 기록][ledger], [재개 기록][resume], 이 항목별 보고서에 방향·토큰·주요 화면·발견/수정·성공/실패 경계를 연결했다. | 아래 실행 이미지와 CI artifact를 제공한다. ‘새 코드 작성’, ‘검사 통과’, ‘실제 배포’, ‘외부 서비스 완료’의 마지막 값은 위 기준표에서 각각 확정한다. |

시각 근거 파일은 실제 캡처이며 UI를 새로 그리거나 성공 화면으로 합성하지 않았다. `outputs/creative-workspace-browser-review.png`는 대표화면의 A/B·동일 콘텐츠 개선 전후 검수 자료다. `manual-eight-authoring-mobile.png`, `manual-eight-editor-desktop.png`는 새 일반 UI 수동8장 작성·편집, `asset-library-desktop.png`(956×1095), `asset-library-mobile.png`(361×1910)는 새 자산 비교를 보여 준다. 출력 디렉터리 파일은 로컬 전달물이며 저장소에 이미지가 올라갔다고 가정하지 않는다. 재현 가능한 원본은 [운영 코드 CI269 브라우저 artifact][browser-artifact]와 [비교 artifact][creative-artifact]에 있다. 새 자산 전달 이미지의 범위는 `outputs/asset-library-evidence.txt`에 명시했다.

## 이미 확인한 실제 외부 결과 — main75 운영의 증거

| 실제 작업 | 확인 결과 | 이 결과가 입증하지 않는 범위 |
| --- | --- | --- |
| **Canva OAuth·폴더·미리보기** | 사용자가 활성 Client secret을 바로잡은 뒤 실제 앱 연결 성공. 원본14종×8장=112페이지 캐시·오류0. QA 복사본만 신규 발견→표지 문구 수정→버전/출력 해시/캐시 변경→폴더 밖 복귀를 확인하고 원본14종을 보존했다. | 앱 토큰 `autofill=false`는 그대로다. 다른 연결 도구의 필드 조회를 운영 Autofill 성공으로 계산하지 않는다. PR73 수동 사본8장 내보내기/채택의 실제 성공은 아직 아니다. |
| **Naver 현재 연결** | 12:33:55의 정상 UI 최소 연결 검사가 검색 결과1건으로 성공. 선택 채널3의 키 교체 전401과 다른 채널의 실행89에서 **NAVER 질의24회·인증 실패0**인 결과를 따로 기록했다. **실행89 전체는 다른 처리 한도 때문에 partial**이었다. 저장 키는 이 검사에서 바꾸지 않았다. | 해당 채널의 새 수집 완료나 전체 수집 성공을 뜻하지 않는다. 새 경고/자동완성 방지 코드는 PR73과 함께 배포됐으나 새 운영 화면의 실제 표시 확인은 아직 실행하지 못했다. |
| **Gemini 텍스트 QA1회** | 승인된 Studio35/job32,12:53:49 앱 기록 시도1·revision68/v3 적용, 원고/캡션/4컷·제목/메모/채널 보존·재접속과 자체5장 미리보기의 첫/마지막 장1080×1350을 확인했다. 이미지 생성0. | 당시 main은 실제 usage·응답 model/ID provenance를 저장하지 않아 unknown으로 남긴다. PR73의 향후 텍스트 provenance 보완이 과거 기록을 되찾았다는 뜻은 아니다. 추가 실제 AI 호출은 하지 않았다. |
| **실제 SNS 즉시 QA1건** | Studio34→content17453→approval7/delivery2,12:00:01 KST `provider_verified`, 실제 전송1회. 계정 `@spacepenguin.co`, [실제 새 게시물](https://www.instagram.com/p/DfYlxqIE-4p/). 사용자에게 성공 직후 알렸다. | 과거 다른 계정 게시물을 이번 결과로 계산하지 않는다. PR73 신규 화면 배포 뒤의 E2E나 QA2 새 예약 전송을 뜻하지 않는다. |
| **예정 전 취소·기록 복원** | 같은 QA의 approval8/delivery3을13:30으로 예약 후12:08:07 취소. 시도0·외부ID 없음. QA 기록2개만 보관→휴지통→복원해 기존 성공 링크/전송1회·취소/시도0과 승인 자산 해시가 유지됐다. | 이미 전송된 Instagram 게시물은 삭제하지 않았다. 취소된 예약을 다시 살리지 않았다. 새 QA2 예약·실제 전송은 아직 없다. |

실제 공급자/운영 기록의 세부 시각·ID·비밀값 없는 증거는 [기존 수용 기록][ledger]과 [재개 기록][resume]에 남아 있다. 합성 응답의 CI 성공을 위 표의 실제 작업 횟수에 더하지 않는다.

## 남은 실제 수용과 재개 순서

1. **새 운영 UI·실제 수동8장/Canva는 미완료다.** 제공 템플릿 예시·게시 금지 QA로 첫 수동8장을 정상 UI에서 저장하고, 독립 사본 `DAHaG4kocvw`를 실제 내보내야 한다.8장 전부의 문구·순서·크기·브랜딩을 육안 대조한 뒤에만 명시 채택하고 재접속 보존을 확인한다. 원본 `DAHZ9UpAYzo`는 수정하지 않는다. 새 화면의 모바일 폭→PC 폭 이어쓰기도 여기에서 확인한다.
2. **QA2 예약/재시작/새 실제 게시도 미완료다.** 기존 QA Studio34에서 새 승인으로 미래 예약을 만든 뒤 실제 재시작 전후 snapshot을 대조하고, 새 전송의 계정·permalink·시도수를 확인해 즉시 알린다. approval9와 두 번째 실제 게시물은 아직 없다. 기존 approval7의 성공과 approval8의 취소를 다시 보내거나 취소된 예약을 살리지 않는다.
3. **현재 실행 세션의 브라우저 접근을 복구해야 한다.** 사용자가 Codex 사이트 접근을 허용했고 로컬 설정의 `spacepenguin.onrender.com → allow`도 확인했지만, 현재 도구는 여전히 저장 설정/관리 정책에 따른 origin 거부를 반환한다. 로그인 실패·운영 장애라고 단정하지 않으며 다른 브라우저·API 쓰기·DB 삽입으로 차단을 우회하지 않는다. 새 Codex 실행에서 권한을 다시 확인하는 인계가 필요하다. 재시작이 반드시 해결한다고 단정하지 않는다.
4. **GitHub 정기 복구 실행의 현재 활성 상태는 미확인이다.** main의 매시17분 cron과 과거 성공 실행은 확인했지만 설정 화면 접근이 차단됐고, 사용자가 확인한 ‘workflow’ 문구만으로 활성/중단을 판정하지 않았다. 무료 Render 휴면과 외부 스케줄 지연의 한계를 그대로 알린다. 별도 유료 상시 서비스나 더 잦은 유료 실행을 임의로 추가하지 않는다.

실제 배포 재시작 뒤 추가로 확인한 것은 **PG 캐시 메타데이터의 보존**이다(15:32:30 KST, READ ONLY). 원본14종의 버전이 모두 유지됐고 각8장·총112개 현재 버전540×675 미리보기, preview ready14·오류0을 확인했다. 카탈로그의 `needs_fields`14는 Autofill 준비 완료를 뜻하지 않는다. 폴더 밖 QA사본 `DAHaG3n67rk`는 missing 상태와 이전 캐시8장을 보존했다. 수동 가져오기용 `DAHaG4kocvw` 작업/출력/채택과 수동8장 요청은 모두0이다. 새 OAuth·상위 공급자 호출·모든 이미지 바이트 동일성이나 실제 수동 채택을 이 결과로 주장하지 않는다.

예비 수동 인계물은 `outputs/qa-manual-eight-manuscript.json`과 `outputs/manual-eight-qa-readme.txt`에 준비했다. 파일 준비는 실제 저장·Canva 내보내기·게시 성공이 아니다. 현재 인계 기록과 결과물은 기존 운영 코드의 추가 배포를 일으키지 않는 문서 전용 브랜치에 남긴다. Render 임시 health 확인은 현재 작업 연속성을 위해16:36 KST까지만 유지하며 자동 종료한다. 작업이 그 전에 완료되면 중단한다. 로컬 검사 PostgreSQL은 정상 종료했다.

현재 판정은 **원본 각 영역의 구현·CI268/269 전체 성공·운영 반영·마이그레이션·대조한 QA 데이터 보존은 확인했으며, 위 실제 새 UI/Canva8장/QA2 및 정기 복구 상태 확인은 미완료**다. 미완료 항목을 확인 전 완료로 올리지 않는다.

[ledger]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/docs/ORIGINAL_PROMPT_ACCEPTANCE_20261106.md
[resume]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/docs/RESUME_PR73_20261106.md
[design]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/docs/CREATIVE_WORKSPACE_20261106.md
[studio]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/client/src/pages/Studio.tsx
[manual-ui]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/client/src/ManualFamilyInitializer.tsx
[settings]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/client/src/pages/ChannelSettings.tsx
[profile]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/shared/creativeProfile.ts
[tokens]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/client/src/creativeWorkspace.css
[api]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/client/src/api.ts
[manual-contract]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/shared/familyManual.ts
[assets]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/client/src/AssetResults.tsx
[canva-manual]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/client/src/CanvaManualImport.tsx
[raster]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/server/services/readingCardRaster.ts
[creative-script]: https://github.com/boramsama01-code/ai-mom_studio/blob/34d5146460da3d0c9e9902df0e4aa1ee1b159e47/scripts/creative-workspace-regression.mjs
[creative-artifact]: https://github.com/boramsama01-code/ai-mom_studio/actions/runs/42174175582/artifacts/13482896263
[browser-artifact]: https://github.com/boramsama01-code/ai-mom_studio/actions/runs/42174175582/artifacts/13482716640
