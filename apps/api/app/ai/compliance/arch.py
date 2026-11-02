"""arch 제품 compliance 규칙(02_ARCHITECTURE.md 5절 arch.review 마지막 생성 노드). 결정적 규칙 사전이다(LLM 없음).

AI 문장은 `parts: [Text | Ref]` 구조다(schema.ReviewLlmSentence). Ref(`{item, field}`)만이 엔진 값을 가리킬 수 있고,
출력 문장에는 숫자 대신 고정 낱말(산정값·한도값)로 그려진다. 숫자는 ReviewItem.engine_value·verdict로만 나간다.

`validate_free_text` 하나가 그래프 resolve_refs와 compliance 두 노드의 같은 판정기다
(tasks/logs/AR-06-051.md [DECISION]).
0. 검사 전에 NFC 정규화(NFD로 쓴 '삼십 평'도 음절로 합친 뒤 검사).
1. 문자 허용 목록(열거된 것만 통과): 한글 음절(AC00–D7A3)만, ASCII 알파벳, 공백(U+0020), 고정 구두점.
   결합·호환 자모(1100–11FF·3130–318F, 채움 문자 115F·1160·3164 포함)는 거부(자모를 끼운 우회 차단).
   유니코드 범주 N*·numeric() 값이 있는 문자·한자·전각·원문자·로마 숫자 등 그 밖은 열거 없이 모두 거부.
2. 한글 수사(닫힌 집합): 단위어·지표명 바로 앞뒤 낱말(4자 창)이 수사 문법(삼십·이백·다섯·스물다섯 등)이면 거부.
   기존 정규식(육십 퍼센트·세 대 등)은 보조망. ASCII 수 낱말(six·ten)·로마 숫자 낱말(VI)도 보조망으로 거부.
3. Ref 바인딩: 문장이 속한 항목(target = 판정 key)과 같은 item만, needs_check·district_plan 문장은 Ref 금지,
   값이 없는 칸 금지.
4. 금지(FAIL): 인허가 보장, 적법성 단정("허가 가능합니다"), 전문가 대체, 공공기관 보증.
주의(WARN): 단정에 가까운 완화 표현 -> 판정기 위반은 아니고, compliance 노드가 문장을 "확인 필요"로 옮긴다
(03_SCREENS_UX.md). 잔여 위험(수사 없는 수량 주장, 예: "한도의 절반")은 [DECISION]에 적었다.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from app.ai.products.arch.schema import RefPart, SentenceParts, TextPart

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
    # 로컬 규칙(local/parallel-2026-11-02, 합집합으로 추가: 더 넓은 표현을 막는다, AR-06-051 [DECISION]).
    ("permit_guarantee", "FAIL", re.compile(r"(인허가|허가|승인|심의).{0,8}(보장|확실|틀림\s*없|문제\s*없)")),
    (
        "legality_assertion",
        "FAIL",
        re.compile(r"(허가|건축|신축|증축)\s*(이|가|도)?\s*(충분히\s*)?가능(합니다|하다|함|해요)"),
    ),
    ("legality_assertion", "FAIL", re.compile(r"적법(합니다|하다|함|해요|한\s*것으로\s*(판단|확인)됩니다)")),
    ("legality_assertion", "FAIL", re.compile(r"위법(하지\s*않|이\s*아니|성이\s*없)")),
    ("legality_assertion", "FAIL", re.compile(r"(심의|허가|인허가)(를|을)?\s*통과(합니다|할\s*것|하게\s*됩니다)")),
    (
        "expert_replacement",
        "FAIL",
        re.compile(r"(건축사|전문가|설계자)(의)?\s*(검토|확인|자문)(가|이|는|은)?\s*(필요\s*(없|하지\s*않)|불필요)"),
    ),
    ("expert_replacement", "FAIL", re.compile(r"(건축사|전문가)(를|을)?\s*대신")),
    (
        "public_endorsement",
        "FAIL",
        re.compile(r"(정부|국토교통부|국토부|구청|시청|군청|지자체|허가권자|공공기관).{0,10}(보증|인증|공인)"),
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


# ---------------------------------------------------------------------------
# 문장 구조(LLM 출력) 그리기
# ---------------------------------------------------------------------------

# 출력 문장에서 Ref 자리에 쓰는 고정 낱말(숫자 없음, 받침 있는 말이라 조사는 은·을·이).
REF_WORDS: Mapping[str, str] = {"value": "산정값", "limit": "한도값"}
NO_REF_TARGETS = frozenset({"needs_check", "district_plan"})


def render_parts(parts: Sequence[TextPart | RefPart]) -> str:
    text = "".join(p.text if isinstance(p, TextPart) else REF_WORDS[p.field] for p in parts)
    return unicodedata.normalize("NFC", text)


# ---------------------------------------------------------------------------
# 1. 문자 허용 목록
# ---------------------------------------------------------------------------

ALLOWED_PUNCT = frozenset(".,?!()·:;'\"-/…“”‘’「」『』")


def char_allowed(ch: str) -> bool:
    """허용 목록만 True. 숫자성 문자는 목록과 상관없이 False(이중 잠금)."""
    if unicodedata.category(ch).startswith("N") or unicodedata.numeric(ch, None) is not None:
        return False
    o = ord(ch)
    return (
        0xAC00 <= o <= 0xD7A3  # 한글 음절만(자모·채움 문자 제외)
        or "a" <= ch <= "z"
        or "A" <= ch <= "Z"
        or ch == " "
        or ch in ALLOWED_PUNCT
    )


# ---------------------------------------------------------------------------
# 2. 한글 수사(닫힌 집합: 단위어·지표명 주변)
# ---------------------------------------------------------------------------

UNIT_WORDS: tuple[str, ...] = (
    "제곱미터",
    "백분의",
    "퍼센트",
    "미터",
    "세대",
    "제곱",
    "프로",
    "층",
    "평",
    "배",
    "할",
    "대",
    "개",
    "m",
)
# 지표명(그래프 KEY_LABELS의 핵심 낱말 + 면적 용어).
METRIC_TERMS: tuple[str, ...] = (
    "건폐율",
    "용적률",
    "높이",
    "일조",
    "이격거리",
    "주차대수",
    "연면적",
    "대지면적",
    "건축면적",
    "층수",
    "백분의",  # 단위어지만 수사가 뒤에 온다(백분의 육십) → 뒤를 본다
)
# 지표명 뒤에서 건너뛰는 연결어(조사 포함, 최대 2개): '건폐율 한도는 육십', '높이 제한 삼십 이하'.
CONNECTORS = frozenset({"한도", "제한", "상한", "기준", "최대", "최소", "이하", "이상"})
MAX_CONNECTORS = 2
# 단위 앞 수사처럼 보이지만 수량이 아닌 낱말.
UNIT_EXCEPTIONS = frozenset({"한층", "일대"})
WINDOW = 4
_D = "[일이삼사오육륙칠팔구]"
_SINO_NUM = re.compile(rf"(?:{_D}?천)?(?:{_D}?백)?(?:{_D}?십)?{_D}?(?:만|억)?")
_NATIVE_NUM = re.compile(
    "(?:열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)?(?:하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉)?"
)
_PARTICLES: tuple[str, ...] = tuple(
    sorted(
        (
            "입니다",
            "이었다",
            "였다",
            "이다",
            "이며",
            "이고",
            "으로",
            "이",
            "가",
            "은",
            "는",
            "을",
            "를",
            "의",
            "에",
            "도",
            "만",
            "로",
            "와",
            "과",
            "다",
        ),
        key=len,
        reverse=True,
    )
)
_HANGUL_RUN = re.compile(r"[가-힣]+")


def is_numeral(token: str) -> bool:
    """한자어·고유어 수사 문법에 맞는 낱말 전체(빈 문자열 아님)."""
    return bool(token) and (_SINO_NUM.fullmatch(token) is not None or _NATIVE_NUM.fullmatch(token) is not None)


def _strip_particle(token: str) -> str:
    for p in _PARTICLES:
        if token.endswith(p) and len(token) > len(p):
            return token[: -len(p)]
    return token


def _unit_occurrences(text: str) -> list[tuple[int, int, bool]]:
    """(시작, 끝, 뒤를 볼지). 단위어는 뒤가 끝·비한글·조사일 때만(대지·세대수·층계는 단위 아님).

    긴 단위어가 먼저 차지한 구간 안의 짧은 단위어는 세지 않는다('세대'의 '대').
    """
    out: list[tuple[int, int, bool]] = []
    taken: list[tuple[int, int]] = []
    for word in sorted(UNIT_WORDS, key=len, reverse=True):
        for m in re.finditer(re.escape(word), text):
            if any(a < m.end() and m.start() < b for a, b in taken):
                continue
            nxt = _HANGUL_RUN.match(text, m.end())
            if nxt is None or nxt.group(0) in _PARTICLES:
                taken.append((m.start(), m.end()))
                out.append((m.start(), m.end(), False))
    for word in METRIC_TERMS:
        for m in re.finditer(word, text):
            out.append((m.start(), m.end(), True))
    return out


def _token_before(text: str, start: int) -> tuple[str, bool]:
    """start 바로 앞 낱말과 붙어 있는지. 붙어 있으면 같은 한글 덩어리의 앞부분, 띄어 있으면 공백 1개 앞 낱말(4자 창)."""
    left = text[max(0, start - WINDOW - 1) : start]
    attached = re.search(r"[가-힣]+$", left)
    if attached:
        return attached.group(0), True
    spaced = re.search(r"([가-힣]+) $", left)
    return (spaced.group(1), False) if spaced else ("", False)


_AFTER_RE = re.compile(rf"([가-힣]{{0,3}})((?: [가-힣]+){{1,{MAX_CONNECTORS + 1}}})")


def _token_after(text: str, end: int) -> str:
    """end 뒤 낱말. 지표명에 붙은 조사와 연결어(한도·제한·기준 등, 최대 2개)는 건너뛴다. 첫 낱말은 4자 창 안일 때만."""
    m = _AFTER_RE.match(text, end)
    if m is None or (m.group(1) and m.group(1) not in _PARTICLES) or len(m.group(1)) + 1 > WINDOW:
        return ""
    skipped = 0
    for word in m.group(2).split():
        token = _strip_particle(word)
        # "한도"의 "도"를 조사로 떼지 않도록 원형도 대조한다.
        if (word in CONNECTORS or token in CONNECTORS) and skipped < MAX_CONNECTORS:
            skipped += 1
            continue
        return token
    return ""


def has_korean_numeral(text: str) -> bool:
    for start, end, metric in _unit_occurrences(text):
        before, attached = _token_before(text, start)
        if attached:
            # 붙어 쓴 단위(다섯층·삼십평): 앞 덩어리 전체가 수사일 때만(사이층·이상층 제외).
            # 지표명 앞에 붙은 말은 보지 않는다. 한층·일대는 수량이 아니다.
            if not metric and is_numeral(before) and before + text[start:end] not in UNIT_EXCEPTIONS:
                return True
        elif before and (not metric or len(before) >= 2) and is_numeral(before):
            return True
        after = _token_after(text, end) if metric else ""
        if len(after) >= 2 and is_numeral(after):  # 한 음절(이·세)은 지시어·조사와 겹쳐 지표명 뒤에서는 보지 않는다
            return True
    return False


# 보조망(이전 정규식 + ASCII 수 낱말·로마 숫자 낱말).
_SINO = "[일이삼사오육륙칠팔구십백천만]"
_NATIVE = "(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른|마흔|쉰)"
_TAIL = r"(?=[이가은는을를의에도만로와과]|입니다|이며|이고|$|[\s.,)])"
BACKUP_NUMERAL_RES: tuple[re.Pattern[str], ...] = (
    re.compile(rf"(?<![가-힣]){_SINO}+\s*(?:퍼센트|미터|제곱미터|평방미터|센티미터|밀리미터){_TAIL}"),
    re.compile(rf"(?<![가-힣])(?:[이삼사오육칠팔구]?[십백천만])+[일이삼사오육칠팔구]?\s*(?:층|대|개|미터){_TAIL}"),
    re.compile(rf"(?<![가-힣]){_NATIVE}(?:\s*{_NATIVE})?\s+(?:대|층|개|미터){_TAIL}"),
    re.compile(
        r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen"
        r"|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
        r"|hundred|thousand|million|billion|dozen|half|percent)\b",
        re.IGNORECASE,
    ),
    # 로마 숫자: 올바른 로마 숫자 꼴만(ID·LLM·mid 제외), 단위 약어 m·mm·cm는 제외.
    re.compile(
        r"(?<![A-Za-z])(?!(?:m|mm|cm)(?![A-Za-z]))"
        r"(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})(?![A-Za-z])",
        re.IGNORECASE,
    ),
)


# ---------------------------------------------------------------------------
# 단일 판정기
# ---------------------------------------------------------------------------

ViolationCode = Literal[
    "permit_guarantee",
    "permit_assertion",
    "legality_assertion",
    "expert_replacement",
    "public_endorsement",
    "disallowed_char",
    "korean_numeral",
    "ref_forbidden",
    "ref_target_mismatch",
    "ref_unknown",
    "empty",
]


def validate_free_text(
    parts: Sequence[TextPart | RefPart], *, target: str, ref_fields: Mapping[str, frozenset[str]]
) -> list[ViolationCode]:
    """위반 코드 목록(중복 없음). 빈 목록이면 통과. target = 판정 key 또는 needs_check·district_plan,
    ref_fields = 판정 key → 값이 있는 칸 집합. 금지(FAIL) 규칙도 위반이다(WARN은 compliance 노드가 옮긴다)."""
    found: list[ViolationCode] = []

    def add(code: ViolationCode) -> None:
        if code not in found:
            found.append(code)

    for part in parts:
        if isinstance(part, RefPart):
            if target in NO_REF_TARGETS:
                add("ref_forbidden")
            elif part.item != target:
                add("ref_target_mismatch")
            elif part.field not in ref_fields.get(part.item, frozenset()):
                add("ref_unknown")
        elif not all(char_allowed(ch) for ch in unicodedata.normalize("NFC", part.text)):
            add("disallowed_char")
    text = render_parts(parts)  # NFC
    if not text.strip():
        add("empty")
    if has_korean_numeral(text) or any(p.search(text) for p in BACKUP_NUMERAL_RES):
        add("korean_numeral")
    for finding in check_text(text):
        if finding.severity == "FAIL":
            add(finding.rule)  # type: ignore[arg-type]
    return found


__all__ = [
    "DISCLAIMER_VERSION",
    "REF_WORDS",
    "RefPart",
    "SentenceParts",
    "TextPart",
    "char_allowed",
    "check_text",
    "has_korean_numeral",
    "render_parts",
    "severity_of",
    "validate_free_text",
]
