# 반다이 매뉴얼 ID 매핑

상세 페이지의 "반다이 매뉴얼" 버튼이 공식 설명서 페이지(`https://manual.bandai-hobby.net/menus/detail/{id}`)로
바로 연결되도록, 제품 데이터에 `bandaiManualId`를 기록하는 빌드 타임 도구입니다.

> **매뉴얼 ID ≠ 이미지 ID.** `thumbnail` / `images.boxart`의 숫자는 gunpla.fyi 박스아트 이미지 번호이고,
> 반다이 매뉴얼 ID와는 다른 번호 체계입니다. 이 도구들은 이미지 URL을 건드리지 않습니다.

`bandaiManualId`가 없는 제품은 매뉴얼 사이트 검색 결과(등급 카테고리로 필터)로 연결되고,
서버리스 API가 설정되어 있으면 API가 매뉴얼 페이지를 찾아 연결합니다 ([serverless/README.md](../serverless/README.md)).

## 방법 1: 자동 탐색 (권장)

서버리스 API와 같은 검색·판정 로직(`serverless/lib/manual.js`)으로 전 제품을 조회합니다.
**확실하게 일치한 경우만** 기록하고, 애매한 제품은 건너뜁니다.

```bash
node scripts/resolve-manual-ids.mjs            # 미리 보기 (파일 변경 없음)
node scripts/resolve-manual-ids.mjs --write    # 확정된 ID를 데이터에 기록
node scripts/validate-data.mjs                 # 기록 후 검증
```

옵션: `--only id1,id2` (일부만), `--force` (이미 ID가 있는 제품도 다시 조회), `--delay 800` (요청 간격 ms, 기본 500).
이미 `bandaiManualId`가 있는 제품은 기본적으로 건너뜁니다 — 직접 확인한 ID가 우선입니다.

## 방법 2: CSV로 직접 입력

자동 탐색이 못 찾은 제품은 `bandai-id-mapping.csv`의 `bandai_manual_id` 열에 직접 입력합니다.

1. `manual_search_url` 열의 링크를 브라우저에서 열기 (형식번호/이름 + 등급으로 필터된 검색 결과)
2. 해당 제품을 클릭
3. 주소의 숫자 확인: `https://manual.bandai-hobby.net/menus/detail/[이 숫자]`
4. 그 숫자를 `bandai_manual_id` 열에 입력 (숫자가 아니면 건너뜀)

```bash
node scripts/apply-bandai-ids.js
node scripts/validate-data.mjs
```

### 결과

- `data/gunpla-index.json`의 해당 제품에 `bandaiManualId` 필드 추가 (`modelNumber` 바로 뒤)
- `data/gunpla-details/{id}.json`에도 같은 필드 추가 (검증 스크립트가 두 값의 일치를 확인)

## 파일 구조

```
scripts/
├── bandai-id-mapping.csv     # 수동 매핑 (bandai_manual_id 열에 입력)
├── apply-bandai-ids.js       # CSV → 데이터에 bandaiManualId 기록
├── resolve-manual-ids.mjs    # 자동 탐색 → 데이터에 bandaiManualId 기록
├── validate-data.mjs         # 데이터 검증 (CI에서도 실행)
└── README-mapping.md         # 이 문서
```

## 팁

- `current_thumbnail_id` 열은 참고용(현재 이미지 번호)입니다. `bandai_manual_id`로 복사하지 마세요.
- CSV 편집은 Excel이나 Google Sheets 권장 (쉼표가 들어간 값은 쓰지 마세요 — 단순 CSV 파서입니다).
