# 건프라 가이드 (Gunpla Guide)

건프라 키트 47종을 25개 기준(등급·시리즈·난이도·가동성·색분할 등)으로 분류해, 조건에 맞는 키트를 찾고 비교할 수 있게 해 주는 웹앱입니다.

- 앱 본체는 **정적 웹앱**입니다. HTML·CSS·JS와 JSON 데이터만으로 동작하며, 서버 없이 아무 정적 호스팅에 올릴 수 있습니다.
- 브라우저만으로는 할 수 없는 일(외부 사이트 소식 수집, 매뉴얼 검색, 캐시 갱신)은 **선택형 서버리스 API**(`serverless/`, Cloudflare Worker)가 맡습니다.
  API를 배포·설정하지 않아도 앱은 동작하고, 소식 패널만 "API 미설정" 안내로 바뀝니다.
- 데이터 검증과 매뉴얼 ID 기록은 **빌드 타임 스크립트**(`scripts/`)가 맡습니다.

이 문서는 실제 코드 기준입니다. 구현된 기능, 미구현·부분 구현, 알려진 데이터 문제를 구분해 적었습니다.

---

## 구현된 기능

### 탐색
- **필터 25종** (`data/taxonomy.json`) — 선택형 21종(단일 13 · 복수 4 · 예/아니오 4)과 범위형 4종(발매 연도 · 가동성 · 파츠 수 · 러너 수, 최소~최대 입력).
  선택한 필터는 칩으로 표시되고 개별 제거할 수 있습니다.
- **검색** — 한글·영문 제품명, 형식번호, 등급, 제품 id, 시리즈 내부 값(`seed`, `00` 등). 한글 **초성 검색**(예: `ㅇㄴㅋ` → 유니콘) 지원.
  데스크톱은 자동완성(제품·형식번호·시리즈·검색 기록)과 키보드 탐색을 제공합니다. 검색 기록은 Enter·검색 버튼·제안 선택으로 검색했을 때만 저장됩니다(최대 10개).
- **정렬** — 발매일 · 이름 · 가격 · 난이도 · 파츠 수, 오름/내림차순.
  필터가 켜져 있으면 일치 점수가 높은 제품이 먼저 오고, 같은 점수 안에서는 선택한 정렬을 따릅니다.
  (필터는 모든 조건을 만족하는 제품만 남기므로, 점수 차이는 "추천 대상"처럼 값이 여러 개인 항목에서만 생깁니다.)
- **그리드/리스트 보기**, 24개 단위 "더 보기".
- **URL 상태** — 검색어·필터·화면(홈/즐겨찾기/비교함)이 주소에 기록됩니다. 새로고침·링크 공유·뒤로가기/앞으로가기로 같은 상태가 복원됩니다. ([URL 파라미터](#url-파라미터) 참고)

### 즐겨찾기 · 비교함 · 최근 본 제품
- 카드와 상세 페이지에서 즐겨찾기/비교함 토글, 헤더에 개수 배지.
- **비교함**(최대 4개) — 하단 서랍에서 "비교하기"를 누르면 비교 화면으로 이동합니다.
  비교 화면은 3개 섹션 19개 항목의 스펙 표입니다(첫 열·머리글 고정, 최고·최저 값 강조, 열별 제거).
- **최근 본 제품** — 상세 페이지를 연 제품 최대 10개를 썸네일 줄로 표시(메인·상세 공통).
- 푸터의 "즐겨찾기 비우기 / 비교함 비우기"는 확인 대화상자를 거쳐 실행됩니다.
- 모든 상태는 `localStorage`에 저장되며, 다른 탭에서 바꾼 내용도 즉시 반영됩니다.

### 상세 페이지 (`detail.html?id=<제품 id>`)
- 박스아트, 등급·Ver.Ka·Revive 배지, 가격·발매일·높이, 스펙 8항목, 무장·부속품, 추천 대상, 조립 팁.
- **바리에이션 탭** — 같은 기체의 다른 버전·다른 등급. 데이터가 있는 5개 제품에서만 탭이 보이고, 목록에 없는 키트는 "상세 정보 미등록"으로 표시됩니다.
- **반다이 공식 매뉴얼 버튼** — 연결 대상은 아래 순서로 정해집니다.
  1. 데이터에 `bandaiManualId`가 있으면 해당 매뉴얼 페이지
  2. 서버리스 API가 설정되어 있으면 API가 찾은 매뉴얼 페이지 (브라우저에 30일 캐시)
  3. 둘 다 없으면 공식 사이트 검색 결과 (형식번호 또는 이름의 특징 단어 + 등급 카테고리로 필터)
- 없는 id로 들어오면 "제품을 찾을 수 없습니다" 화면을 보여 줍니다.

### 신제품 · 소식 패널 (헤더의 알림 벨)
- 서버리스 API(`GET /api/news`)가 **Bandai Hobby**와 **GUNDAM OFFICIAL**의 소식 페이지를 읽어 합친 목록을 보여 줍니다.
  항목에는 `신제품`·`예약` 라벨이 붙고, 읽지 않은 개수가 배지로 표시되며, 패널을 열면 읽음 처리됩니다.
- 페이지를 열 때(마지막 조회 후 30분이 지났으면)와 ↻ 버튼을 눌렀을 때만 조회합니다.
  **상시 감시·백그라운드 폴링·푸시 알림이 아닙니다.** 브라우저가 닫혀 있으면 알림이 오지 않습니다.
- API를 설정하지 않으면 요청을 보내지 않고, "API 미설정" 안내와 공식 소식 페이지 링크를 보여 줍니다.

### 화면 · 테마 · 언어
- **테마 9종** — 기본(다크·라이트·트루 블랙), 건담 에디션(RX-78·샤아 전용·지온·유니콘), 특별 에디션(에반게리온), 커스텀(포인트·강조·배경·카드·텍스트 색 직접 지정).
  저장된 테마는 화면이 그려지기 전에 적용되고(깜빡임 방지), 다른 탭에도 반영됩니다.
- **한국어/영어** 즉시 전환 — 제품명·필터·비교표·상세·알림·버튼 설명까지 다시 그리고, `<html lang>`도 바꿉니다. 브라우저 언어로 첫 언어를 정합니다.
- **반응형**
  - 1024px 이하: 필터가 슬라이드 패널(닫기 버튼·배경 클릭·Esc)로 바뀌고, 메뉴 링크·테마·언어가 햄버거 메뉴로 들어갑니다.
  - 768px 이하: 헤더 검색창 대신 메뉴 안 검색창을 씁니다.
- **접근성** — 필터 옵션·탭·메뉴의 키보드 조작, `aria-expanded`/`aria-pressed`/`aria-selected` 상태 표시, 상세 탭 방향키 이동, 포커스 링, 터치 화면에서 카드 버튼 항상 표시.

---

## 미구현 · 부분 구현

| 항목 | 현재 상태 |
|------|------|
| 추천 설명 패널 | 로직(`showRecommendationPanel`, `generateExplanation` 등)만 있고 화면 마크업이 없어 표시되지 않음 |
| 빠른 보기(Quick View) 모달 | `openQuickView`와 모달 CSS만 있고 진입 버튼·마크업이 없어 동작하지 않음 |
| 상세 페이지 장단점 · 추천 이유 | 상세 JSON에 `pros`/`cons`/`recommendation.reasoning` 데이터가 있지만 표시하는 마크업이 없음 |
| 이미지 갤러리 | 이전/다음·썸네일 UI는 있으나 모든 제품의 `images.gallery`가 비어 있어 박스아트 1장만 표시 |
| 자동완성의 시리즈 제안 | **버그** — "건담 SEED" 같은 시리즈 이름을 고르면 검색어로 그 이름이 들어가는데, 검색은 시리즈 내부 값(`seed`)과 비교하므로 결과가 0건. 시리즈로 좁히려면 필터의 "세계관/작품"을 사용 |
| 모바일 검색 | 검색은 되지만 자동완성·검색 기록 목록은 데스크톱 전용 |
| 정렬 · 보기 방식 저장 | 필터·검색·화면은 URL에 남지만, 정렬 기준과 그리드/리스트 선택은 새로고침하면 기본값으로 돌아감 |
| 매뉴얼 ID 데이터 | 47개 중 0개 기록됨. `scripts/resolve-manual-ids.mjs --write`로 확실한 매칭만 기록 가능(시험 실행 기준 36개) |
| "NEW" 배지 | `releaseYear ≥ 2024`로 고정된 기준 |
| 대화상자 | 비교함 정원 초과·초기화 확인에 브라우저 기본 `alert`/`confirm` 사용 |
| 프론트엔드 자동화 테스트 | 없음. 데이터 검증과 서버리스 API는 자동 테스트가 있음([테스트](#테스트) 참고) |

## 알려진 데이터 문제

`node scripts/validate-data.mjs`가 현재 **오류 3건 · 경고 9건**을 보고합니다(CI도 이 때문에 실패합니다).

- **오류** — 인덱스와 상세 파일의 값 불일치. 어느 쪽이 맞는지 확인 후 한쪽을 고쳐야 합니다.
  - `hg-strike-freedom` · `hg-zaku-ii`: `isRevive` (상세 `false` / 인덱스 `true`)
  - `hg-wing-zero-ew`: `price` (상세 1540 / 인덱스 1650)
- **썸네일 매핑** — 일부 제품의 gunpla.fyi 이미지 번호가 다른 키트를 가리킵니다(예: `hg-rising-freedom`에 MG 릭 돔 박스아트).
  검증된 매핑이 필요합니다(`scripts/bandai-id-mapping.csv`의 `current_thumbnail_id` 열 참고).
- **상세 박스아트** — 42개 상세 파일의 `images.boxart`가 숫자 id가 아닌 슬러그 주소라서 열리지 않습니다. 화면은 인덱스 썸네일로 대체해 표시합니다.
- **스펙 값 형식** — 상세 `fullSpecs`의 `runnerColors`(숫자) 등 일부 값이 분류 옵션(`"1"`, `"2-3"`, `"4+"`)과 형식이 다릅니다.
- 바리에이션·다른 등급 링크 11개가 목록에 없는 키트를 가리킵니다("상세 정보 미등록"으로 표시).

---

## 정적 웹앱의 한계

- **백그라운드 실행 불가** — 코드는 페이지가 열려 있을 때만 돕니다. 주기적 수집이나 푸시 알림은 서버가 필요합니다.
- **CORS** — 브라우저는 다른 사이트의 페이지를 직접 읽을 수 없습니다. 그래서 소식 수집과 매뉴얼 검색은 서버리스 API가 합니다.
- **서버 검색·DB 없음** — 필터·검색·정렬은 모두 브라우저 메모리에서 처리합니다. 47개 규모에서는 문제가 없지만, 수천 개로 늘면 서버 검색이 필요합니다.
- **사용자 데이터는 이 브라우저에만** — 즐겨찾기·비교함·최근 본 제품은 `localStorage`에 있어서 다른 기기와 동기화되지 않고, 브라우저 데이터를 지우면 사라집니다.
- **데이터 갱신 = 파일 편집** — 제품 추가·수정은 JSON을 직접 고친 뒤 검증 스크립트를 돌려야 합니다.
- **외부 이미지 의존** — 박스아트는 gunpla.fyi에서 불러오며, 실패하면 `images/placeholder.png`를 표시합니다.
- **`file://`로 열 수 없음** — `fetch()`가 막히므로 반드시 HTTP 서버로 열어야 합니다.

## 백엔드 · 서버리스 API가 필요한 기능

| 기능 | 상태 | 위치 |
|------|------|------|
| 소식 수집·병합·분류 | 구현됨 (배포·설정 필요) | `serverless/` — `GET /api/news` |
| 소식 캐시 사전 갱신 | 구현됨 (KV 설정 시 동작) | `serverless/` — Cron 15분 + Workers KV |
| 반다이 매뉴얼 페이지 찾기 | 구현됨 | 런타임: `GET /api/manual` · 빌드 타임: `scripts/resolve-manual-ids.mjs` |
| 데이터 검증 | 구현됨 | `scripts/validate-data.mjs` + GitHub Actions |
| 푸시 알림 (브라우저를 닫아도 알림) | 미구현 | 구독 저장 서버 + 서비스 워커(Web Push) 필요 |
| 즐겨찾기 기기 간 동기화 · 계정 | 미구현 | 사용자 DB·인증 필요 |
| 이미지 프록시·백업 | 미구현 | 외부 이미지 장애 시 대체 이미지만 표시 |
| 가격·재고 실데이터 | 미구현 | 데이터는 정적 JSON(가격은 엔화 정가) |

엔드포인트 응답 형식, 캐시 정책, 배포 방법은 [serverless/README.md](serverless/README.md)에 있습니다.

---

## 실행 방법

### 앱 실행
정적 파일만 있으면 되므로 아무 HTTP 서버로 저장소 루트를 열면 됩니다.

```bash
python -m http.server 8000
# → http://localhost:8000
```

VS Code를 쓴다면 "Live Server" 확장으로 `index.html`을 열어도 됩니다.
지원 브라우저는 최신 Chrome · Edge · Firefox · Safari입니다(옵셔널 체이닝, `:focus-visible`, `color-mix()` 사용).

### 서버리스 API 연결 (선택)

```bash
cd serverless
npx wrangler deploy        # Cloudflare 계정 필요 (무료 플랜 가능)
```

발급된 주소를 [js/api.js](js/api.js)의 `API_BASE`에 넣거나, HTML에서 앱 스크립트보다 먼저 지정합니다.

```html
<script>window.GUNPLA_API_BASE = 'https://gunpla-guide-api.<your-subdomain>.workers.dev';</script>
```

소식 사전 갱신(Cron + KV)까지 쓰려면 `npx wrangler kv namespace create NEWS_CACHE`로 KV를 만들고, 나온 id를 `serverless/wrangler.toml`의 주석 처리된 `[[kv_namespaces]]`에 넣은 뒤 다시 배포합니다.

### 로컬에서 API까지 함께 실행

```bash
# 터미널 1 — 앱
python -m http.server 8000
# 터미널 2 — API
cd serverless && npx wrangler dev        # → http://127.0.0.1:8787
```

그다음 `js/api.js`의 `API_BASE`를 `'http://127.0.0.1:8787'`로 바꾸거나, 브라우저 개발자 도구에서 페이지 스크립트보다 먼저 `window.GUNPLA_API_BASE`를 지정합니다.

---

## 테스트

Node.js 22 이상이 필요합니다(테스트 파일 glob 패턴). 외부 패키지 의존성은 없습니다.

```bash
npm test                 # 데이터 검증 + 서버리스 API 테스트 (현재 데이터 오류 3건 때문에 실패)
npm run validate         # 데이터 검증만      = node scripts/validate-data.mjs
npm run test:api         # 서버리스 API 테스트 = cd serverless && node --test "test/*.test.js"
```

- **데이터 검증**(`scripts/validate-data.mjs`) — 인덱스 형식·id 중복·분류 값 유효성·썸네일 주소, 인덱스와 상세 파일의 일치,
  번역 키의 한/영 짝과 HTML·JS에서 쓰는 키의 존재를 검사합니다. 오류가 있으면 종료 코드 1을 반환합니다. `--json`으로 기계용 출력, `--strict`로 경고도 실패 처리.
- **서버리스 API 테스트**(26개) — 소식 페이지 파싱, 매뉴얼 검색 결과 파싱·판정, 라우팅, KV·엣지 캐시 동작을 네트워크 없이(fixture) 검사합니다.
- **CI** — `.github/workflows/backend-checks.yml`이 `data/`, `scripts/`, `serverless/`, `js/`, HTML 변경 시 위 두 가지를 실행합니다.

### 프론트엔드 수동 점검
프론트엔드는 자동 테스트가 없으므로, 화면을 바꾼 뒤 아래를 확인합니다.

1. **탐색** — 선택형·범위형 필터, 칩 제거, 초성 검색, 정렬·오름/내림, 그리드/리스트, 더 보기
2. **화면 이동** — 즐겨찾기·비교함 화면 이동 → 뒤로가기/앞으로가기/새로고침 후 같은 화면
3. **즐겨찾기·비교** — 카드·상세에서 토글, 비교 서랍의 "비교하기", 비교표 열 제거, 두 탭을 열어 동기화 확인
4. **테마·언어** — 9종 테마와 커스텀 색 변경 후 새로고침, KO↔EN 전환 시 상세 페이지 내용까지 바뀌는지
5. **상세** — 매뉴얼 버튼 주소, 바리에이션 탭, 없는 id(`detail.html?id=x`)의 안내 화면
6. **반응형** — 375 / 768 / 1024 / 1280px에서 헤더·필터 패널·알림 패널·비교 서랍이 겹치지 않는지
7. **콘솔** — 위 과정에서 오류가 없는지

---

## 데이터 관리 스크립트

모두 저장소 루트에서 실행합니다.

| 스크립트 | 하는 일 |
|------|------|
| `node scripts/validate-data.mjs` | 데이터 검증 (위 "테스트" 참고) |
| `node scripts/resolve-manual-ids.mjs [--write] [--only id,id] [--force]` | 반다이 매뉴얼 사이트에서 각 제품의 매뉴얼을 찾아, 확실한 경우만 `bandaiManualId`로 기록. 기본은 미리 보기 |
| `node scripts/apply-bandai-ids.js` | `scripts/bandai-id-mapping.csv`에 직접 입력한 매뉴얼 id를 데이터에 기록 |
| `node scripts/update-model-numbers.js` | 스크립트 안의 고정 표로 인덱스의 `modelNumber`를 덮어씀. **상세 파일은 바꾸지 않으므로** 실행 후 검증 스크립트가 불일치를 보고할 수 있음 |
| `scripts/fix-data-consistency.ps1` | 상세 파일에 빠진 기본 필드를 채우는 PowerShell 스크립트. **경로가 특정 PC 절대 경로로 고정**되어 있어 그대로는 다른 환경에서 동작하지 않음 |

매뉴얼 id 작업 방법은 [scripts/README-mapping.md](scripts/README-mapping.md)에 있습니다.

---

## 프로젝트 구조

```
GunList/
├── index.html                 # 메인: 목록·필터·즐겨찾기·비교·알림
├── detail.html                # 제품 상세
├── css/
│   ├── styles-base.css        # 디자인 토큰, 테마 변수, 레이아웃, 헤더·필터·비교표
│   ├── styles-components.css  # 카드, 필터 옵션, 상세 페이지, 비교 서랍
│   └── styles-themes.css      # 테마별 장식(그라데이션·패턴·심볼)
├── js/
│   ├── api.js                 # 서버리스 API 클라이언트 (API 주소 설정 위치)
│   ├── i18n.js                # 다국어 + 테마 관리
│   ├── filter.js              # 필터·검색·자동완성·URL 상태
│   ├── recommendation.js      # 일치 점수 계산
│   ├── app.js                 # 화면 렌더링, 즐겨찾기·비교·최근 본 제품, 상세 페이지
│   └── notifications.js       # 신제품·소식 패널
├── data/
│   ├── gunpla-index.json      # 제품 목록 (47개)
│   ├── gunpla-details/        # 제품별 상세 JSON (id.json, 47개)
│   ├── taxonomy.json          # 필터 카테고리·옵션·라벨
│   └── i18n.json              # UI 번역 (ko/en)
├── images/placeholder.png     # 이미지 실패 시 대체 이미지
├── scripts/                   # 빌드 타임 도구 (Node.js)
├── serverless/                # 서버리스 API (Cloudflare Worker)
│   ├── worker.js              # 라우팅 · 캐시 · Cron
│   ├── lib/                   # news.js · manual.js · net.js
│   └── test/                  # node:test 테스트 + fixture
├── .github/workflows/         # CI: 데이터 검증 + API 테스트
└── package.json               # npm 스크립트만 (의존성 없음)
```

---

## 데이터 스키마

### `data/gunpla-index.json` — 목록·필터·비교에 쓰는 요약 데이터

```jsonc
{
  "meta": { "version": "1.0.0", "totalCount": 47, "lastUpdated": "2026-01-10" },  // totalCount = products 개수
  "products": [{
    "id": "hg-rx-78-2-revive",            // 소문자 슬러그, 상세 파일명과 같음
    "baseProductId": "rx-78-2",           // 같은 기체 묶음 키
    "name": { "ko": "RX-78-2 건담", "en": "RX-78-2 Gundam" },
    "modelNumber": "RX-78-2",
    "bandaiManualId": "1004",             // 선택. 반다이 매뉴얼 id(숫자 문자열) — 이미지 번호와 다른 체계
    "grade": "HG",                        // taxonomy 'grade' 옵션 값
    "scale": "1/144",                     // taxonomy 'scale'
    "series": "first_gundam",             // taxonomy 'series'
    "releaseYear": 2015,                  // 정수
    "releaseLine": "standard",            // taxonomy 'releaseLine'
    "isRevive": true, "isVerKa": false,
    "thumbnail": "https://gunpla.fyi/images/boxarts/196",  // gunpla.fyi 숫자 id (".jpeg"는 앱이 붙임)
    "price": 1100,                        // 엔화 정가, 양의 정수
    "height": "약 130mm",                 // 표시용 문자열
    "tags": ["beginner", "iconic"],       // 카드에 앞 3개 표시
    "filterData": {                       // 필터·정렬·비교표에 쓰는 값 (모두 taxonomy 옵션 값)
      "difficulty": "beginner",           // beginner | intermediate | advanced
      "mobility": 4,                      // 1~5
      "frameType": "partial", "partCount": 138, "runnerCount": 7,
      "runnerColors": "4+", "weaponCount": "standard",
      "sealDependency": "partial", "clearParts": "none",
      "coatingParts": false, "transformation": false,
      "colorSeparation": "high", "sizeFeeling": "normal",
      "recommendedUser": ["beginner", "posing"]
    }
  }]
}
```

필터는 `product[카테고리 id]`를 먼저, 없으면 `filterData[카테고리 id]`를 봅니다.

### `data/gunpla-details/{id}.json` — 상세 페이지 데이터

```jsonc
{
  // 인덱스와 같아야 하는 필드 (검증 스크립트가 확인):
  // id, name, grade, scale, series, releaseYear, price, modelNumber,
  // releaseLine, isRevive, isVerKa, bandaiManualId
  "baseProductId": "aerial", "height": "13cm",
  "pilot": { "ko": "슬레타 머큐리", "en": "Suletta Mercury" },
  "manufacturer": { "ko": "신세이 개발공사", "en": "Shinsei Development" },
  "releaseMonth": 10,                                    // 1~12
  "images": { "boxart": "https://gunpla.fyi/images/boxarts/129.jpeg", "gallery": [] },
  "fullSpecs": { "partCount": 165, "difficulty": "beginner", "mobility": 4, "...": "..." },
  "weapons":      { "ko": ["빔 라이플"], "en": ["Beam Rifle"] },
  "accessories":  { "ko": [], "en": [] },                // 선택
  "pros":         { "ko": ["..."], "en": ["..."] },      // 현재 화면에 표시되지 않음
  "cons":         { "ko": ["..."], "en": ["..."] },      // 현재 화면에 표시되지 않음
  "buildingTips": { "ko": ["..."], "en": ["..."] },
  "recommendation": {
    "matchTags": ["beginner"], "matchScore": 88,         // 현재 화면에 표시되지 않음
    "reasoning": { "ko": "...", "en": "..." },           // 현재 화면에 표시되지 않음
    "perfectFor": { "ko": ["..."], "en": ["..."] }
  },
  "variants": [                                          // 선택 (5개 제품)
    { "id": "hg-aerial-permet-score6", "variantType": "special",
      "name": { "ko": "...", "en": "..." }, "releaseLine": "p_bandai" }
  ],
  "relatedGrades": [                                     // 선택 (5개 제품)
    { "id": "fm-aerial", "grade": "FM", "name": { "ko": "...", "en": "..." } }
  ],
  "lastUpdated": "2026-01-10"
}
```

- 인덱스에 있는 id만 상세 페이지가 열립니다. 상세 파일을 못 불러오면 인덱스 데이터로 표시합니다.
- 스펙 표에는 `fullSpecs`(없으면 `filterData`)의 파츠 수·러너 수·난이도·가동성·프레임·색분할·씰 의존도·변형 8항목이 나옵니다.

### `data/taxonomy.json` — 필터 정의

```jsonc
{
  "version": "...", "lastUpdated": "...",
  "categories": [
    { "id": "grade", "type": "single",                  // single | multiple | boolean | range
      "label": { "ko": "등급 (Grade)", "en": "Grade" },
      "options": [{ "value": "HG", "label": { "ko": "HG (High Grade)", "en": "HG (High Grade)" } }] },
    { "id": "releaseYear", "type": "range",              // range는 options 대신 min/max/step
      "label": { "ko": "발매 연도", "en": "Release Year" }, "min": 1980, "max": 2026, "step": 1 }
  ]
}
```

### `data/i18n.json` — UI 번역

```jsonc
{ "translations": { "ko": { "nav": { "home": "홈" }, "...": {} },
                    "en": { /* ko와 같은 키 구조 */ } } }
```

HTML에서는 `data-i18n`(텍스트), `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-aria-label` 속성으로 연결하고, JS에서는 `I18n.t('키.경로')`로 씁니다.
한/영 키가 짝이 맞는지, 쓰는 키가 모두 있는지는 검증 스크립트가 확인합니다.

---

## URL 파라미터

| 페이지 | 파라미터 | 예 |
|------|------|------|
| `index.html` | `q` — 검색어 | `?q=유니콘` |
| | `<카테고리 id>` — 선택값(쉼표 구분) | `?grade=RG,MG&isVerKa=true` |
| | `<범위 카테고리 id>` — `최소-최대` | `?releaseYear=2010-2015` |
| | `view` — `favorites` \| `compare` | `?view=compare` |
| `detail.html` | `id` — 제품 id | `?id=rg-rx-78-2` |

## localStorage 키

| 키 | 내용 |
|----|------|
| `gunpla-lang` | 언어 (`ko` / `en`) |
| `gunpla-theme` | 테마 이름 |
| `gunpla-theme-custom` | 커스텀 테마 색상 |
| `gunpla-favorites` | 즐겨찾기 제품 id 배열 |
| `gunpla-compare` | 비교함 제품 id 배열 (최대 4) |
| `gunpla-recent-viewed` | 최근 본 제품 id 배열 (최대 10) |
| `gunpla-search-history` | 검색 기록 (최대 10) |
| `gunpla-news-cache` | 소식 목록 캐시 `{ ts, items }` (30분) |
| `gunpla-news-seen` | 마지막으로 읽은 소식 시각(ms) |
| `gunpla-manual-cache` | 제품별 매뉴얼 페이지 조회 결과 (찾음 30일 / 못 찾음 1일) |

---

## 라이선스

팬이 만든 비공식 프로젝트입니다. 건프라 및 관련 상표는 BANDAI SPIRITS의 등록상표이며,
소식·매뉴얼 링크는 각 공식 사이트로 연결됩니다.
