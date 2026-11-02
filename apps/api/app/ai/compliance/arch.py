"""Arch compliance 규칙 단계(02_ARCHITECTURE.md 5장 `arch.review` compliance 열, `AI_ARCHITECTURE.md:117`).

그래프의 마지막 생성 노드 뒤(output 앞)에서 문장마다 결정적으로 검사한다. 걸린 문장은 고치지 않고 뺀다
(사람이 읽을 결과에 단정·보증 문장이 남지 않게, 실패 닫힘). LLM 보조(`arch.compliance`, 경량)는 아직 붙이지 않았다:
라우팅 표의 실패 규칙대로 "규칙 단계만으로" 동작한다(`SHARED_MODULES.md:355`).

금지: 인허가 보장, 적법성 단정("허가 가능합니다"), 전문가 대체, 공공기관 보증, 근거 없는 수치.
근거 없는 수치는 `allowed_numbers`(엔진 값 + 인용 조문 번호) 밖의 숫자가 문장에 있으면 위반이다.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from decimal import Decimal, InvalidOperation
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

# 숫자 토큰: 1, 1,200, 59.5. 조문 "제55조의2"의 55·2도 숫자다(인용 조문 번호는 allowed_numbers로 허용).
NUMBER_RE = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")


def number_value(token: str) -> Decimal | None:
    try:
        return Decimal(token.replace(",", ""))
    except InvalidOperation:
        return None


def numbers_in(text: str) -> list[Decimal]:
    out: list[Decimal] = []
    for tok in NUMBER_RE.findall(text):
        v = number_value(tok)
        if v is not None:
            out.append(v)
    return out


def ungrounded_numbers(text: str, allowed: Iterable[Decimal]) -> list[Decimal]:
    """allowed 밖의 숫자(값 비교, 표기 차이 `1,200`·`1200.0` 무시)."""
    allowed_set = {a.normalize() for a in allowed}
    return [n for n in numbers_in(text) if n.normalize() not in allowed_set]


def check_sentence(text: str, allowed_numbers: Iterable[Decimal]) -> list[ViolationCode]:
    """위반 코드 목록(중복 없음, 발견 순서). 빈 목록이면 통과."""
    found: list[ViolationCode] = []
    for code, pattern in _PATTERNS:
        if code not in found and pattern.search(text):
            found.append(code)
    if ungrounded_numbers(text, allowed_numbers):
        found.append("ungrounded_number")
    return found
