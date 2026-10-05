# Gunpla Guide — Serverless API

정적 웹앱에서 분리된 **런타임 백엔드 계층**입니다 (Cloudflare Worker).
브라우저에서 직접 할 수 없거나(CORS), 매 방문자마다 반복하면 낭비인 작업을 서버에서 처리합니다.

| 기능 | 엔드포인트 / 트리거 | 하는 일 |
|------|------|------|
| 신제품·소식 알림 | `GET /api/news` | Bandai Hobby · GUNDAM OFFICIAL 소식 페이지 수집 → 파싱 → 병합 → 정렬·중복 제거 → 신제품/예약/소식 분류 |
| 캐시 갱신 | Cron Trigger (15분) | 소식을 미리 수집해 Workers KV에 스냅샷 저장 |
| 반다이 매뉴얼 검색 | `GET /api/manual` | 공식 매뉴얼 사이트를 서버에서 검색하고, 해당 키트의 매뉴얼 페이지를 판정 |
| 상태 확인 | `GET /api/health` | 생존 확인 + 소식 캐시 상태 |

데이터 검증과 매뉴얼 ID 일괄 기록은 런타임이 아니라 **빌드 타임 계층**(`scripts/`)이 맡습니다 — [계층 경계](#계층-경계) 참고.

## 엔드포인트

### `GET /api/news?limit=20`

`limit` 1~50. 응답:

```json
{
  "ok": true,
  "fetchedAt": 1770000000000,
  "cache": "kv",
  "sources": [{ "name": "Bandai Hobby", "ok": true, "count": 10 }],
  "items": [{ "title": "...", "link": "https://...", "ts": 0, "source": "...", "icon": "🆕", "img": "", "kind": "product" }]
}
```

- 공식 사이트들은 더 이상 RSS를 제공하지 않습니다 (`bandai-hobby.net/feed/`는 404 페이지, `en.gundam.info/rss`는 홈으로 이동).
  그래서 소스마다 읽는 방식을 지정합니다 (`lib/news.js`의 `SOURCES`):
  - **Bandai Hobby** `https://bandai-hobby.net/news/` — 서버 렌더링된 소식 목록 HTML (태그: 新商品 → `product`, オンラインショップ → `shop`, トピックス → `news`)
  - **GUNDAM OFFICIAL** `https://en.gundam-official.com/news` — Next.js 페이지에 포함된 데이터(`newsResponse.data`). GUNPLA 카테고리 중 출시·라인업 글 → `product`, 예약 → `shop`
  - `rss` 타입 — 일반 RSS 2.0 / Atom 피드를 소스로 추가할 때 사용
- 사이트 구조가 바뀌어 항목을 하나도 못 읽으면 그 소스는 `ok:false, error:"no_items_parsed"`로 보고되고 나머지 소스로 응답합니다.

- `cache`: `kv`(Cron이 저장한 스냅샷) · `live`(방금 수집) · `kv-stale`(업스트림 장애로 오래된 스냅샷 제공)
- 최신순 정렬, 링크 기준 중복 제거, `http(s)` 외 링크는 서버에서 제거
- 소스별 타임아웃 8초 + 1회 재시도, 한쪽 소스가 죽어도 나머지로 응답
- 모든 소스 실패 + 저장된 스냅샷도 없을 때만 `502 { ok:false, error:"all_feeds_failed" }` (실패 응답은 캐시하지 않음)

### `GET /api/manual?grade=RG&model=RX-78-2&name=RX-78-2%20Gundam&year=2010`

`name`(영문명) 또는 `model`(형식번호) 중 하나는 필수. 응답:

```json
{
  "ok": true,
  "match": { "id": "656", "url": "https://manual.bandai-hobby.net/menus/detail/656",
             "nameEn": "RG 1/144 RX-78-2 GUNDAM", "nameJa": "RG 1/144 RX-78-2 ガンダム",
             "releaseYear": 2010, "score": 1.15 },
  "candidates": [ "...상위 5개 후보..." ],
  "searchUrl": "https://manual.bandai-hobby.net/menus?freeword=RX-78-2&categories%5B%5D=10"
}
```

- 매뉴얼 사이트에는 API가 없어서, 서버가 검색 결과 HTML(`/menus?freeword=…&categories[]=…`)을 받아 파싱합니다.
  `freeword`는 제품명 안의 **한 덩어리 문자열**로만 매칭되므로, 형식번호 또는 영문명의 특징 단어 하나씩 검색합니다.
- 후보는 이름 토큰 유사도 + 형식번호·발매연도·등급 일치로 점수를 매기고, **확실할 때만** `match`를 돌려줍니다
  (애매하면 `match: null` — 프론트엔드는 `searchUrl` 검색 페이지로 연결). 다른 등급이나 무기 세트 같은 부속품은 제외합니다.
- 결과는 엣지에 7일 캐시. 사이트 접속 실패 시 `502 { ok:false, error:"upstream_failed", searchUrl }` (캐시하지 않음).

### `GET /api/health`

```json
{ "ok": true, "now": 1770000000000, "newsCache": "kv", "newsSnapshot": { "fetchedAt": 0, "items": 20, "sources": [] } }
```

## 배포 (Cloudflare Workers, 무료 플랜 가능)

```bash
cd serverless
npx wrangler login    # 최초 1회
npx wrangler deploy
```

로컬 실행: `npx wrangler dev` → <http://127.0.0.1:8787/api/news>

### 예약 캐시 갱신 켜기 (선택)

`wrangler.toml`에는 15분 주기 Cron이 이미 설정되어 있지만, 스냅샷을 저장할 KV가 없으면 아무 일도 하지 않습니다.

```bash
npx wrangler kv namespace create NEWS_CACHE
```

출력된 `id`를 `wrangler.toml`의 `[[kv_namespaces]]` 주석을 풀어 넣고 다시 배포하면,
이후 `/api/news`는 업스트림을 기다리지 않고 KV 스냅샷으로 즉시 응답합니다.
KV 없이도 `/api/news`는 동작합니다(요청 시 수집 + 엣지 캐시 15분).

## 프론트엔드 연결

배포로 발급된 URL을 [js/api.js](../js/api.js)의 `API_BASE`에 입력하거나,
파일 수정 없이 HTML에서 앱 스크립트보다 먼저 지정합니다:

```html
<script>window.GUNPLA_API_BASE = 'https://gunpla-guide-api.<your-subdomain>.workers.dev';</script>
```

API를 설정하지 않으면:

- 소식 패널은 요청을 보내지 않고 "API 미설정" 안내와 공식 소식 페이지 링크를 보여 줍니다.
  (브라우저에서 직접 수집하던 공개 CORS 프록시 경로는 제거했습니다 — 대상 RSS가 사라졌고, 공개 프록시는 자주 막혀 콘솔 오류를 냈습니다.)
- 상세 페이지의 "반다이 매뉴얼" 버튼은 데이터의 `bandaiManualId`가 있으면 매뉴얼 페이지로,
  없으면 등급 카테고리로 좁힌 공식 사이트 검색 결과로 연결됩니다.

## 캐시 정책

| 계층 | 기간 | 역할 |
|------|------|------|
| KV 스냅샷 (`NEWS_CACHE`) | Cron 15분마다 갱신, 60분 지나면 요청 시 재수집 | 소식 사전 수집 |
| 엣지 `s-maxage` (KV 없을 때) | 소식 15분 / 매뉴얼 7일 | 업스트림 재요청 억제 |
| 브라우저 `max-age` | 소식 5분 / 매뉴얼 1일 | 중복 요청 억제 |
| 프론트 `localStorage` | 소식 30분 / 매뉴얼 30일(못 찾음은 1일) | 오프라인·장애 시 마지막 데이터 |

## 테스트

네트워크 없이 실행되는 단위·라우팅 테스트(소식 페이지 파싱, 매뉴얼 검색 결과 파싱·판정, KV/엣지 캐시 동작):

```bash
cd serverless
node --test "test/*.test.js"
```

## 계층 경계

| 기능 | 계층 | 이유 |
|------|------|------|
| 소식 수집·파싱·병합 | **이 Worker** (`lib/news.js`) | 브라우저는 CORS 때문에 외부 사이트를 직접 못 읽음 |
| 소식 캐시 갱신 | **이 Worker** (Cron + KV) | 방문자 요청과 무관하게 주기적으로 갱신 |
| 매뉴얼 검색·판정 | **이 Worker** (`lib/manual.js`) | 외부 사이트 HTML 파싱은 CORS 때문에 서버 필요 |
| 매뉴얼 ID 일괄 기록 | `scripts/resolve-manual-ids.mjs` (빌드 타임) | 같은 `lib/manual.js`로 확정된 ID를 데이터에 저장 → 런타임 API 없이도 바로 연결 |
| 데이터 검증 | `scripts/validate-data.mjs` (빌드 타임, CI) | 데이터 변경 시점에 한 번 검사하면 충분 |

## 파일 구성

```
serverless/
├── worker.js          # 라우팅 · 캐시 · Cron 핸들러
├── lib/
│   ├── net.js         # fetch 타임아웃·재시도, 텍스트 정리
│   ├── news.js        # 소식 수집·파싱·병합 (HTML / Next.js 데이터 / RSS)
│   └── manual.js      # 반다이 매뉴얼 검색·파싱·판정 (scripts/에서도 사용)
├── test/              # node:test 테스트 + fixtures
├── wrangler.toml      # Worker 설정 (Cron, KV)
└── package.json       # ESM 설정 + npm 스크립트 (의존성 없음)
```

## 다른 플랫폼으로 포팅

`lib/`의 모듈은 표준 `fetch`만 쓰므로 Vercel/Netlify Functions로 옮기기 쉽습니다. 핸들러만 교체하세요:

- **Vercel** (`api/news.js`): `export default async (req, res) => res.json(await aggregateNews({ limit: 20 }))`
- **Netlify** (`netlify/functions/news.js`): `export default async () => Response.json(await aggregateNews({ limit: 20 }))`

엣지 캐시(`caches.default`)와 KV는 각 플랫폼의 `Cache-Control` 헤더·KV 스토어로 대체합니다.
