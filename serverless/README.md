# Gunpla Guide — Serverless API

정적 웹앱에서 분리된 **런타임 백엔드 계층**입니다. 공개 CORS 프록시 의존을 제거하고,
RSS 수집·파싱·정규화·캐시 갱신을 서버 측(Cloudflare Worker)에서 수행합니다.

## 엔드포인트

| 경로 | 설명 |
|------|------|
| `GET /api/news?limit=20` | Bandai Hobby + GUNDAM.INFO RSS를 병합한 JSON (limit 1~50) |
| `GET /api/health` | 상태 확인 |

응답 형식:

```json
{
  "ok": true,
  "fetchedAt": 1770000000000,
  "sources": [{ "name": "Bandai Hobby", "ok": true, "count": 10 }],
  "items": [{ "title": "...", "link": "https://...", "ts": 0, "source": "...", "icon": "🆕", "img": "" }]
}
```

- 최신순 정렬, 링크 기준 중복 제거
- `http(s)` 외 스킴 링크는 서버에서 제거
- 피드별 타임아웃 8초 + 1회 재시도, 한쪽 피드가 죽어도 나머지로 응답
- 모든 피드 실패 시에만 `502 { ok:false, error:"all_feeds_failed" }` — 실패 응답은 캐시하지 않음

## 배포 (Cloudflare Workers, 무료 플랜 가능)

```bash
cd serverless
npx wrangler login    # 최초 1회
npx wrangler deploy
```

로컬 테스트: `npx wrangler dev` → <http://127.0.0.1:8787/api/news>

## 프론트엔드 연결

배포로 발급된 URL을 [js/notifications.js](../js/notifications.js)의 `API_BASE`에 입력:

```js
const API_BASE = 'https://gunpla-guide-api.<your-subdomain>.workers.dev';
```

또는 파일 수정 없이 HTML에서 스크립트 로드 전에 지정:

```html
<script>window.GUNPLA_API_BASE = 'https://gunpla-guide-api.<your-subdomain>.workers.dev';</script>
```

**API 미설정/장애 시** 프론트엔드는 자동으로 기존 공개 CORS 프록시 폴백을 사용하므로,
순수 정적 호스팅만으로도 앱은 계속 동작합니다.

## 캐시 정책

| 계층 | 기간 | 역할 |
|------|------|------|
| 엣지(CDN) `s-maxage` | 15분 | 업스트림 재수집 주기 (서버 측 캐시 갱신) |
| 브라우저 `max-age` | 5분 | 중복 요청 억제 |
| 프론트 `localStorage` | 30분 | 오프라인/장애 시 마지막 데이터 표시 |

## 계층 경계

| 기능 | 계층 | 이유 |
|------|------|------|
| RSS 수집·파싱·캐시 갱신 | **이 Worker (런타임)** | CORS·프록시 신뢰성·응답 검증이 서버에서 필요 |
| 데이터 검증·ID 매핑 | `scripts/` (빌드 타임) | 유지보수자가 데이터 변경 시 실행하는 성격 |
| 반다이 매뉴얼 검색 | 아웃바운드 링크 | 공식 사이트로 이동만 하면 되므로 서버 불필요 |

## 다른 플랫폼으로 포팅

`worker.js`의 핵심 로직(`fetchAndParseFeed`, `parseFeed` 등)은 표준 `fetch` 기반이라
Vercel/Netlify Functions로 옮기기 쉽습니다. 핸들러 시그니처만 교체하세요:

- **Vercel** (`api/news.js`): `export default async (req, res) => { ...; res.json(payload); }`
- **Netlify** (`netlify/functions/news.js`): `exports.handler = async () => ({ statusCode: 200, body: JSON.stringify(payload) })`

엣지 캐시(`caches.default`)는 각 플랫폼의 `Cache-Control` 응답 헤더로 대체하면 됩니다.
