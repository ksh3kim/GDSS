# Gunpla Finder 🔍

건프라 전 제품을 정밀 분류하여 당신에게 맞는 제품을 추천하는 웹사이트입니다.

## 주요 기능

- **23개 분류 카테고리**: 등급, 시리즈, 난이도, 가동성, 색분할 등
- **다국어 지원**: 한국어 / English
- **스마트 추천**: 필터 조건에 따른 매칭 점수 표시
- **즐겨찾기 & 비교**: 제품 비교 및 즐겨찾기 기능
- **반응형 디자인**: 모바일/태블릿/데스크톱 지원

## 기술 스택

- **Frontend**: HTML5, CSS3 (Vanilla), JavaScript (ES6+)
- **Data**: JSON (정적 데이터)
- **Hosting**: Netlify
- **Fonts**: Noto Sans KR, Orbitron

## 프로젝트 구조

```
gunpla-finder/
├── index.html          # 메인 페이지
├── detail.html         # 상세 페이지
├── favicon.png         # 파비콘
├── netlify.toml        # Netlify 설정
├── css/
│   ├── styles-base.css       # 디자인 시스템, 레이아웃
│   └── styles-components.css # 컴포넌트 스타일
├── js/
│   ├── i18n.js         # 다국어 지원
│   ├── filter.js       # 필터 시스템
│   ├── recommendation.js # 추천 로직
│   └── app.js          # 메인 앱
└── data/
    ├── taxonomy.json   # 필터 분류 체계
    ├── i18n.json       # 번역 데이터
    ├── gunpla-index.json # 제품 인덱스
    └── gunpla-details/ # 상세 데이터 (Lazy Load)
```

## 로컬 실행

```bash
# 간단한 HTTP 서버로 실행
npx serve .

# 또는 Python
python -m http.server 8000

# 또는 VS Code Live Server 사용
```

## Netlify 배포

1. GitHub 리포지토리 연결
2. Build command: (빈 칸)
3. Publish directory: `.`
4. Deploy!

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

## 라이선스

이 프로젝트는 팬 제작 비공식 프로젝트입니다.
건프라 및 관련 상표는 BANDAI SPIRITS의 등록상표입니다.

---

Made with ❤️ for Gunpla enthusiasts