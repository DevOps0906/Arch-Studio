"""Arch compliance 검사기(02_ARCHITECTURE.md 5장 `arch.review` compliance 열, `AI_ARCHITECTURE.md:117`).

AI 문장은 `parts: [Text | Ref]` 구조다. Ref(`{item, field}`)만이 엔진 값을 가리킬 수 있고, 출력 문장에는 숫자 대신
고정 낱말(산정값·한도값)로 그려진다. 숫자는 ReviewItem.engine_value·verdict로만 내보낸다(수치는 엔진, 문장은 해석).

`validate_free_text` 하나가 resolve_refs와 compliance 두 노드의 같은 판정기다(tasks/logs/AR-06-051.md [DECISION]).
1. 문자 허용 목록(열거된 것만 통과): 한글 음절·자모, ASCII 알파벳, 공백(U+0020), 고정 구두점.
   유니코드 범주 N*·numeric() 값이 있는 문자·한자·전각·원문자·로마 숫자 등 그 밖은 열거 없이 모두 거부.
2. 한글 수사(닫힌 집합): 단위어·지표명 바로 앞뒤 낱말(4자 창)이 수사 문법(삼십·이백·다섯·스물다섯 등)이면 거부.
   기존 정규식(육십 퍼센트·세 대 등)은 보조망. ASCII 수 낱말(six·ten)·로마 숫자 낱말(VI)도 보조망으로 거부.
3. Ref 바인딩: 문장 target과 같은 item만, needs_check·district_plan 문장은 Ref 금지, 값이 없는 칸 금지.
4. 금지 표현: 인허가 보장, 적법성 단정, 전문가 대체, 공공기관 보증.
잔여 위험(수사 없는 수량 주장, 예: "한도의 절반")은 [DECISION]에 적었다.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Annotated, Literal

from pydantic import Field

from app.ai.products.arch.schema import T_KEY_MAX, T_SENTENCE_MAX, Strict

ViolationCode = Literal[
    "permit_guarantee",
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

# ---------------------------------------------------------------------------
# 문장 구조(LLM 출력)
# ---------------------------------------------------------------------------


class TextPart(Strict):
    type: Literal["text"]
    text: T_SENTENCE_MAX


class RefPart(Strict):
    """엔진 값 참조. item = "items.<i>"(문장 target과 같아야 한다), field = value | limit."""

    type: Literal["ref"]
    item: T_KEY_MAX
    field: Literal["value", "limit"]


SentencePart = Annotated[TextPart | RefPart, Field(discriminator="type")]
SentenceParts = Annotated[list[SentencePart], Field(min_length=1, max_length=20)]

# 출력 문장에서 Ref 자리에 쓰는 고정 낱말(숫자 없음, 받침 있는 말이라 조사는 은·을·이).
REF_WORDS: Mapping[str, str] = {"value": "산정값", "limit": "한도값"}
NO_REF_TARGETS = frozenset({"needs_check", "district_plan"})


def render_parts(parts: Sequence[TextPart | RefPart]) -> str:
    return "".join(p.text if isinstance(p, TextPart) else REF_WORDS[p.field] for p in parts)


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
        0xAC00 <= o <= 0xD7A3  # 한글 음절
        or 0x1100 <= o <= 0x11FF  # 한글 자모
        or 0x3131 <= o <= 0x318E  # 한글 호환 자모
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
)
WINDOW = 4
_D = "[일이삼사오육륙칠팔구]"
_SINO_NUM = re.compile(rf"(?:{_D}?천)?(?:{_D}?백)?(?:{_D}?십)?{_D}?(?:만|억)?")
_NATIVE_NUM = re.compile(
    "(?:열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)?(?:하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉)?"
)
_PARTICLES = (
    "입니다",
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
    """(시작, 끝, 지표명 여부). 단위어는 뒤가 끝·비한글·조사일 때만(대지·세대수·층계는 단위 아님)."""
    out: list[tuple[int, int, bool]] = []
    for word in UNIT_WORDS:
        for m in re.finditer(re.escape(word), text):
            nxt = _HANGUL_RUN.match(text, m.end())
            if nxt is None or nxt.group(0) in _PARTICLES:
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


def _token_after(text: str, end: int) -> str:
    """end 뒤 낱말(지표명에 붙은 조사는 건너뛴다: '용적률은 이백'). 낱말 시작이 4자 창 안일 때만."""
    m = re.match(r"([가-힣]{0,3}) ([가-힣]+)", text[end:])
    if m is None or (m.group(1) and m.group(1) not in _PARTICLES) or m.start(2) > WINDOW:
        return ""
    return _strip_particle(m.group(2))


def has_korean_numeral(text: str) -> bool:
    for start, end, metric in _unit_occurrences(text):
        before, attached = _token_before(text, start)
        if attached:
            # 붙어 쓴 단위(다섯층·삼십평): 앞 덩어리 전체가 수사일 때만(사이층·이상층 제외).
            # 지표명 앞에 붙은 말은 보지 않는다.
            if not metric and is_numeral(before):
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
        r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty"
        r"|seventy|eighty|ninety|hundred|thousand|million|half|percent)\b",
        re.IGNORECASE,
    ),
    re.compile(r"(?<![A-Za-z])[IVXLCDM]{1,6}(?![A-Za-z])"),
)


# ---------------------------------------------------------------------------
# 단일 판정기
# ---------------------------------------------------------------------------


def validate_free_text(
    parts: Sequence[TextPart | RefPart], *, target: str, ref_fields: Mapping[str, frozenset[str]]
) -> list[ViolationCode]:
    """위반 코드 목록(중복 없음). 빈 목록이면 통과. ref_fields = "items.<i>" → 값이 있는 칸 집합."""
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
        elif not all(char_allowed(ch) for ch in part.text):
            add("disallowed_char")
    text = render_parts(parts)
    if not text.strip():
        add("empty")
    if has_korean_numeral(text) or any(p.search(text) for p in BACKUP_NUMERAL_RES):
        add("korean_numeral")
    for code, pattern in _PATTERNS:
        if pattern.search(text):
            add(code)
    return found
