# Bandai Manual ID 매핑 시스템

제품 이미지를 반다이 공식 설명서 ID와 매핑하는 도구입니다.

## 사용 방법

### 1단계: bandai_manual_id 입력

`bandai-id-mapping.csv` 파일을 열고 `bandai_manual_id` 열에 올바른 ID를 입력합니다.

**ID 찾는 방법:**
1. `manual_search_url` 열의 링크를 브라우저에서 열기
2. 해당 제품을 찾아 클릭
3. URL에서 숫자 확인: `https://manual.bandai-hobby.net/menus/detail/[이 숫자]`
4. 해당 숫자를 CSV의 `bandai_manual_id` 열에 입력

**예시:**
```
id,grade,name_en,name_ko,current_thumbnail_id,bandai_manual_id,manual_search_url
hg-rx-78-2-revive,HG,RX-78-2 Gundam,RX-78-2 건담,196,196,https://...
```

### 2단계: 스크립트 실행

```bash
cd scripts
node apply-bandai-ids.js
```

### 결과

- `gunpla-index.json`의 `thumbnail` 필드가 업데이트됩니다
- 각 `gunpla-details/*.json`의 `images.boxart` 필드가 업데이트됩니다

## 파일 구조

```
scripts/
├── bandai-id-mapping.csv    # 매핑 데이터 (여기에 ID 입력)
├── apply-bandai-ids.js      # ID 적용 스크립트
└── README-mapping.md        # 이 문서
```

## 팁

- 현재 `current_thumbnail_id`는 기존에 입력된 값입니다
- ID가 정확하면 그대로 `bandai_manual_id`에 복사해도 됩니다
- CSV 편집 시 Excel이나 Google Sheets 사용 권장
