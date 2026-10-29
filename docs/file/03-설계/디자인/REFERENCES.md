# REFERENCES — 제품별 시각 레퍼런스 (Awwwards / Dribbble)

작성일 2026-10-12. `DESIGN_PRINCIPLES.md` 1단계(레퍼런스 수집)의 출발점이다. 절차와 용어는 `DESIGN_PRINCIPLES.md`, 스킬 매핑은 `SKILLS.md`를 따른다.

## 이 파일 사용법

| 항목 | 규칙 |
|---|---|
| 인용 범위 | 제품 에이전트는 이 파일에 있는 URL만 인용한다. 새 레퍼런스가 필요하면 직접 URL을 확인한 뒤 이 파일에 먼저 추가하고 쓴다. 확인하지 않은 URL을 만들어 넣지 않는다. |
| 기록 위치 | 고른 레퍼런스는 제품 폴더 `03_SCREENS_UX.md`에 이 파일과 같은 열(출처, URL, 참고 포인트, 적용 화면)로 옮겨 적는다. |
| 수량 | 제품당 3~5개를 고른다(`DESIGN_PRINCIPLES.md` 1단계). 이 파일의 표는 후보를 조금 더 많이 둔다. |
| 출처 우선순위 | 메인페이지/랜딩은 Awwwards 수상작(SOTD, Honorable Mention, Nominee 순), 앱 화면/대시보드는 Dribbble 샷을 우선한다. 이번 수집에서는 두 곳에서 모두 찾을 수 있어 다른 갤러리는 쓰지 않았다. |
| 참고 포인트 | "멋있다"가 아니라 가져올 요소 하나를 쓴다. 각 행의 "가져오지 않을 것"은 생성형 기본값 목록(`DESIGN_PRINCIPLES.md` 5단계)에 걸리거나 제품 주제와 맞지 않는 부분이다. |
| 상위 규칙 | 브리프와 확정 결정(`00_MERGE_ANALYSIS.md`)이 레퍼런스보다 우선한다. 레퍼런스가 브리프와 충돌하면 레퍼런스를 버린다. |

## 영감용이지 복제용이 아니다

| 금지 | 설명 |
|---|---|
| 자산 복제 | 레퍼런스의 로고, 사진, 일러스트, 아이콘, 3D 모델, 영상, 폰트 파일을 가져오지 않는다. |
| 브랜딩 차용 | 레퍼런스 브랜드의 이름, 슬로건, 카피, 색 조합 전체, 시그니처 인터랙션을 그대로 옮기지 않는다. |
| 화면 트레이싱 | 레이아웃을 픽셀 단위로 따라 그리지 않는다. 구조(정보 배치, 위계, 리듬)만 참고하고 토큰은 제품 주제에서 다시 뽑는다(`DESIGN_PRINCIPLES.md` 4단계). |
| 다른 제품 간 공유 | 같은 레퍼런스를 두 제품이 같은 방식으로 쓰지 않는다. 기존 토큰 진단에서 여러 제품이 같은 다크 베이스를 공유해 구분되지 않는 문제가 이미 지적됐다. |

## URL 확인 방법과 결과

| 출처 | 확인 방법 | 결과 |
|---|---|---|
| Awwwards | 2026-10-12에 각 `/sites/` URL을 직접 요청해 HTTP 200과 페이지 제목(수상 등급 포함)을 확인했다. | 후보 45개 모두 200 응답. 표에 수상 등급을 페이지 제목 그대로 적었다. |
| Dribbble | Dribbble은 자동 요청에 사람 확인(Human Verification) 화면을 돌려줘 직접 요청으로는 확인할 수 없었다. 웹 검색 색인에서 URL과 샷 제목, 작성자가 함께 나온 것만 넣었다. | 샷 페이지가 삭제되면 링크가 끊길 수 있다. 인용 전에 브라우저에서 한 번 열어 본다. 열리지 않으면 이 파일에서 지우고 다른 후보를 쓴다. |
| 제외 | 검색 결과 설명에만 나오고 URL을 확인하지 못한 샷, 내용 설명이 없어 참고 포인트를 쓸 수 없는 샷은 넣지 않았다. | 제외한 후보는 이 파일에 없다. |

## 표 형식

각 제품 절은 방향 요약, 브리프 보조 표(기존 토큰, 피할 인상, UUPM 쿼리), 레퍼런스 표로 구성한다. 레퍼런스 표의 "구분"은 랜딩(메인페이지/랜딩)과 앱(앱 화면/대시보드)이다.

---

## flora-publishing (Flora, AI 전자책 출판)

방향 요약: 대상은 원고를 책으로 내고 싶은 1인 창작자다. 랜딩은 "책이 실제로 만들어진다"는 물성을 첫 화면에 보여 주고, 앱은 장(章) 구조와 판형 미리보기가 중심인 조용한 집필 도구로 둔다. 따뜻한 크림 배경 + 세리프 + 테라코타 조합(기본값 1번)은 피한다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | Flora-v2 다크 #0d1117/#1a2340, 강조 #a855f7/#f97316, `warm-serif` 테마 #FAF7F2 + Noto Serif KR |
| 피할 인상 | 보라 그라디언트 AI 툴 느낌, 크림색 문학 잡지 템플릿 |
| UUPM 쿼리 | `search.py "ebook publishing self-publishing author tool" --design-system -p "flora-publishing"` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Codapress Publishing (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/codapress-publishing | 책 표지를 원형으로 순환시키는 캐러셀. 결과물(책)을 히어로의 주인공으로 두는 방식 | GSAP 스크롤 연출을 섹션마다 반복하는 것(모션은 연출 순간 하나) | 메인 히어로, 샘플 책 갤러리 |
| 랜딩 | Blue Bird Publishing House (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/blue-bird-publishing-house | 건축·예술 서적 출판사의 도서 목록 구성. 표지 이미지와 서지 정보의 위계 | 출판사 브랜드 톤과 사진. 예술서 중심의 큰 여백을 앱 화면까지 끌고 오는 것 | 출간 사례, 템플릿 갤러리 |
| 앱 | Scribbler - Writing App | Dribbble | https://dribbble.com/shots/15364448-Scribbler-Writing-App | 종이 느낌을 원하는 사용자를 위한 미니멀 집필 화면. 본문 폭과 도구 노출 최소화 | 종이 질감 배경 이미지, 크림색 기본 배경 | 원고 편집기 |
| 앱 | AI book app | Dribbble | https://dribbble.com/shots/23707376-AI-book-app | AI 생성 결과를 책 단위로 보여 주는 앱 구조. 생성 단계와 결과 미리보기의 연결 | 샷의 일러스트와 색. 화면 구성을 열어 확인한 뒤 맞는 부분만 쓴다 | 기획 위저드, 생성 결과 미리보기 |
| 앱 | Lexi - AI Writer Assistant Web App Saas Platform | Dribbble | https://dribbble.com/shots/22398012-Lexi-AI-Writer-Assistant-Web-App-Saas-Platform | 좌측 사이드바 내비게이션 + 본문 편집 영역의 SaaS 구조 | 모든 패널을 같은 둥근 카드로 나누는 SaaS 카드 키트(기본값 4번) | 작업 공간 셸 |

---

## astro-ai (신비로운AI, 사주/타로 + 크레딧팩)

방향 요약: 대상은 자기 이해나 가족 선물용으로 리포트를 소장하려는 20~40대다. 랜딩은 명식표 격자와 책자형 PDF 실물로 신뢰를 주고, 타로는 카드 뽑기라는 행동 하나만 연출한다. 점집 간판 같은 보라 그라디언트와 별 반짝이는 쓰지 않는다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 다크 #0A0A0F~#0D0D1A + 보라 #7C3AED/#8B5CF6 단일 강조(`DESIGN_PRINCIPLES.md` 사전 진단) |
| 피할 인상 | 보라/핑크 그라디언트, 별 파티클, 서양 점성술 기호를 사주에 섞는 것 |
| UUPM 쿼리 | `search.py "saju fortune tarot report korean" --design-system -p "astro-ai"` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | AskNova Astrology (Nominee) | Awwwards | https://www.awwwards.com/sites/asknova-astrology | 출생 차트, 오늘의 운, 궁합을 한 서비스 안에서 나누는 정보 구조 | 서양 점성술 차트 그래픽(사주 명식표로 바꾼다) | 메인, 서비스 메뉴 구성 |
| 랜딩 | CHANI (Nominee) | Awwwards | https://www.awwwards.com/sites/chani-1 | 개인화 운세, 차트 해석, 일일 인사이트를 구독형으로 묶는 흐름 | 브랜드 일러스트와 카피 톤 | 크레딧팩/구독 안내, 리포트 소개 |
| 랜딩 | Tarot-o-bot (SOTD) | Awwwards | https://www.awwwards.com/sites/tarot-o-bot | 카드 세 장을 뽑는 행동 하나를 페이지의 연출 순간으로 쓰는 방식 | illo의 일러스트 스타일과 캐릭터 | 타로 뽑기 화면 |
| 랜딩 | Tarot with YouTube (SOTD) | Awwwards | https://www.awwwards.com/sites/tarot-with-youtube | 메이저 아르카나를 섞고 고르는 인터랙션 순서(섞기, 고르기, 해석) | 3D/WebGL 연출 전체. 모바일 성능 기준을 넘지 않게 축소 | 타로 인터랙션 |
| 앱 | Tarot App Design | Dribbble | https://dribbble.com/shots/7696045-Tarot-App-Design | "타로가 어둡고 차갑기만 한 것은 아니다"라는 접근. 카드마다 이야기를 붙이는 해석 화면 | 샷의 카드 일러스트 | 타로 결과, 카드 상세 |
| 앱 | Tarot Card App Design | Dribbble | https://dribbble.com/shots/16040349-Tarot-Card-App-Design | 운영 중인 서비스용으로 만든 화면 흐름(실사용 기준의 정보량) | 공개된 팔레트(#0D0B08 거의 검정 + 주황 단일 강조)는 기본값 2, 5번에 걸린다 | 결과 화면 흐름 |

---

## sceneflow (SceneFlow, 숏폼/롱폼/Lofi/플리 자동화)

방향 요약: 대상은 여러 유튜브 채널을 동시에 굴리는 운영자다. 앱은 다크 대시보드를 유지하되 트랙(A~F)과 채널 역할을 범례가 있는 색으로 구분하고, 잡 진행률이 주인공이다. 랜딩은 실제 생성 결과(쇼츠, 플리 썸네일)를 보여 주고, 민트 단일 강조 다크 베이스를 다른 제품과 겹치지 않게 다시 뽑는다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 배경 #13131A/#1A1A26/#1E1E2E, 민트 #00C9A7, 보조 #2563EB/#F43F5E/#F59E0B/#7C3AED, Bebas Neue, JetBrains Mono 숫자 |
| 피할 인상 | 해커 터미널 같은 모노스페이스 라벨, 큰 숫자 + 그라디언트 히어로(기본값 6번) |
| UUPM 쿼리 | `search.py "video automation youtube multi channel dashboard" --design-system -p "sceneflow" --page "dashboard" --density 8 --motion 2` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Physical Matter by Runway (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/physical-matter-by-runway | 히어로를 애니메이션 영상 하나로 여는 구성. 생성 결과물이 곧 히어로 | Runway의 오브젝트 컬렉션 콘셉트와 브랜드 | 메인 히어로 |
| 랜딩 | Join Radio (SOTD) | Awwwards | https://www.awwwards.com/sites/join-radio | 시간대에 따라 배경색과 그래픽이 바뀌어 듣는 분위기를 바꾸는 방식. 플리(Track F)의 무드별 큐레이션 소개에 맞다 | 라디오 방송국 브랜드와 그래픽 | Lofi/플리 소개 섹션, 링크인바이오 |
| 앱 | Video Editing Dashboard | Dribbble | https://dribbble.com/shots/25186663-Video-Editing-Dashboard | 여러 프로젝트 관리 + 타임라인 + 미리보기를 한 화면에서 오가는 구조 | 편집 효과 패널(제품은 편집기가 아니라 자동화 파이프라인) | 롱폼 스토리보드, 클립 검수 |
| 앱 | YouTube channel Dashboard Sample | Dribbble | https://dribbble.com/shots/25345883-YouTube-channel-Dashboard-Sample | 구독자 증가, 시청 시간 차트, 상위 영상, 제휴 파트너 목록을 한 화면에 둔 채널 지표 구성 | 모든 지표를 같은 카드로 만드는 처리 | 채널별 성과, 제휴 링크 성과 |
| 앱 | YouTube Studio Dashboard Dark Mode Concept | Dribbble | https://dribbble.com/shots/12237130-YouTube-Studio-Dashboard-Dark-Mode-Concept-Design-in-Adobe-XD | 유튜브 스튜디오 사용자에게 익숙한 다크 대시보드 위계 | YouTube 로고, 빨간색 브랜드 강조 | 운영 대시보드 홈 |
| 앱 | Lofi Music Player | Dribbble | https://dribbble.com/shots/11703209-Lofi-Music-Player | 휴식, 작업용 Lofi 앱의 단일 곡 재생 화면. 곡 단위 관리(Track E)의 상세 화면 참고 | 샷의 일러스트 배경 | 음원 상세, 루프 영상 미리보기 |

---

## nomad-blog (AI 블로그 작성 + 네이버/티스토리/워드프레스 자동 발행)

방향 요약: 대상은 제휴 수익을 노리는 블로그 운영자다. 앱의 중심은 원고 편집기와 발행 캘린더이고, 제휴 상품 카드와 대가성 문구가 원고 안에서 어떻게 보이는지 미리보기로 확인하게 한다. video와 같은 NOMAD 다크 토큰을 쓰지 말고 글 읽기에 맞는 밝은 작업면을 검토한다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | Nomad-BlogStudio: #13131A/#1A1A26 다크, #00C9A7/#F59E0B/#F43F5E, Bebas Neue, Noto Sans KR |
| 피할 인상 | video와 구분되지 않는 같은 다크 대시보드, SEO 툴의 점수 게이지 남발 |
| UUPM 쿼리 | `search.py "AI blog writing auto publishing affiliate" --design-system -p "nomad-blog"` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Catalyze AI - SaaS website (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/catalyze-ai-saas-website | AI SaaS 랜딩의 기능 설명 순서와 제품 화면 노출 방식 | 장식용 그라디언트 워시, 아이브로 라벨(기본값 4, 5번) | 메인 |
| 랜딩 | AI Writing tool - Website | Dribbble | https://dribbble.com/shots/20827495-AI-Writing-tool-Website | SEO 최적화 원고를 만든다는 가치를 첫 화면에서 설명하는 카피 구조 | 영어 마케팅 카피와 일러스트 | 메인 히어로 카피 |
| 앱 | SEO Copywriting AI Tool Web App | Dribbble | https://dribbble.com/shots/18325015-SEO-Copywriting-AI-Tool-Web-App | 생성 입력 폼과 결과 원고를 나란히 두는 생성 화면 | 상품 설명 생성용 필드 구성(블로그 원고 구조로 바꾼다) | 원고 생성 |
| 앱 | Lexi - AI Writer Assistant Web App Saas Platform [Chat AI] | Dribbble | https://dribbble.com/shots/22408990-Lexi-AI-Writer-Assistant-Web-App-Saas-Platform-Chat-AI | 편집기 옆 대화형 수정 패널 | 채팅 말풍선 중심 UI로 편집기를 가리는 것 | 원고 편집기 보조 패널 |
| 앱 | WP Scheduled Posts | Dribbble | https://dribbble.com/shots/9895896-WP-Scheduled-Posts-Missed-Schedule-Best-Editorial-Calendar | 편집 캘린더 + 자동 예약 + 예약 글 위젯 | 워드프레스 관리자 스타일 그대로 | 발행 캘린더, 플랫폼별 예약 |
| 앱 | Farmhouse Affiliate Marketing Dashboard | Dribbble | https://dribbble.com/shots/14671941-Farmhouse-Affiliate-Marketing-Dashboard | 판매된 상품별 수익과 성장 추이를 보는 제휴 수익 화면 | 머천트 측 기능(제품은 제휴자 측만) | 제휴 링크 클릭/수익 통계 |

---

## nomad-commerce (NOMAD Commerce, 소싱 → AI 상세페이지 → 마켓 업로드)

방향 요약: 대상은 쿠팡, 스마트스토어에 상품을 대량으로 올리는 셀러다. 앱은 고밀도 상품 표(SKU, 상태, 마켓별 업로드 결과)와 상세페이지 미리보기가 핵심이고, 장식보다 처리 속도를 보여 준다. 랜딩은 소싱부터 업로드까지 실제 순서를 보여 준다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | V.2: 민트 #00C9A7(#E6FBF7 틴트), 슬레이트 #0F172A/#94A3B8/#E2E8F0, JetBrains Mono, Bebas Neue, Noto Sans KR |
| 피할 인상 | 모노스페이스 데이터 라벨(기본값 5번), 쇼핑몰 프론트처럼 보이는 앱 |
| UUPM 쿼리 | `search.py "ecommerce seller tool product listing marketplace upload" --design-system -p "nomad-commerce" --page "dashboard" --density 9` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Shopify Editions Summer '24 (SOTD) | Awwwards | https://www.awwwards.com/sites/shopify-editions-summer-24 | 기능 업데이트를 인터랙티브 그래픽과 제품 데모로 하나씩 보여 주는 구성 | 150개 업데이트 규모의 긴 페이지. 섹션 수를 줄인다 | 메인 기능 소개 |
| 앱 | Seller Dashboard Table | Dribbble | https://dribbble.com/shots/24616305-Seller-Dashboard-Table | 상품명, SKU, 이미지, 상태(판매중/품절/중단), 재고 수, 정렬을 한 표에 둔 셀러 상품 목록 | 표 행마다 붙는 장식 아이콘 | 상품 목록, 업로드 상태 |
| 앱 | Product List - Ecommerce Dashboard | Dribbble | https://dribbble.com/shots/19883907-Product-List-Ecommerce-Dashboard | 단순한 타이포로 정리한 상품 목록 화면 | 쇼핑몰 관리자 기본 템플릿 느낌 | 소싱 상품 후보 목록 |
| 앱 | Multi-Channel Performance Dashboard | Dribbble | https://dribbble.com/shots/25971204-Multi-Channel-Performance-Dashboard-D2C-Analytics-UI | 마켓플레이스별 채널 카드(목표 대비 매출, 주문 수) | 해외 마켓 로고와 D2C 지표 | 마켓별(쿠팡/스마트스토어) 업로드 성과 |
| 앱 | E-Commerce Seller Dashboard | Dribbble | https://dribbble.com/shots/5590916-E-Commerce-Seller-Dashboard | 아코디언 사이드바 내비게이션과 중요 알림을 가운데 두는 배치 | 다크 모드 그대로(다른 NOMAD 제품과 겹친다) | 앱 셸, 알림 |

---

## microweb-studio (모바일 청첩장 / 마이크로 웹사이트 빌더, 대행 쇼룸)

방향 요약: 1차 대상은 대행을 맡기는 예비부부와 소상공인, 2차는 셀프서비스 사용자다. 쇼룸 랜딩은 완성된 청첩장을 실제 모바일 화면으로 보여 주고, 청첩장 템플릿은 375px에서 먼저 설계한다. 템플릿마다 서체와 색이 달라야 하므로 쇼룸 자체는 조용하게 둔다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 원본 DESIGN 문서 없음. `03_SCREENS_UX.md`에서 새로 정한다 |
| 피할 인상 | 꽃 일러스트와 필기체가 모든 템플릿에 반복되는 것, 웹빌더 SaaS의 보라 그라디언트 |
| UUPM 쿼리 | `search.py "wedding invitation mobile micro website builder" --design-system -p "microweb-studio" --page "landing"` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Wedding invitation (Nominee, 2025) | Awwwards | https://www.awwwards.com/sites/wedding-invitation | 하객에게 감사와 환영을 전하는 목적에 맞춘 청첩장 사이트 흐름 | 커플 사진과 문구 | 청첩장 템플릿 A |
| 랜딩 | Veley / Ross Wedding (SOTD) | Awwwards | https://www.awwwards.com/sites/veley-ross-wedding | 두 사람의 결합을 기념하는 단일 사이트의 섹션 순서와 리듬 | 사진, 이름, 고유 그래픽 | 청첩장 템플릿 B |
| 랜딩 | Amelia & Steve Wedding (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/amelia-steve-wedding | 색 팔레트와 타이포그래피만으로 만든 단일 페이지 | 2015년식 패럴랙스 | 미니멀 템플릿 |
| 랜딩 | Dora AI (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/dora-ai | AI 웹사이트 생성 제품의 결과물 시연 방식. 셀프서비스 확장 단계의 랜딩 참고 | 3D 연출 전체 | 셀프서비스 랜딩(2단계) |
| 앱 | Wedding Invitation - Mobile Website UI Design | Dribbble | https://dribbble.com/shots/15693896-Wedding-Invitation-Mobile-Website-UI-Design | 모바일 청첩장의 정보 블록(일시, 장소, 지도, 계좌, 방명록) 배치 | 실제 커플 이름과 사진 | 청첩장 모바일 템플릿 |
| 앱 | Wedding Invitation Website Landing Page | Dribbble | https://dribbble.com/shots/23677358-Wedding-Invitation-Website-Landing-Page | 데스크톱에서 열었을 때의 청첩장 랜딩 구성 | 장식 프레임과 꽃 소재 | 템플릿 데스크톱 뷰, 쇼룸 썸네일 |

---

## admin-suite (ERP / 학교관리 관리자 앱, hms는 공유 DB 제외)

방향 요약: 대상은 매일 같은 업무를 반복하는 사무 직원과 교직원이다. 공개 랜딩은 없고(로그인 화면만), 고정 내비게이션 + 필터 + 고밀도 표 + 상세 패널이 기본 구조다. 대담함은 거의 쓰지 않고 상태색과 표 가독성(tabular 숫자, 행 높이 선택)에 집중한다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | School_Management_System: 인디고 #4F46E5, #111827/#F9FAFB/#E5E7EB, 상태 #10B981/#F59E0B/#EF4444, Inter + Noto Sans KR |
| 피할 인상 | 모든 KPI를 같은 카드로 늘어놓는 SaaS 카드 키트(기본값 4번), 의미 없는 차트 장식 |
| UUPM 쿼리 | `search.py "ERP school admin data table dashboard" --design-system -p "admin-suite" --page "dashboard" --density 9 --motion 2 --stack shadcn` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 앱 | ERP/Admin Dashboard | Dribbble | https://dribbble.com/shots/25055107-ERP-Admin-Dashboard | 시스템 상태, 재무 지표, 사용자 활동을 한 화면에서 보는 운영 요약 | 지표 위계 없이 같은 크기 타일을 나열하는 것 | erp 홈 |
| 앱 | Table data view for admin dashboard | Dribbble | https://dribbble.com/shots/22988094-Table-data-view-for-admin-dashboard | 행 선택 상태, 페이지네이션, 페이지당 행 수 드롭다운 | 행 호버 전환 효과 | admin-kit 공용 데이터 표 |
| 앱 | School Management Dashboard (MindInventory) | Dribbble | https://dribbble.com/shots/21026510-School-Management-Dashboard | 입학, 출결, 시간표, 성적, 재정을 한눈에 보는 위젯과 학교별 필터 | 위젯 전부를 같은 둥근 카드로 처리 | sms 홈 |
| 앱 | Student Attendance Management System | Dribbble | https://dribbble.com/shots/20456718-Student-Attendance-Management-System-School-Admin-Dashboard | 출결 추적, 출결 보고서, 결석 알림의 흐름 | 장식용 일러스트 | sms 출결 |
| 앱 | School Management Dashboard (CMARIX) | Dribbble | https://dribbble.com/shots/6372267-School-Management-Dashboard | 학생/직원 기록, 출결, 수납을 한 플랫폼에서 다루는 메뉴 구조. Microsoft Fluent 가이드 기반 | Fluent 시각 스타일 그대로(shadcn 토큰으로 다시 만든다) | sms 내비게이션 구조 |

---

## live-poll (실시간 청중 투표, Slido 유형)

방향 요약: 대상은 강연자, 행사 진행자, 그리고 휴대폰으로 참여하는 청중이다. 청중 화면은 한 손 조작의 큰 선택지, 발표 화면(OBS 오버레이 포함)은 멀리서 읽히는 결과 막대와 실시간 순위 변화가 핵심이다. 결과가 바뀌는 순간의 모션이 이 제품의 유일한 대담함이다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 원본 DESIGN 문서 없음 |
| 피할 인상 | 이모지 반응 남발, 게임 쇼 같은 네온 색 |
| UUPM 쿼리 | `search.py "live audience polling real-time presentation" --design-system -p "live-poll"` (오버레이는 `--page "overlay"`) |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | SWSH (Nominee) | Awwwards | https://www.awwwards.com/sites/swsh | 라이브 행사용 팬 참여 플랫폼의 가치 설명 구조(행사 중 참여, 행사 후 성장) | 얼굴 인식, UGC 앨범 등 무관한 기능 소개 | 메인 |
| 앱 | Fast Poll - Poll Results | Dribbble | https://dribbble.com/shots/5451736-Fast-Poll-Poll-Results | 자동 갱신되는 실시간 결과, 숫자 애니메이션, 득표순 재정렬 | 결과 외 장식 요소 | 발표 화면 결과, OBS 오버레이 |
| 앱 | Online poll result dashboard | Dribbble | https://dribbble.com/shots/6227327-Online-poll-result-dashboard | 진행자가 보는 결과 대시보드 | 설문 분석 도구 수준의 과도한 차트 | 진행자 콘솔 |
| 앱 | Mobile design concept for a polling app | Dribbble | https://dribbble.com/shots/24164744-Mobile-design-concept-for-a-polling-app | 모바일 투표 화면의 선택지 크기와 제출 흐름 | 샷의 브랜드 색 | 청중 투표 화면 |
| 앱 | The Social Polling App for Real-Time Voting & Engagement | Dribbble | https://dribbble.com/shots/25793092-The-Social-Polling-App-for-Real-Time-Voting-Engagement | 투표 즉시 결과가 바뀌는 피드백 | 소셜 피드형 트렌딩 투표(제품은 행사 단위) | 청중 투표 후 결과 확인 |

참고가 얇은 영역: Awwwards에서 Slido/Mentimeter 유형의 청중 투표 랜딩 수상작은 찾지 못했다. 랜딩은 SWSH 하나와 `DESIGN_PRINCIPLES.md` 원칙으로 결정한다.

---

## stock-dashboard (주식 트레이딩 대시보드)

방향 요약: 대상은 매일 시세와 주문을 확인하는 개인 투자자 본인이다. 고밀도 시세 표, 차트, 주문 패널이 한 화면에 있고, 상승/하락 색은 한국 관례(상승 빨강, 하락 파랑)를 따른다. 공개 랜딩은 법률 검토 후로 미루며 레퍼런스는 참고용으로만 둔다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 원본 DESIGN 문서 없음 |
| 피할 인상 | 거의 검은 배경 + 애시드 그린 단일 강조(기본값 2번), 크립토 거래소 네온 |
| UUPM 쿼리 | `search.py "stock trading dashboard portfolio orders" --design-system -p "stock-dashboard" --page "dashboard" --density 9 --motion 2` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Montfort (SOTD) | Awwwards | https://www.awwwards.com/sites/montfort | 원자재 트레이딩·투자 회사의 절제된 신뢰 톤 | 기업 사진과 브랜드 | 공개 랜딩(법률 검토 후) |
| 랜딩 | Runway Financial (SOTD) | Awwwards | https://www.awwwards.com/sites/runway-financial | 재무 모델링 도구를 실제 제품 화면으로 설명하는 방식 | B2B 기획 도구의 기능 카피 | 공개 랜딩(법률 검토 후) |
| 앱 | GNII AI Powered Dashboard Stock & Crypto Trading | Dribbble | https://dribbble.com/shots/20626721-GNII-AI-Powered-Dashboard-Stock-Crypto-Trading-Web3-SaaS-App | 외환, 채권, 주식, 펀드를 한 화면에 모은 투자 대시보드. 다크/라이트 테마 둘 다 설계 | 크립토/Web3 요소 | 포트폴리오 홈 |
| 앱 | Stock Market Dashboard (PIXEL) | Dribbble | https://dribbble.com/shots/8173750-Stock-Market-Dashboard | 블루·그레이 중심 팔레트로 상태색을 돋보이게 하는 처리 | 서양식 상승 초록/하락 빨강 | 시세 화면 |
| 앱 | Stock Market Dashboard (Seb Hooper) | Dribbble | https://dribbble.com/shots/6095497-Stock-Market-Dashboard | 핀테크 웹앱의 차트 + 종목 목록 배치 | 오래된 샷의 그림자, 카드 처리 | 종목 상세 |

---

## toon-factory (AI 웹툰 제작)

방향 요약: 대상은 그림 실력보다 이야기를 가진 웹툰 창작자다. 랜딩은 세로 스크롤이라는 웹툰의 기본 문법을 그대로 체험시키고, 앱은 에디터 3패널(장면 목록, 캔버스, 캐릭터/설정)이 중심이다. 결과 컷 이미지가 주인공이고 UI 크롬은 조용하게 둔다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | `Toon-Factory/Design.md`에 hex/서체 토큰 없음 |
| 피할 인상 | 만화 효과음 글자와 말풍선을 UI 장식으로 쓰는 것, AI 생성툴 보라 그라디언트 |
| UUPM 쿼리 | `search.py "AI webtoon comic creator editor" --design-system -p "toon-factory"` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Soul Reaper - HTML5 Scroll Book (Nominee) | Awwwards | https://www.awwwards.com/sites/soul-reaper-html5-scroll-book | 스크롤로 진행되는 디지털 코믹. 웹툰 세로 스크롤 문법을 랜딩 연출 하나로 쓰는 방식 | 작품 그림과 캐릭터 | 메인 히어로(샘플 웹툰 스크롤) |
| 랜딩 | Ponpon Mania (SOTD) | Awwwards | https://www.awwwards.com/sites/ponpon-mania | 크리에이티브 코딩과 일러스트를 섞은 인터랙티브 코믹 | 캐릭터, 일러스트 스타일 | 샘플 작품 쇼케이스 |
| 랜딩 | MANGA-SAN (Nominee) | Awwwards | https://www.awwwards.com/sites/manga-san | 만화 페이지를 경험 공간으로 보여 주는 구성 | 일본 만화 소재와 브랜드 | 작품 갤러리 |
| 앱 | Webtoon Factory | Dribbble | https://dribbble.com/shots/9071622-Webtoon-Factory | 사용자가 직접 디지털 코믹을 만드는 앱의 제작 흐름 | 앱 이름과 그래픽(이름이 제품명과 비슷하므로 혼동에 주의) | 제작 흐름 |
| 앱 | StoryBoard Dashboard App Design | Dribbble | https://dribbble.com/shots/15313910-StoryBoard-Dashboard-App-Design | 장면 프레임을 나열해 관리하는 스토리보드 대시보드 | 프레임 이미지 | 회차/장면 목록 |
| 앱 | Ai Storybook app | Dribbble | https://dribbble.com/shots/24546086-Ai-Storybook-app | AI로 캐릭터를 만들고 이야기에 배치하는 캐릭터 생성 흐름과 유저 플로 | 가족 동화 콘셉트와 일러스트 | 캐릭터 시트 생성 |

---

## study-note (학습 노트 정리)

방향 요약: 대상은 강의 자료와 필기를 정리해 복습하려는 학생이다. 앱은 읽기 편한 본문 편집기와 복습(플래시카드) 흐름이 중심이고, 정보 밀도는 중간 정도로 둔다. 랜딩은 정리 전후의 실제 노트를 보여 주는 한 화면이면 충분하다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 원본 DESIGN 문서 없음 |
| 피할 인상 | 파스텔 스티커와 손글씨 장식, 생산성 툴의 모든 섹션 페이드인(기본값 11번) |
| UUPM 쿼리 | `search.py "study notes organizer flashcards students" --design-system -p "study-note"` + `--domain ux` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Superlist (SOTD) | Awwwards | https://www.awwwards.com/sites/superlist | 생산성 도구 랜딩에서 실제 제품 화면을 주인공으로 두는 구성 | 할 일 관리 기능 카피와 브랜드 색 | 메인 |
| 랜딩 | Magpie - Photos & Notes (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/magpie-photos-notes | 사진과 노트를 함께 다루는 앱 소개(필기 사진 업로드 기능 설명에 맞다) | 앱 스타일 색 조합 | 기능 소개 |
| 랜딩 | Learning by Design (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/learning-by-design | 교육 자료를 탐색하기 쉽게 묶는 정보 구조 | 교육 기관 포털 톤 | 학습 자료 목록 |
| 앱 | Markpad - minimal MacOS app for writing notes in markdown | Dribbble | https://dribbble.com/shots/20665686-Markpad-minimal-MacOS-app-for-writing-notes-in-markdown | 군더더기 없는 마크다운 노트 작성 화면 | macOS 창 크롬 | 노트 편집기 |
| 앱 | Note taking desktop app | Dribbble | https://dribbble.com/shots/10150150-Note-taking-desktop-app | 데스크톱 노트 앱의 사이드바 + 본문 구성, 다크 모드 | 다크 모드를 기본값으로 두는 것 | 노트 목록/편집 |
| 앱 | Flashcard App (Rajesh Satyarthi) | Dribbble | https://dribbble.com/shots/4908154-Flashcard-App | 어려운 카드가 더 자주 나오는 반복 학습, 카드 묶음(덱)과 과목 구조 | 샷의 색과 일러스트 | 복습 플래시카드 |

---

## website-floria (Floria, 보태닉 건축 브랜드 웹사이트)

방향 요약: 대상은 정원, 조경, 식물 공간을 의뢰하려는 고급 주거·상업 고객이다. 프로젝트 사진과 큰 서체가 주인공이고, 어두운 배경을 쓰더라도 주제색이 섞인 의도된 어둠(짙은 녹색 계열 등)으로 정한다. `--variance`를 높여 비대칭 레이아웃을 시도하되 연출 순간은 하나만 둔다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | Botanic/Lucury: #080808~#0B0B0B 배경 + 흰 글자, Lucury 골드 #C4A46B(`DESIGN_PRINCIPLES.md` 사전 진단) |
| 피할 인상 | 색조 섞인 거의 검정 + 골드의 흔한 럭셔리 템플릿, 잎사귀 일러스트 패턴 |
| UUPM 쿼리 | `search.py "botanic architecture landscape luxury brand" --design-system -p "website-floria" --page "landing" --variance 8` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Botanic Expo (SOTD) | Awwwards | https://www.awwwards.com/sites/botanic-expo | 식물을 가상의 미래 세계 전시로 보여 주는 쇼케이스 구성 | 2074년 SF 세계관과 3D 자산 | 메인 히어로 연출 |
| 랜딩 | plantica (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/plantica-1 | 플라워 크리에이티브 스튜디오의 작업물 중심 포트폴리오 구성 | 일본어 타이포와 스튜디오 사진 | 프로젝트 목록 |
| 랜딩 | Ora The Floral Agency (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/ora-the-floral-agency | 꽃과 공간의 관계를 바꾼다는 에이전시 소개 방식 | 브랜드 카피와 사진 | 브랜드 소개 |
| 랜딩 | Humbert & Poyet (SOTD) | Awwwards | https://www.awwwards.com/sites/humbert-poyet | 고급 주거·상업 공간 건축사무소의 깨끗하고 미니멀한 프로젝트 제시 | 사진, 로고 | 프로젝트 상세 |
| 랜딩 | Kononenko Architectural Bureau (SOTD) | Awwwards | https://www.awwwards.com/sites/kononenko-architectural-bureau | 굵은 타이포그래피와 정돈된 구조로 프로젝트를 보여 주는 방식 | 몰입형 인터랙션을 여러 개 겹치는 것 | 메인 타이포 처리 |
| 랜딩 | Von Burg Garden Architecture (Nominee) | Awwwards | https://www.awwwards.com/sites/von-burg-garden-architecture | 같은 업종(정원 건축) 사이트의 서비스 구성 비교용 | 업체 사진, 카피 | 서비스 소개 구성 점검 |

추가 후보(확인 완료, 표에는 넣지 않음): OH Architecture https://www.awwwards.com/sites/oh-architecture (SOTD), OneAbode https://www.awwwards.com/sites/oneabode (Honorable Mention), BOTANIST https://www.awwwards.com/sites/botanist (Honorable Mention).

---

## 확인했지만 표에 넣지 않은 Awwwards 후보

같은 날 HTTP 200을 확인했다. 필요하면 위 제품 표에 옮겨 쓸 수 있다.

| 제목 | URL | 쓸 수 있는 제품 |
|---|---|---|
| A(i)strology (Honorable Mention) | https://www.awwwards.com/sites/a-i-strology | astro-ai |
| Astrology & Numerology (Honorable Mention) | https://www.awwwards.com/sites/astrology-numerology | astro-ai |
| Dyvo AI (Honorable Mention) | https://www.awwwards.com/sites/dyvo-ai | sceneflow |
| Fourmula AI (SOTD) | https://www.awwwards.com/sites/fourmula-ai | sceneflow, toon-factory(생성 결과 쇼케이스) |
| Radio Garden (Honorable Mention) | https://www.awwwards.com/sites/radio-garden | sceneflow(플리) |
| Offradio - Turn your radio OFF! (Honorable Mention) | https://www.awwwards.com/sites/offradio-turn-your-radio-off | sceneflow(플리) |
| The Renaissance Edition (SOTD) | https://www.awwwards.com/sites/the-renaissance-edition | nomad-commerce |
| Andreas & Mathilde · Wedding (Nominee) | https://www.awwwards.com/sites/andreas-mathilde-wedding | microweb-studio |
| +_+ crypton.trading (SOTD) | https://www.awwwards.com/sites/crypton-trading-bot | stock-dashboard(네온 톤은 피함) |
| Monolith (SOTD) | https://www.awwwards.com/sites/monolith | website-floria |

---

## nomad-docs (NOMAD Docs, 체크리스트 기반 실무 문서 생성)

추가일 2026-10-14(nomad-docs 코어 요청 C-4 중 레퍼런스 절). 아래 URL은 모두 이 파일의 다른 제품 절에 이미 있는 것(같은 확인 결과)이며, 원래 제품과 다른 참고 포인트로 쓴다(이 파일 "다른 제품 간 공유" 규칙).

방향 요약: 대상은 계약 전후로 같은 숫자를 여러 문서에 손으로 옮겨 적는 1인 개발자·외주 개발사 PM이다. 랜딩은 "체크 하나가 여러 문서의 같은 자리를 함께 채운다"를 실제 체크리스트 화면과 문서 묶음으로 보여 준다. 로그인 후 화면은 고객·프로젝트·문서를 한곳에서 굴리는 CRM형 작업 공간이다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 신설 제품이라 원본 토큰 없음. 제품 `03_SCREENS_UX.md` 4.3절 토큰 플랜(서류철 #E6EBE7, 용지 #FBFCFA, 먹회 #1D2421, 괘선 #8A948F, 결재청 #1F4E8C, 인주 #B3262E) |
| 피할 인상 | 법률 서비스 같은 저울·법봉 그림, 보라 그라디언트 AI 툴, 계약서 "보장" 문구, 크림색 + 세리프 + 테라코타(생성형 기본값 1번) |
| UUPM 쿼리 | `search.py "document generator quote contract checklist b2b saas" --design-system -p "nomad-docs"` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Superlist (SOTD) | Awwwards | https://www.awwwards.com/sites/superlist | 생산성 도구의 실제 제품 화면을 첫 화면 주인공으로 두는 구성. 여기서는 체크리스트 화면 한 장 | 할 일 관리 카피, 브랜드 색 | 히어로 오버레이 옆 체크리스트 실제 화면 |
| 랜딩 | Codapress Publishing (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/codapress-publishing | 결과물을 히어로의 주인공으로 두는 방식. 여기서는 책 대신 문서 묶음(8장 서류) | 원형 캐러셀과 GSAP 스크롤 연출 반복 | 히어로 마지막 프레임, "만들어지는 문서" 섹션 |
| 앱 | Lexi - AI Writer Assistant Web App Saas Platform | Dribbble | https://dribbble.com/shots/22398012-Lexi-AI-Writer-Assistant-Web-App-Saas-Platform | 좌측 사이드바 + 본문 편집 영역의 작업 공간 구조 | 모든 패널을 같은 둥근 카드로 나누는 SaaS 카드 키트 | 프로젝트 셸, 문서 편집기 |
| 앱 | Scribbler - Writing App | Dribbble | https://dribbble.com/shots/15364448-Scribbler-Writing-App | 본문 폭과 도구 노출을 최소화한 편집 화면 | 종이 질감 배경, 크림 배경 | 문서 편집기 본문 영역 |
| 앱 | Table data view for admin dashboard | Dribbble | https://dribbble.com/shots/22988094-Table-data-view-for-admin-dashboard | 행 선택 상태, 페이지네이션, 페이지당 행 수 | 행 호버 전환 효과 | 비용 항목, 요구사항 표, 버전 이력, 내보내기 기록 |

로그인 후 CRM형 화면(거래처 360, 파이프라인 보드, 명령 팔레트)은 갤러리 샷이 아니라 실제 서비스의 화면 패턴을 참고한다. 2026-10-14에 각 URL을 직접 열어 페이지 제목을 확인했다. 세부 패턴과 화면 배치는 제품 `03_SCREENS_UX.md` 3.26절에 있다.

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 앱 | Attio | 서비스 사이트 | https://attio.com/ | 레코드 페이지(헤더 + 탭 + 속성 사이드바), 같은 데이터를 표·보드로 바꿔 보는 뷰 | 임의 객체·커스텀 필드 빌더, 브랜드 색 | 거래처 360, 프로젝트 표/보드 전환 |
| 앱 | HubSpot CRM | 서비스 사이트 | https://www.hubspot.com/products/crm | 레코드 왼쪽 속성, 가운데 활동 타임라인, 오른쪽 연결 카드 | 이메일·전화 기록, 마케팅 기능, 주황 브랜드 색 | 거래처 상세 |
| 앱 | Pipedrive | 서비스 사이트 | https://www.pipedrive.com/ | 딜 파이프라인 보드, 열마다 합계, 오래 멈춘 카드 표시 | 끌어 놓기로 단계 변경(이 제품은 문서가 단계를 정한다) | 파이프라인 보드 |
| 앱 | Linear | 서비스 사이트 | https://linear.app/ | 키보드 우선, ⌘K 명령 팔레트, 빠른 화면 전환 | 이슈 트래커 개념, 다크 기본 테마 | 명령 팔레트, 단축키 |

이 네 행은 Awwwards·Dribbble이 아니라 서비스 공식 사이트다. 실제 앱 화면은 로그인 뒤에 있으므로 패턴은 공개된 제품 소개 화면 기준으로만 참고하고, 화면을 캡처해 자산으로 쓰지 않는다.

---

## book-trailer (NOMAD Book Trailer, 원고 기반 북트레일러 자동화)

추가일 2026-10-16(book-trailer 공용 모듈 요청 R-T7). 아래 URL은 모두 이 파일의 다른 제품 절에 이미 있는 것(같은 확인 결과)이며, 원래 제품과 다른 참고 포인트로 쓴다(이 파일 "다른 제품 간 공유" 규칙). 북트레일러·출판 마케팅 전문 사이트 후보는 URL을 직접 열어 확인한 뒤 이 절에 더한다(아직 없음).

방향 요약: 대상은 원고와 표지는 있지만 영상 제작은 낯선 1인 출판사·작가·출판사 마케터다. 랜딩은 "책의 띠지가 예고편 화면이 된다"를 실제 렌더 결과로 보여 준다. 로그인 후 화면은 장면 단위 작업실(미리보기 + 장면 띠 + 속성)과 브리프 비교다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 신설 제품이라 원본 토큰 없음. 제품 `03_SCREENS_UX.md` 4.3절 토큰 플랜(교정지 #EEF0F2, 인쇄 먹 #1A1C21, 형광 밑줄 #F5D547, 상영관 #202227, 연필심 #5E6470), 정본 `08_DESIGN_SYSTEM.md` 3장 |
| 피할 인상 | 영화관 레드카펫·필름 릴 클립아트, 보라 그라디언트, 크림 + 세리프 + 테라코타(생성형 기본값 1번), 큰 숫자 히어로, 다중 트랙 타임라인 편집기 흉내 |
| UUPM 쿼리 | `search.py "book trailer video generator publisher author saas" --design-system -p "book-trailer"` |

| 구분 | 제목 | 출처 | URL | 참고 포인트(가져올 것) | 가져오지 않을 것 | 적용 화면 |
|---|---|---|---|---|---|---|
| 랜딩 | Codapress Publishing (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/codapress-publishing | 표지 목록을 고르면 그 책의 결과물이 열리는 갤러리 동선(표지 → 트레일러 재생) | 원형 캐러셀과 GSAP 스크롤 연출 반복 | `/samples`, 랜딩 샘플 섹션 |
| 랜딩 | Physical Matter by Runway (Honorable Mention) | Awwwards | https://www.awwwards.com/sites/physical-matter-by-runway | 미리 렌더한 무음 루프 영상을 포스터 이미지와 함께 쓰는 구성 | 생성 영상 갤러리 전체 화면 그리드 | 히어로 3D 영상 단계(`HERO_3D.md` 6절) |
| 랜딩 | Join Radio (SOTD) | Awwwards | https://www.awwwards.com/sites/join-radio | 선택에 따라 배경과 그래픽이 바뀌는 방식 → 장르 문법 6종을 고르면 같은 문장이 그 문법의 서체·모션으로 바뀌는 섹션 | 라디오 브랜드 색, 시간대 콘셉트 | 랜딩 "장르 문법" 섹션 |
| 앱 | Video Editing Dashboard | Dribbble | https://dribbble.com/shots/25186663-Video-Editing-Dashboard | 미리보기와 하단 가로 스트립의 위계(스트립은 트랙이 아니라 장면 칸 한 줄) | 다중 트랙 타임라인, 파형 겹침 | 작업실 장면 띠 |
| 앱 | AI book app | Dribbble | https://dribbble.com/shots/23707376-AI-book-app | AI 결과를 여러 안으로 나란히 보여 주고 하나를 고르게 하는 구조 | 일러스트 책 표지 장식, 둥근 카드 키트 | 브리프 3안 비교 |

---

## arch-studio (Arch Studio, 소형 건축사사무소용 AI 설계실무 도구)

추가일 2026-10-29(AR-06-009). 새 URL은 없다. 랜딩 레퍼런스 행은 이 파일의 기존 절에 있는 URL(같은 확인 결과)을 다른 참고 포인트로 쓰며, 행 내용의 정본은 제품 `03_SCREENS_UX.md` 4.1절이다(한 곳에만 둔다). 앱 화면은 갤러리 샷이 아니라 디자인 시스템(Atlassian·Primer·Astryx 패턴만)을 따르고, 고른 내용은 `DESIGN.md` 1절에 있다. CAD·3D 설계 도구 계열 후보는 URL을 직접 확인한 뒤 이 절에 더한다(아직 없음).

방향 요약: 대상은 계약 전 무료 제안에 1~2일을 쓰는 1~5인 건축사사무소 대표다. 랜딩은 다크 단일 테마로 엔진이 만든 엔벨로프·판정·도면을 그대로 보여 주고, 앱은 라이트 작업면에서 판정 상태와 수치 입력이 주인공이다.

| 항목 | 내용 |
|---|---|
| 기존 토큰 | 정본 `packages/ui/src/tokens.css`(확정 시안 `design/reference/landing`·`dashboard`). 이 파일에 hex를 옮겨 적지 않는다 |
| 피할 인상 | 제품 `03_SCREENS_UX.md` 4.2절 "피할 인상" |
| 랜딩 행 | Kononenko Architectural Bureau(`:283`), Humbert & Poyet(`:282`), Runway Financial(`:218`), OH Architecture(`:286`, 참고 포인트 미확인) — 참고 포인트는 4.1절 |
| 앱 행 | Table data view for admin dashboard(`:176`) — 크레딧 내역, 기기 목록, 내보내기 기록 |
