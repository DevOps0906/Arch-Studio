"""arch 제품 compliance 규칙(02_ARCHITECTURE.md 5절 arch.review 마지막 생성 노드). 결정적 규칙 사전이다(LLM 없음).

금지(FAIL): 인허가 보장, 적법성 단정("허가 가능합니다"), 전문가 대체, 공공기관 보증.
주의(WARN): 단정에 가까운 완화 표현 -> 문장을 "확인 필요"로 옮겨 사용자가 확인 표시를 남기게 한다(03_SCREENS_UX.md).
"근거 없는 수치"는 그래프 resolve_refs가 막는다(엔진 값 집합 밖 숫자 문장 제거).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

DISCLAIMER_VERSION = "arch-review-disclaimer.v1"

Severity = Literal["WARN", "FAIL"]


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: Severity


_RULES: tuple[tuple[str, Severity, re.Pattern[str]], ...] = (
    ("permit_guarantee", "FAIL", re.compile(r"인허가\s*(?:를\s*)?(?:보장|확정|통과)")),
    ("permit_assertion", "FAIL", re.compile(r"허가\s*(?:가\s*)?(?:가능합니다|됩니다|받을\s*수\s*있습니다|확실)")),
    ("legality_assertion", "FAIL", re.compile(r"적법(?:합니다|하며|함을\s*보증)|위법(?:이|은)?\s*아닙니다")),
    ("expert_replacement", "FAIL", re.compile(r"(?:건축사|전문가)[^.]{0,10}(?:대체|불필요|필요\s*없)")),
    (
        "public_endorsement",
        "FAIL",
        re.compile(r"(?:공공기관|관청|지자체|허가청)[^.]{0,10}(?:보증|승인\s*완료|확인\s*완료)"),
    ),
    ("overconfident", "WARN", re.compile(r"문제\s*없|안전합니다|확실(?:히|합니다)|틀림없|반드시\s*통과")),
)


def check_text(text: str) -> list[Finding]:
    return [Finding(rule, severity) for rule, severity, pattern in _RULES if pattern.search(text)]


def severity_of(text: str) -> Severity | None:
    """가장 무거운 등급. 걸린 규칙이 없으면 None."""
    findings = check_text(text)
    if any(f.severity == "FAIL" for f in findings):
        return "FAIL"
    if findings:
        return "WARN"
    return None
