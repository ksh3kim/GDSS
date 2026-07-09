# 건프라 가이드 (Gunpla Guide) 🔍

건프라 전 제품을 정밀 분류하여 당신에게 맞는 제품을 추천하는 웹사이트입니다.
백엔드 없이 동작하는 정적(Static) 웹앱으로, 데이터는 JSON으로 관리됩니다.

> 이 문서는 실제 코드 기준으로 작성되었습니다 — 구현된 것, 부분 구현/미구현인 것, 정적 앱의 한계를 구분해 기술합니다.

## ✅ 구현된 기능

### 🔎 탐색 & 추천
- **25개 분류 카테고리**(`data/taxonomy.json`): 등급, 시리즈, 난이도, 가동성, 색분할, 프레임, 씰 의존도 등
- **추천 점수 정렬**: 필터 활성 시 가중치 기반 적합도 점수순 정렬(`js/recommendation.js`)
- **검색 & 자동완성(데스크톱)**: 제품명·기체명·형식번호, 한글 **초성 검색**, 검색 기록 저장
- **정렬**: 발매일·이름·가격·난이도·파츠수 (⚠️ 필터 활성 시에는 추천 점수 정렬이 우선 — 아래 한계 참고)
- **그리드/리스트 뷰 전환**, 24개 단위 "더 보기" 페이지네이션
- **URL 딥링크**: 필터·검색 상태가 URL 쿼리로 기록되어, 링크 공유/새로고침 시 최초 로드에서 복원

### 🎨 테마 시스템 (전 페이지 적용)
- **기본 3종**: 라이트 / 다크 / 트루 블랙(OLED)
- **건담 에디션 5종**: RX-78 · 샤아 전용 · 지온 · 유니콘 · 에반게리온 — 그라데이션·심볼·패턴 포함 비주얼 아이덴티티
- **커스텀 테마**: 포인트·강조·배경·카드·텍스트 색상 직접 지정(음영 자동 파생, 변경 즉시 미리보기)
- **FOUC 방지**: 페인트 이전에 저장된 테마 적용(양 페이지 `<head>` 인라인 스크립트)

### ⭐ 즐겨찾기 & 비교함
- 카드·상세페이지 토글, 배지 카운트, `localStorage` 영속화
- **상세 스펙 비교 테이블**: 3개 섹션(기본/조립/특성) 19개 항목, sticky 헤더/첫 열, 최고·최저 하이라이트, 열별 제거 버튼 (비교함은 카드 나열이 아닌 테이블 전용 뷰)
- **전체 초기화 버튼**: 푸터 하단 저시인성 배치, 확인 대화상자 후 실행
- **선택 해제 즉각 반영**: 즐겨찾기/비교함 탭에서 해제 시 목록·테이블 즉시 갱신
- **크로스탭 동기화**: `storage` 이벤트로 다른 탭의 변경 즉시 반영

### 🕒 최근 조회 제품
- 최대 10개, 중복 제거·최신순, 텍스트 없는 썸네일 스트립(메인·상세 상단)

### 📰 신제품 · 소식 (앱 내 알림 패널)
- 헤더 알림 벨 + 읽지 않음 배지, 패널 열람 시 읽음 처리
- **RSS 조회**: 페이지 접속 시(캐시 30분 경과 후)와 수동 새로고침(↻) 시 Bandai Hobby / GUNDAM.INFO 피드 확인
  - ⚠️ 상시 감시·백그라운드 폴링·푸시 알림이 **아님** — 열려 있는 페이지에서 조회한 시점의 소식만 표시
- **2단 수집 구조**: 자체 서버리스 API(`serverless/`) 우선 → 미배포 시 공개 CORS 프록시 폴백 → 전체 실패 시 캐시 표시

### 🌐 다국어 & 기타
- **한국어/영어** 클릭 즉시 전환(`data/i18n.json`) — 카드·필터·비교 테이블·알림 등 재렌더
- 상세페이지 → **반다이 공식 설명서** 검색 결과 링크(등급+형식번호 키워드)
- shadcn/ui 참고 정제: `:focus-visible` 링, press 피드백, disabled/selection 일관화
- 반응형(모바일/태블릿/데스크톱), 이미지 `loading="lazy"`, 카테고리 조회 O(1) Map 캐시

## 🚧 부분 구현 / 미구현

| 항목 | 상태 |
|------|------|
| **범위 필터** (출시연도·가동성·부품수·러너수) | UI(입력창+슬라이더)는 렌더되지만 **이벤트가 연결되지 않아 동작하지 않음** (`setRangeFilter`는 존재하나 호출부 없음) |
| **추천 설명 패널** | JS 함수만 존재, HTML 컨테이너(`recommendationPanel`) 없음 → 화면에 표시되지 않음 (점수 *정렬*은 동작) |
| **빠른 보기(Quick View) 모달** | `openQuickView` 함수만 존재, 진입 버튼·모달 마크업 없음 → 미동작 |
| **브라우저 뒤로가기 상태 복원** | URL은 `replaceState`로 갱신되지만 `popstate` 미처리 → 뒤로가기로 필터/탭 상태가 복원되지 않음 |
| **모바일 검색** | 검색어 적용만 지원 — 자동완성·검색 기록 UI 미지원(데스크톱 전용) |
| **필터 중 일반 정렬** | 필터 활성 시 추천 점수 정렬이 강제되어 정렬 셀렉트가 무시됨 |
| **자동화 테스트** | 없음 (아래 "테스트 방법"의 수동 체크리스트로 검증) |
| **접근성** | focus ring·aria-label 일부 적용. 탭 ARIA(role/aria-selected), 모달 포커스 트랩, 방향키 탐색 미적용 |
| **네이티브 alert/confirm** | 비교함 정원 초과·초기화 확인에 브라우저 기본 대화상자 사용(커스텀 토스트 미적용) |

## ⚠️ 정적 웹앱의 한계

- **백그라운드 동작 불가**: 페이지가 열려 있을 때만 코드 실행 — 주기적 수집·서버 푸시 불가
- **CORS**: 브라우저에서 외부 RSS를 직접 가져올 수 없음 → 서버리스 API 또는 공개 프록시 필요
- **서버 검색/DB 없음**: 모든 필터·검색·정렬은 클라이언트 메모리에서 수행(현재 50개 제품 규모에 최적화)
- **데이터 갱신 = 파일 편집**: 제품 추가/수정은 JSON 직접 편집 + `scripts/` 도구(수동 실행)
- **`file://` 직접 열기 제약**: `fetch()`가 차단되므로 반드시 로컬 HTTP 서버로 실행

## ☁️ 백엔드/서버리스 API가 필요한 기능

| 기능 | 상태 |
|------|------|
| RSS 수집·파싱·캐시 갱신 | ✅ **구현됨** — `serverless/worker.js` (Cloudflare Worker, 선택 배포). 미배포 시 공개 프록시 폴백 |
| 매뉴얼 ID 자동 해석(공식 사이트 스크래핑) | ❌ 미구현 — 현재는 공식 매뉴얼 *검색 결과* 링크로 대체 |
| 이미지 프록시/백업(외부 이미지 호스트 장애 대비) | ❌ 미구현 — 실패 시 로컬 플레이스홀더 표시만 |
| 가격/재고 등 외부 실데이터 연동 | ❌ 미구현 — 데이터는 정적 JSON |

## 아키텍처: 백엔드성 기능 분리

| 기능 | 계층 | 위치 |
|------|------|------|
| RSS 수집·파싱·캐시 갱신 | **서버리스 API** (런타임) | `serverless/worker.js` — `GET /api/news` |
| 반다이 매뉴얼 검색 | 공식 사이트 아웃바운드 링크 | `js/app.js` |
| 데이터 검증·ID 매핑 | 빌드 타임 스크립트 | `scripts/` |

### 서버리스 API 배포 (선택·권장)

```bash
cd serverless
npx wrangler deploy   # Cloudflare 계정 필요 (무료 플랜 가능)
```

배포 후 발급 URL을 `js/notifications.js`의 `API_BASE`에 입력하거나 HTML에서 `window.GUNPLA_API_BASE`로 지정하세요. 미설정 시 자동으로 프록시 폴백을 사용합니다. 상세: [serverless/README.md](serverless/README.md)

## 프로젝트 구조

```
GunList/
├── index.html              # 메인 (목록/필터/즐겨찾기/비교/알림)
├── detail.html             # 제품 상세 페이지
├── css/
│   ├── styles-base.css     # 토큰, 레이아웃, 공통 컴포넌트, 정제 레이어
│   ├── styles-components.css # 카드/필터 등 컴포넌트
│   └── styles-themes.css   # 테마별 비주얼 아이덴티티(그라데이션·심볼)
├── js/
│   ├── app.js              # 앱 코어(렌더/즐겨찾기/비교/최근조회)
│   ├── filter.js           # 필터·검색·자동완성·URL 상태
│   ├── recommendation.js   # 추천 점수 로직
│   ├── i18n.js             # 다국어 + 테마 관리
│   └── notifications.js    # RSS 소식 패널 (API 우선 + 프록시 폴백)
├── data/
│   ├── gunpla-index.json   # 제품 목록 (스키마: 아래 참고)
│   ├── gunpla-details/     # 제품별 상세 JSON
│   ├── taxonomy.json       # 분류 카테고리/라벨(ko·en)
│   └── i18n.json           # UI 번역
├── scripts/                # 데이터 유지보수 스크립트 (빌드 타임, Node 필요)
└── serverless/             # 서버리스 API 계층 — RSS 수집·캐시 (Cloudflare Worker)
```

## 실행 방법

정적 사이트이므로 로컬 HTTP 서버로 열어야 합니다 (`file://` 직접 열기는 `fetch` 차단으로 동작하지 않음).

```bash
# 방법 1: Python 내장 서버
python -m http.server 8000

# 방법 2: Node
npx serve .

# 방법 3: VS Code "Live Server" 확장 → index.html 우클릭 → Open with Live Server
```

이후 브라우저에서 `http://localhost:8000` 접속.

## 테스트 방법

**자동화 테스트는 아직 없습니다.** 변경 후 아래 수동 체크리스트로 검증하세요.

### 수동 검증 체크리스트
1. **탐색**: 필터 2~3개 선택 → 결과 수 변화, 점수순 정렬 확인 / 검색(초성 포함) / 정렬·뷰 전환
2. **즐겨찾기/비교**: 카드·상세에서 토글 → 배지·버튼 상태 / 비교함 탭에서 테이블 표시·열 제거 / 탭 두 개 열고 크로스탭 동기화
3. **테마/언어**: 8종 테마 순회 + 커스텀 색상 변경 → 새로고침 후 유지 / KO↔EN 전환 시 전 영역 갱신
4. **알림**: 벨 클릭 → 목록/읽음 처리, ↻ 새로고침 (네트워크·프록시 상태에 따라 실패 가능 — 캐시 폴백 확인)
5. **상태 유지**: 새로고침·상세→홈 복귀 후 즐겨찾기/비교/최근조회 유지
6. **반응형**: 375px/768px/1280px에서 헤더·카드·비교 테이블 겹침 없음

### 서버리스 API 로컬 테스트 (Node 필요)
```bash
cd serverless && npx wrangler dev
curl http://127.0.0.1:8787/api/health
curl "http://127.0.0.1:8787/api/news?limit=5"
```

### 데이터 스크립트 (Node 필요)
`scripts/apply-bandai-ids.js`, `scripts/update-model-numbers.js` — 실행 전 각 파일 상단 주석 참고.

## 데이터 스키마

### `data/gunpla-index.json`
```jsonc
{
  "meta": { "version": "1.0.0", "totalCount": 50, "lastUpdated": "YYYY-MM-DD" },
  "products": [{
    "id": "hg-rx-78-2-revive",        // 고유 슬러그 (상세 JSON 파일명과 일치)
    "baseProductId": "rx-78-2",       // 동일 기체 변형 묶음 키
    "name": { "ko": "...", "en": "..." },
    "modelNumber": "RX-78-2",
    "grade": "HG", "scale": "1/144", "series": "first_gundam",  // taxonomy 옵션 value
    "releaseYear": 2015, "releaseLine": "standard",
    "isRevive": true, "isVerKa": false,
    "thumbnail": "https://gunpla.fyi/images/boxarts/196",       // 외부 이미지 (매뉴얼 ID 아님)
    "price": 1100,                    // 엔화 정수
    "height": "약 130mm",             // 표시용 문자열 (숫자 아님 주의)
    "tags": ["beginner", "iconic"],
    "filterData": {                   // 필터/비교에 사용
      "difficulty": "beginner",       // beginner|intermediate|advanced
      "mobility": 4,                  // 1~5
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

### `data/gunpla-details/{id}.json`
```jsonc
{
  // index와 공통: id, baseProductId, name, modelNumber, series, grade, scale,
  // releaseYear, releaseLine, isRevive, isVerKa, price, height
  "pilot": "아무로 레이", "manufacturer": "지구연방군",
  "releaseMonth": 3,
  "images": { "boxart": "https://...", "gallery": [] },
  "fullSpecs": { /* filterData와 유사 필드 — ⚠️ 필드명 혼용 있음(표준화 예정) */ },
  "weapons": ["빔 라이플"], "accessories": [],
  "pros": ["..."], "cons": ["..."],
  "recommendation": "...", "buildingTips": "...",
  "lastUpdated": "YYYY-MM-DD"
}
```
상세 JSON이 없는 제품은 index 데이터로 폴백 렌더됩니다.

### `data/taxonomy.json`
```jsonc
{
  "version": "...", "lastUpdated": "...",
  "categories": [{
    "id": "grade",
    "label": { "ko": "등급 (Grade)", "en": "Grade" },
    "type": "single",            // single | multiple | range | boolean
    "options": [{ "value": "HG", "label": { "ko": "...", "en": "..." } }],
    // type=range 카테고리(releaseYear·mobility·partCount·runnerCount)는
    // options 대신 min / max / step 사용
  }]
}
```

### `data/i18n.json`
```jsonc
{ "translations": { "ko": { "nav": {...}, "search": {...}, "compare": {...}, "notif": {...}, "footer": {...}, ... },
                    "en": { /* 동일 키 구조 */ } } }
```
HTML에서 `data-i18n="키.경로"` / `data-i18n-placeholder`로 바인딩됩니다.

## localStorage 키

| 키 | 용도 |
|----|------|
| `gunpla-lang` | 언어(ko/en) |
| `gunpla-theme` | 테마 이름 |
| `gunpla-theme-custom` | 커스텀 테마 색상 JSON |
| `gunpla-favorites` | 즐겨찾기 제품 id 배열 |
| `gunpla-compare` | 비교함 제품 id 배열(최대 4) |
| `gunpla-recent-viewed` | 최근 조회 id 배열(최대 10) |
| `gunpla-search-history` | 검색 기록 |
| `gunpla-news-cache` | 소식 캐시 `{ts, items}` (TTL 30분) |
| `gunpla-news-seen` | 마지막 읽음 시각(ms) |

## 라이선스

이 프로젝트는 팬 제작 비공식 프로젝트입니다.
건프라 및 관련 상표는 BANDAI SPIRITS의 등록상표입니다.

---

Made with ❤️ for Gunpla enthusiasts
