# Studio 사용 흐름·게시 제어 수정 — 2026-11-04 KST

## 확인한 문제와 수정

| 확인한 문제 | 적용한 변경 | 검증 기준 |
| --- | --- | --- |
| 수집 카드와 원문 항목에 같은 편집기가 따로 있어 화면 왕복 | Studio의 수집 카드도 `ItemDetailPage`를 사용. 카드 편집기는 유지하고 자료·초안·게시 준비·전송 내역은 같은 페이지에서 열기 | 편집기 DOM 유지, 미저장 문구 보존, 두 경로의 같은 편집 동작 |
| 동일 화면에 동등한 강조의 기능이 과다 | 기본 메뉴 3개, 원문/AI/Canva/관리/캐릭터는 보조 영역으로 접기 | 모바일 및 데스크톱 폭, 메뉴 접근성, 기능 경로 유지 |
| 선택 원문의 본문이 빈 경우가 많음 | `not_fetched`와 실제 실패 구별. 선택한 원문만 1회 자동 조회. 본문 상태 필터 추가 | 중복 fetch 방지, 필터 결과 및 총수, 실패 후 직접 재시도 |
| 원문 재조회 실패가 기존 정상 본문을 무효화 | 기존 정상 본문·hash·확인 시각 보존, 실패 진단을 meta에 별도 기록 | API 회귀 테스트 |
| 일부 언론사 문자셋·모바일 페이지 처리 부족 | charset/BOM/meta/XML 인코딩 해석, 같은 기사로 확인된 공개 AMP/mobile/canonical 한 번만 대체 조회 | EUC-KR 등 파싱, 동일 기사 검증, 차단 페이지에서 대체 조회 안 함 |
| Gemini 503에 무조건 자동 재호출 없음 | 명확한 503/일시 429만 기존 호출 예산 내 최대 3회. Retry-After/취소/전체 제한시간 반영 | 성공·실패·일일한도·네트워크 결과 불명·취소·중복 요청 방지 |
| 수집 카드 승인 화면에는 예약 시각만 있음 | `timing: now/later`를 UI와 서버에서 명시. 즉시는 서버 시각, 예약만 미래 날짜 입력 | 날짜 없는 즉시 승인, 한국 시간 예약, 과거 예약 거절 |
| 예약 취소·실패 재전송이 눈에 보이지 않음 | 편집기의 전송 내역, 발행함, 완성 이미지 게시 화면에서 공용 `DeliveryActions` 사용 | scheduled 취소, failed/dry_run 재전송, unknown은 미게시 확인 후 재전송 |
| 취소·재전송과 전송 시작의 상태 경합 | 항목→전송→승인 잠금, 최신 상태 재확인, 조건부 갱신. 즉시 실행은 요청한 승인/전송만 대상으로 제한 | PostgreSQL에서 동시 재전송 1회, 취소와 worker claim 양립 금지 |
| 즉시 요청 직후에도 예약 지연 경고 | 예정 시각 후 60초는 중립 전송 대기, 그 이후에는 지연 표시 | 60,000/60,001ms 경계값 |

## 실제 화면 감사 근거

- 기존 `/studio/25`에서 원문·요약 버튼으로 `/items/3/9790`에 이동하고, 다시 제작 보드로 가져오는 경로를 확인했다.
- 기존 항목 상세 화면의 최종 승인에는 한국 시간 예약 입력만 있었다.
- 최근 수집 결과에 신규 188건, 본문 확보 한도 20건, 168건은 제목·요약만 저장이라고 표시됐다. 본문이 없는 모든 항목을 파싱 실패로 취급하면 안 된다.
- 격리 QA 작업 `/studio/26`에 서로 다른 첫째·둘째 카드 문구를 저장하고 다시 열어 보존을 확인했다. 실제 승인·게시·AI 요청은 하지 않았다.

## 검증과 범위

- 로컬 TypeScript 검사와 production build 통과.
- AI provider, 원문 파싱, 카드 편집/저장, 게시 상태 UI 및 회귀 테스트를 실행했다. 정확한 전체 테스트 결과와 최종 head 검증은 이 변경 PR의 CI 결과를 기준으로 한다.
- 로컬 PGlite 보조 DB에서는 publisher-source-api, source-status-filter-api, source-text-api, card-copy-api의 23개 테스트 및 editor-generation-regression UI 9개가 통과했다. PGlite로 PostgreSQL 행 잠금의 동시성 동작을 입증하지 않는다.
- `publication-races-api.test.ts`는 CI의 실제 PostgreSQL 16에서 동시 재전송과 예약 취소 경합을 검증한다.
- `content-workspace-regression.mjs`는 합성 API와 기존 글꼴로 320/393/1280px의 편집·저장/재열기·시점 선택·예약 취소·확인 후 재전송을 검증한다. 모든 외부 요청을 차단하며 운영 데이터·계정·키를 사용하지 않는다.
- 실제 Instagram 공개 게시를 시험하지 않았다. Meta 계정 연결과 비밀값은 변경하지 않았다.
- Gemini 서버 장애나 발행사의 접근 제한 자체를 없애는 변경은 아니다. 횟수와 대기시간에 한도가 있고 직접 편집·본문 붙여넣기·명시적 재시도 경로를 제공한다.
- 외부 라이브러리·DB 스키마 변경은 없다. 기존 원고·자산·승인 이력은 유지한다.

## GitHub 제품 UI 참고 근거 — 2026-11-04 KST

스타 수만으로 기능을 추정하지 않고, 세 프로젝트의 README·편집 화면 소스·공식 문서를 대조했다. 아래는 관찰한 구현과 이번 스튜디오에 참고할 이유다. 외부 프로젝트의 코드·스타일·이미지는 복사하거나 의존성으로 추가하지 않았다. 스타 수는 이번 작업에서 GitHub Repository API로 확인한 시점 값이다.

| 프로젝트 | 확인한 스타 수 | 확인한 소스 커밋 | 현재 소스 라이선스 |
| --- | ---: | --- | --- |
| [Directus](https://github.com/directus/directus) | 38,808 | `88c5c470b14bdf3501a2a31e429273087f22e937` | Monospace Sustainable Core License 1.0, `MSCL-1.0-GPL`. 현재 README는 source-available로 설명한다. |
| [Strapi](https://github.com/strapi/strapi) | 73,425 | `2936f6b865c114932bf8613f2e880e739c9df340` | Community 영역은 MIT Expat. Enterprise 영역과 Content Releases 패키지는 별도 Enterprise License. |
| [Postiz](https://github.com/gitroomhq/postiz-app) | 40,785 | `e424fb587e0ae87a2428a0586cb00af6facd0d1d` | GNU Affero General Public License v3. |

### 1. Directus: 편집 본문과 보조 정보의 공간 분리

- **하나의 편집 폼과 보조 패널:** `app/src/modules/content/routes/item.vue`는 주 편집 폼을 `VForm`으로 렌더링하고, 미리보기는 접을 수 있는 `SplitPanel`, 변경 이력·댓글·공유·수동 흐름은 별도의 sidebar에 배치한다. 상단 저장 버튼은 저장 중·저장 가능 여부를 반영한다. [실제 item.vue 소스](https://github.com/directus/directus/blob/88c5c470b14bdf3501a2a31e429273087f22e937/app/src/modules/content/routes/item.vue)
- **접힌 그룹에서도 문제를 알 수 있음:** `app/src/interfaces/group-detail/group-detail.vue`는 그룹을 접고 펼치며, 접힌 상태의 변경 표시와 검증 오류 표시를 지원한다. 검증 오류가 바뀌면 해당 그룹을 펼친다. [실제 group-detail.vue 소스](https://github.com/directus/directus/blob/88c5c470b14bdf3501a2a31e429273087f22e937/app/src/interfaces/group-detail/group-detail.vue)
- **좁은 화면의 drawer:** `app/src/components/v-drawer.vue`는 오른쪽 drawer의 제목·보조 행동·주요 행동을 분리하고, 모바일 sidebar는 펼침 영역으로 전환한다. 취소와 Escape 처리가 명시돼 있다. [실제 v-drawer.vue 소스](https://github.com/directus/directus/blob/88c5c470b14bdf3501a2a31e429273087f22e937/app/src/components/v-drawer.vue)

**이번 화면에 참고할 이유:** 원문·초안·카드·게시 설정을 모두 같은 강조도로 길게 나열하지 않고 현재 편집하는 영역에 공간을 준다. 원문과 초안의 접기/펼치기는 내용과 오류 상태를 보존해야 한다. drawer 자체를 반드시 도입하는 대신 이 정보 배치 원칙을 현재 상세 편집 화면에 적용한다. 공식 [Content Versioning](https://directus.com/docs/guides/content/content-versioning) 문서도 오른쪽 변경 이력과 접힌 그룹의 변경 표시를 설명한다.

### 2. Strapi: 편집과 게시 동작을 상태에 맞게 배치

- **넓은 편집 영역과 행동 패널:** `packages/core/content-manager/admin/src/pages/EditView/EditViewPage.tsx`는 데스크톱에서 편집 폼 9열·보조 패널 3열을 사용하고, 작은 화면에서는 `ActionsDrawer`로 행동과 패널을 표시한다. Draft/Published 탭과 문서 상태가 편집 영역 위에 있다. [실제 EditViewPage.tsx 소스](https://github.com/strapi/strapi/blob/2936f6b865c114932bf8613f2e880e739c9df340/packages/core/content-manager/admin/src/pages/EditView/EditViewPage.tsx)
- **저장과 게시를 구분한 행동:** `packages/core/content-manager/admin/src/pages/EditView/components/DocumentActions.tsx`는 Save·Publish·Unpublish·Discard를 각각 정의한다. Save는 제출 중, 변경 없음, Published 탭에서 비활성화된다. [실제 DocumentActions.tsx 소스](https://github.com/strapi/strapi/blob/2936f6b865c114932bf8613f2e880e739c9df340/packages/core/content-manager/admin/src/pages/EditView/components/DocumentActions.tsx)
- **예약을 선택한 경우에만 날짜 입력:** `packages/core/content-releases/admin/src/components/ReleaseModal.tsx`는 예약 체크 상태에 따라 날짜·시간·시간대를 표시하고, 예약을 해제하면 해당 값을 지운다. 이 패키지는 Enterprise License이며 공식 문서는 Releases를 Growth/Enterprise 기능으로 구분한다. [실제 ReleaseModal.tsx 소스](https://github.com/strapi/strapi/blob/2936f6b865c114932bf8613f2e880e739c9df340/packages/core/content-releases/admin/src/components/ReleaseModal.tsx), [공식 Releases 문서](https://docs.strapi.io/cms/features/releases)

**이번 화면에 참고할 이유:** 저장 여부·검토 여부·실제 게시 여부를 섞지 않고 각 상태에 맞는 버튼을 둔다. 게시 상세 설정을 접더라도 즉시 게시와 예약 게시의 선택 및 결과는 명확하게 보여야 한다. 공식 [Draft & Publish](https://docs.strapi.io/cms/features/draft-and-publish) 문서도 초안 저장과 게시를 별도 동작으로 설명한다.

### 3. Postiz: 즉시 게시·예약·초안의 명시적 구분

- **서로 다른 세 동작:** `apps/frontend/src/components/new-launch/manage.modal.tsx`는 `draft`, `now`, `schedule`, `update`를 구분해 처리한다. 화면에는 Save as Draft·Post Now·Schedule/Add to calendar/Update가 상태에 따라 배치되며 처리 중과 계정 미선택 상태에서 실행 버튼을 비활성화한다. [실제 manage.modal.tsx 소스](https://github.com/gitroomhq/postiz-app/blob/e424fb587e0ae87a2428a0586cb00af6facd0d1d/apps/frontend/src/components/new-launch/manage.modal.tsx)
- **날짜 변경의 명시적 적용:** 같은 파일의 모바일 날짜 sheet는 `dateDraft`에 임시 입력을 두고 Save를 누를 때 게시 날짜에 적용한다. 채널·설정·태그·반복·날짜는 필요한 sheet만 연다. 단순히 닫는 행동과 적용하는 행동이 구분돼 있다.
- **사용자 시간대에 맞춘 날짜 선택:** `apps/frontend/src/components/launches/helpers/date.picker.tsx`는 날짜·시각 입력을 사용자 시간대로 다시 구성한다. 공식 API 문서도 `now`는 즉시 게시, `schedule`은 지정 시각 게시, `draft`는 저장만 수행한다고 명시한다. [실제 date.picker.tsx 소스](https://github.com/gitroomhq/postiz-app/blob/e424fb587e0ae87a2428a0586cb00af6facd0d1d/apps/frontend/src/components/launches/helpers/date.picker.tsx), [공식 Create Post 문서](https://docs.postiz.com/public-api/posts/create)

**이번 화면에 참고할 이유:** 날짜 입력이 채워졌다는 사실만으로 예약 의도를 추정하지 않고 즉시/예약 선택을 서버까지 전달한다. 전송 결과에 맞는 재시도·취소·실제 게시물 열기 같은 후속 동작은 스튜디오 자체의 delivery 상태 모델을 기준으로 제공한다. Postiz에서 동일한 delivery 재시도 UI를 확인했다는 의미는 아니다.

### 라이선스 확인 원문

- Directus: [readme.md](https://github.com/directus/directus/blob/88c5c470b14bdf3501a2a31e429273087f22e937/readme.md), [루트 license](https://github.com/directus/directus/blob/88c5c470b14bdf3501a2a31e429273087f22e937/license), [app/license](https://github.com/directus/directus/blob/88c5c470b14bdf3501a2a31e429273087f22e937/app/license), [공식 라이선스](https://directus.com/license). 확인한 현재 소스를 BSL 또는 즉시 GPL로 표기하지 않는다. 라이선스는 해당 버전 공개 4주년부터 GPL-3.0 추가 허용을 명시한다.
- Strapi: [루트 LICENSE](https://github.com/strapi/strapi/blob/2936f6b865c114932bf8613f2e880e739c9df340/LICENSE), [content-manager/LICENSE](https://github.com/strapi/strapi/blob/2936f6b865c114932bf8613f2e880e739c9df340/packages/core/content-manager/LICENSE), [content-releases/LICENSE](https://github.com/strapi/strapi/blob/2936f6b865c114932bf8613f2e880e739c9df340/packages/core/content-releases/LICENSE). 저장소 전체가 단일 MIT 라이선스인 것으로 표기하지 않는다.
- Postiz: [README.md](https://github.com/gitroomhq/postiz-app/blob/e424fb587e0ae87a2428a0586cb00af6facd0d1d/README.md), [LICENSE](https://github.com/gitroomhq/postiz-app/blob/e424fb587e0ae87a2428a0586cb00af6facd0d1d/LICENSE). 참고 범위는 조작과 정보 배치 패턴이다.
