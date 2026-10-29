# 가계부 · 무료 Render 정적 사이트

`woori-ledger-render` 브랜치는 가계부의 독립 배포 소스입니다. 기존 스튜디오의 `main` 브랜치와 별도로 운영합니다.

## 기능

결제일·카테고리·항목·원화 금액, 교육비 현우·정우 구분, 선택 기간의 합계, 검색·필터, 지출 수정·삭제, CSV 내보내기를 제공합니다. JPG·PNG·WebP·PDF 영수증을 첨부하고 확인하거나 내려받을 수 있습니다. 영수증은 지출당 최대 5개, 파일당 10MB, 합계 20MB까지입니다.

## 기록과 영수증 저장

Render는 앱의 HTML·CSS·JavaScript만 제공합니다. 지출 내역과 영수증 파일은 사용 중인 브라우저의 IndexedDB에 저장하며 서버로 전송하지 않습니다. 별도 계정이나 유료 데이터베이스·디스크가 필요하지 않습니다.

같은 주소를 같은 기기·브라우저 프로필에서 다시 열면 기록을 불러옵니다. 다른 기기·브라우저·사이트 주소와 자동으로 동기화되지 않으며, 사이트 데이터 삭제나 브라우저 저장공간 정리 시 기록이 사라질 수 있습니다. 시크릿 모드는 장기 기록용으로 사용하지 마세요.

화면의 백업 기능은 지출과 첨부 영수증을 함께 파일로 내보냅니다. 다른 기기로 옮기거나 보관한 파일에서 복원할 수 있습니다. CSV에는 지출 표만 포함되므로 영수증까지 보관하려면 전체 백업을 사용합니다. 백업 파일에도 지출·영수증 원본이 들어 있으므로 본인이 관리하는 위치에 보관합니다.

기존 ChatGPT Sites의 기록은 기존 사이트에 그대로 남습니다. Render판으로 자동 복사되지 않습니다. 다른 사람이 공개 주소를 열어도 이 브라우저에 저장된 내역을 볼 수 없으며, 그 사람의 브라우저에서는 별도 기록을 사용합니다.

## 실행과 빌드

Node 24.22.1을 사용합니다.

```sh
npm ci --include=dev
npm run check
npm run build
npx vite preview --host 0.0.0.0 --port 4173
```

배포 대상은 `dist/`뿐입니다. Render의 Static Site에는 서버 시작 명령이 없습니다. 이전 서버 구현이나 로컬 `.data`, `.env`, 테스트 내역은 정적 배포 산출물에 포함하지 않습니다.

## Render 배포

| 설정 | 값 |
| --- | --- |
| 서비스 종류 | Static Site |
| 저장소 | `https://github.com/boramsama01-code/ai-mom_studio` |
| 브랜치 | `woori-ledger-render` |
| 빌드 명령 | `npm ci --include=dev && npm run build` |
| 게시 폴더 | `dist` |
| `NODE_VERSION` | `24.22.1` |
| `SKIP_INSTALL_DEPS` | `true` |

`render.yaml`은 이 구성을 재현하는 Blueprint입니다. `runtime: static`을 사용하며 유료 서버 플랜, 영구 디스크, 데이터베이스, 계정 설정 키를 만들지 않습니다. 기본 `onrender.com` 주소를 사용합니다. 단일 `/` 화면이므로 별도 SPA rewrite는 필요하지 않습니다.

Blueprint에는 보안·캐시 헤더도 정의합니다. MCP/API로 Static Site를 직접 생성하는 경우 YAML 전체가 자동 적용되는 것은 아니므로, 해당 헤더는 Blueprint 적용 또는 서비스 설정에서 별도로 반영해야 합니다.

### 무료 범위

2026-10-29 공식 문서 기준 Static Site 자체의 고정 서버 요금은 없습니다. 대역폭과 빌드 시간은 워크스페이스의 포함량을 공유하며, Hobby의 포함량은 월 대역폭 5GB와 빌드 500분입니다. 결제 수단이 등록된 워크스페이스에서는 포함량 초과 시 추가 비용이 발생할 수 있으므로 무제한 무료 서비스는 아닙니다. 유료 리소스나 결제 수단 추가, 사용 한도 증액은 이 배포의 범위에 포함하지 않습니다.

공식 자료:

- [Static Sites](https://render.com/docs/static-sites)
- [Outbound Bandwidth](https://render.com/docs/outbound-bandwidth)
- [Build Pipeline](https://render.com/docs/build-pipeline)
- [Blueprint YAML Reference](https://render.com/docs/blueprint-spec)

## 검증

`npm run check`로 TypeScript를 검사하고, `npm run build`로 정적 산출물을 만듭니다. 브라우저에서는 지출 저장·조회·수정·삭제, 기간 합계, 이미지/PDF 첨부·보기, 새로고침 후 기록 유지, 전체 백업·복원을 확인합니다. 예시 내역은 로컬 검증에만 사용하고 배포 소스에 실제 기록을 넣지 않습니다.

## 디자인

흰 배경과 짙은 청록색 포인트를 사용합니다. 기간·총액·내역·입력을 가까이 배치하고 소개 문구나 장식용 푸터를 넣지 않습니다.
