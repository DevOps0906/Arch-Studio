"""Arch compliance 규칙 단계(02_ARCHITECTURE.md 5장 `arch.review` compliance 열, `AI_ARCHITECTURE.md:117`).

그래프의 마지막 생성 노드 뒤(output 앞)에서 문장마다 결정적으로 검사한다. 걸린 문장은 고치지 않고 뺀다
(사람이 읽을 결과에 단정·보증 문장이 남지 않게, 실패 닫힘). LLM 보조(`arch.compliance`, 경량)는 아직 붙이지 않았다:
라우팅 표의 실패 규칙대로 "규칙 단계만으로" 동작한다(`SHARED_MODULES.md:355`).

금지: 인허가 보장, 적법성 단정("허가 가능합니다"), 전문가 대체, 공공기관 보증, 근거 없는 수치.
근거 없는 수치는 자리표시자 밖 숫자(인용 조문 번호 "제N조" 제외)·한글 수사+단위 표현이 있으면 위반이다.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Literal

ViolationCode = Literal[
    "permit_guarantee", "legality_assertion", "expert_replacement", "public_endorsement", "ungrounded_number"
]

_PATTERNS: tuple[tuple[ViolationCode, re.Pattern[str]], ...] = (
    ("permit_guarantee", re.compile(r"(인허가|허가|승인|심의).{0,8}(보장|확실|틀림\s*없|문제\s*없)")),
    ("legality_assertion", re.compile(r"(허가|건축|신축|증축)\s*(이|가|도)?\s*(충분히\s*)?가능(합니다|하다|함|해요)")),
    ("legality_assertion", re.compile(r"적법(합니다|하다|함|해요|한\s*것으로\s*(판단|확인)됩니다)")),
    ("legality_assertion", re.compile(r"위법(하지\s*않|이\s*아니|성이\s*없)")),
    ("legality_assertion", re.compile(r"(심의|허가|인허가)(를|을)?\s*통과(합니다|할\s*것|하게\s*됩니다)")),
    (
        "expert_replacement",
        re.compile(r"(건축사|전문가|설계자)(의)?\s*(검토|확인|자문)(가|이|는|은)?\s*(필요\s*(없|하지\s*않)|불필요)"),
    ),
    ("expert_replacement", re.compile(r"(건축사|전문가)(를|을)?\s*대신")),
    (
        "public_endorsement",
        re.compile(r"(정부|국토교통부|국토부|구청|시청|군청|지자체|허가권자|공공기관).{0,10}(보증|인증|공인)"),
    ),
)

# 숫자 규칙(자리표시자 밖): 아라비아 숫자는 전부 거부한다.
# 예외는 인용 자료의 조문 번호와 정확히 같은 "제N조(의M)"뿐이다. 엔진 값과 같은 숫자를 직접 쓴 경우도 거부한다
# (다른 항목 값을 옮겨 적는 우회 차단). 엔진 값은 `{ref:...}` 치환으로만 들어간다.
ARTICLE_RE = re.compile(r"제\d+조(?:의\d+)?")
DIGIT_RE = re.compile(r"[0-9０-９]")
# 한글 수사 + 단위(육십 퍼센트·세 대·이십 층·열 미터 등). 흔한 낱말(이 대지·세대·사이 층·이 평면·이 프로젝트)과
# 겹치지 않게 단위 뒤는 조사·끝만, 고유어 수사는 띄어 쓴 단위만, 한자어 두 자 이상은 십·백·천·만이 든 꼴만 잡는다.
_SINO1 = "[일이삼사오육륙칠팔구]"
_SINO = f"(?:{_SINO1}|[십백천만])+"
_SINO_BIG = f"(?:{_SINO1}?[십백천만])+{_SINO1}?"
_NATIVE = "(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른|마흔|쉰)"
_TAIL = r"(?=[이가은는을를의에도만로와과]|입니다|이며|이고|$|[\s.,)])"
KOREAN_NUMBER_RES: tuple[re.Pattern[str], ...] = (
    re.compile(rf"(?<![가-힣]){_SINO}\s*(?:%|㎡|(?:퍼센트|미터|제곱미터|평방미터|센티미터|밀리미터){_TAIL})"),
    re.compile(rf"(?<![가-힣]){_SINO_BIG}\s*(?:층|대|개|미터){_TAIL}"),
    re.compile(rf"(?<![가-힣]){_NATIVE}(?:\s*{_NATIVE})?\s+(?:대|층|개|미터){_TAIL}"),
)


def has_ungrounded_number(text: str, allowed_articles: Iterable[str]) -> bool:
    """자리표시자를 뺀 문장에 허용되지 않은 숫자 표현이 있으면 True."""
    articles = set(allowed_articles)
    rest = ARTICLE_RE.sub(lambda m: "" if m.group(0) in articles else m.group(0), text)
    if DIGIT_RE.search(rest):
        return True
    return any(p.search(rest) for p in KOREAN_NUMBER_RES)


def check_sentence(text: str, allowed_articles: Iterable[str]) -> list[ViolationCode]:
    """위반 코드 목록(중복 없음, 발견 순서). 빈 목록이면 통과. text는 자리표시자를 뺀 문장."""
    found: list[ViolationCode] = []
    for code, pattern in _PATTERNS:
        if code not in found and pattern.search(text):
            found.append(code)
    if has_ungrounded_number(text, allowed_articles):
        found.append("ungrounded_number")
    return found
