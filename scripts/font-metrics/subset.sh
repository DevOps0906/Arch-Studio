#!/usr/bin/env bash
# 번들 글꼴 부분 집합 만들기(AR-06-022, 사람이 글꼴을 바꿀 때만 수동 실행 — CI·빌드에서 돌리지 않는다).
# 원본: npm @expo-google-fonts/noto-sans-kr@0.4.4 의 400Regular/NotoSansKR_400Regular.ttf
#       (= Google Fonts API notosanskr v40 정적 인스턴스, 글리프 24,868개, 6,191,364B, OFL-1.1)
# 도구: fonttools 4.68.0 의 pyftsubset(MIT, 개발자 PC에만 설치 — 저장소 의존성 아님: pip install fonttools==4.68.0)
# 결과: packages/drafting/fonts/NotoSansKR-Regular.subset.ttf (같은 원본·같은 fonttools → 같은 바이트, 아래 sha256으로 확인)
# 범위: scripts/font-metrics(DEFAULT_METRIC_RANGES)와 같은 기호 구간 + 문자 기호·수학 연산자 + 현대 한글 음절 11,172자 전부.
#       한자·가나·확장 라틴은 뺀다(도면에서 드묾 → 없는 글자 처리는 fonts/README.md).
# 사용: scripts/font-metrics/subset.sh <NotoSansKR_400Regular.ttf>
set -euo pipefail

SRC_SHA256="b4a747e78805bc25b610dcfc3003cb5fb2e2ec034763774b24216ed15889eef4"
OUT_SHA256="a959c81476af1cbdce3f31431c0516bc5a3e29fb85c0b15b7e34e80a8d87b2c7"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/packages/drafting/fonts/NotoSansKR-Regular.subset.ttf"
UNICODES="U+0020-007E,U+00A0-00FF,U+2000-206F,U+2100-214F,U+2190-21FF,U+2200-22FF,U+2460-24FF,U+25A0-25FF,U+3000-303F,U+3130-318F,U+3200-32FF,U+3300-33FF,U+AC00-D7A3,U+FF00-FFEF"

src="${1:?사용: scripts/font-metrics/subset.sh <NotoSansKR_400Regular.ttf>}"
actual="$(sha256sum "$src" | cut -d' ' -f1)"
if [ "$actual" != "$SRC_SHA256" ]; then
  echo "원본 sha256이 다릅니다: $actual (기대 $SRC_SHA256)" >&2
  exit 1
fi
# --name-IDs='*': 저작권(0)·라이선스(13·14) 이름 레코드를 지우지 않는다(OFL 고지 유지). 글꼴 이름(1·4·6)은 원본 그대로(fonts/README.md 'RFN').
pyftsubset "$src" --unicodes="$UNICODES" --name-IDs='*' --output-file="$OUT"
out_sha="$(sha256sum "$OUT" | cut -d' ' -f1)"
echo "$OUT: $(stat -c %s "$OUT")B sha256 $out_sha"
if [ "$out_sha" != "$OUT_SHA256" ]; then
  echo "결과 sha256이 기록과 다릅니다(fonttools 버전 확인). 의도한 변경이면 OUT_SHA256·fonts/README.md·폭 표를 함께 갱신하세요." >&2
  exit 1
fi
