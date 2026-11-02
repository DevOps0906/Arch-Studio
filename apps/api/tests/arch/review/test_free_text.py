"""AR-06-051 숫자 차단 단일 판정기 `validate_free_text` 코퍼스(로컬 구현 6f60630·666c065·217305e에서 이식).

유니코드 전수·한글 수사 양성/음성·NFC·자모·연결어·ASCII 보조망·로마 숫자 오탐, Ref 바인딩, resolve_refs와
compliance 판정 일치. target = 판정 key(needs_check·district_plan은 Ref 금지).
"""

from __future__ import annotations

import sys
import unicodedata
from collections.abc import Sequence
from typing import Any

import pytest

from app.ai.compliance.arch import RefPart, TextPart, char_allowed, validate_free_text
from app.ai.graphs.arch_review import (
    NEEDS_CHECK,
    ReviewDeps,
    _Sentence,
    compliance,
    resolve_refs,
)
from app.ai.products.arch.knowledge.embedding import HashEmbedder
from app.ai.products.arch.knowledge.store import InMemoryStore
from app.ai.products.arch.schema import ReviewLlmRewrite

Part = TextPart | RefPart
# far·coverage: 값·한도 있음, seismic: NA(값 없음)
FIELDS: dict[str, frozenset[str]] = {
    "coverage": frozenset({"value", "limit"}),
    "far": frozenset({"value", "limit"}),
    "parking": frozenset({"value", "limit"}),
    "seismic": frozenset(),
}


def t(text: str) -> TextPart:
    return TextPart(type="text", text=text)


def r(item: str, field: str = "value") -> RefPart:
    return RefPart(type="ref", item=item, field=field)  # type: ignore[arg-type]


def v(parts: Sequence[Part], target: str = "far") -> list[str]:
    return list(validate_free_text(parts, target=target, ref_fields=FIELDS))


def numeric_codepoints() -> list[str]:
    out: list[str] = []
    for cp in range(sys.maxunicode + 1):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        ch = chr(cp)
        if unicodedata.category(ch).startswith("N") or unicodedata.numeric(ch, None) is not None:
            out.append(ch)
    return out


def test_every_numeric_codepoint_rejected() -> None:
    """유니코드 전수: 범주 N*·numeric 값이 있는 코드포인트(아라비아·아랍-인도·로마·원문자·한자 六 등)는 모두 거부."""
    chars = numeric_codepoints()
    assert len(chars) > 1500
    assert "六" in chars and "Ⅵ" in chars and "⑥" in chars and "٦" in chars and "６" in chars
    allowed = [ch for ch in chars if char_allowed(ch)]
    assert allowed == []
    assert v([t("용적률 " + "".join(chars[:200]))]) == ["disallowed_char"]


def test_other_scripts_rejected_without_enumeration() -> None:
    for ch in ("漢", "Ａ", "％", "㎡", "①", "Ⅻ", "½", "²", "€", "　", "\t", "\n"):
        assert not char_allowed(ch), repr(ch)
    for ch in ("가", "힣", "a", "Z", " ", ".", "·", "(", "“"):
        assert char_allowed(ch), repr(ch)


def test_ref_binding_rejections() -> None:
    assert v([t("용적률 "), r("coverage"), t("입니다.")], target="far") == ["ref_target_mismatch"]
    assert v([r("parking"), t(" 확인.")], target=NEEDS_CHECK) == ["ref_forbidden"]
    assert v([r("far"), t(" 확인.")], target="district_plan") == ["ref_forbidden"]
    assert v([t("내진 "), r("seismic")], target="seismic") == ["ref_unknown"]  # NA 행: value 없음
    assert v([t("내진 "), r("unknown_key")], target="unknown_key") == ["ref_unknown"]
    assert v([t("용적률 "), r("far"), t("입니다.")]) == []


@pytest.mark.parametrize(
    "text",
    [
        "삼 층 규모입니다.",
        "다섯층입니다.",
        "삼십 평 이상입니다.",
        "용적률 이백을 넘습니다.",
        "용적률은 이백입니다.",
        "육십 퍼센트를 넘습니다.",
        "주차 세 대가 부족합니다.",
        "이십 층 규모입니다.",
        "스물다섯 세대입니다.",
        "six floors",
        "VI층",
    ],
)
def test_korean_numeral_positive_corpus(text: str) -> None:
    assert "korean_numeral" in v([t(text)])


@pytest.mark.parametrize(
    "text",
    [
        "이 대지는 도로에 접합니다.",
        "세대수 기준을 확인하세요.",
        "사이 층에 둡니다.",
        "일부 구역입니다.",
        "이상이 없는지 확인하세요.",
        "천장 높이를 확인하세요.",
        "백화점 용도입니다.",
        "용적률이 한도값을 넘습니다.",
        "건폐율 기준은 조례로 정합니다.",
        "주차대수 기준을 확인하세요.",
    ],
)
def test_korean_numeral_negative_corpus(text: str) -> None:
    assert v([t(text)]) == []


def test_forbidden_phrases_are_violations() -> None:
    # 금지(FAIL) 규칙은 원격 규칙 사전(check_text)을 그대로 쓴다.
    assert v([t("허가가 가능합니다.")]) == ["permit_assertion", "legality_assertion"]  # 원격·로컬 규칙 둘 다
    assert v([t("지자체가 보증한 계획입니다.")]) == ["public_endorsement"]
    assert v([t("건축사 검토는 불필요합니다.")]) == ["expert_replacement"]
    assert v([t("인허가를 보장합니다.")]) == ["permit_guarantee"]
    assert v([t("적법합니다.")]) == ["legality_assertion"]
    assert v([t("큰 문제없습니다.")]) == []  # WARN은 위반 아님(compliance가 확인 필요로 옮긴다)


@pytest.mark.parametrize(
    ("text", "code"),
    [
        # 로컬 규칙(합집합으로 추가): 원격 규칙만으로는 통과하던 표현
        ("구청이 보증한 계획입니다.", "public_endorsement"),
        ("국토교통부가 인증한 설계입니다.", "public_endorsement"),
        ("전문가를 대신해 판단합니다.", "expert_replacement"),
        ("설계자의 검토가 필요하지 않습니다.", "expert_replacement"),
        ("심의 통과는 틀림없습니다.", "permit_guarantee"),
        ("승인은 확실합니다.", "permit_guarantee"),
        ("신축이 충분히 가능합니다.", "legality_assertion"),
        ("적법한 것으로 판단됩니다.", "legality_assertion"),
        ("위법하지 않습니다.", "legality_assertion"),
        ("심의를 통과할 것입니다.", "legality_assertion"),
    ],
)
def test_local_forbidden_phrases_positive(text: str, code: str) -> None:
    assert code in v([t(text)])


@pytest.mark.parametrize(
    "text",
    [
        "구청 담당 부서에 기준을 확인하세요.",
        "전문가 검토를 받으세요.",
        "건축사와 함께 확인하세요.",
        "허가권자 협의가 필요합니다.",
        "심의 대상인지 확인하세요.",
        "신축 계획의 조례 기준을 확인하세요.",
        "승인 절차를 확인하세요.",
    ],
)
def test_local_forbidden_phrases_negative(text: str) -> None:
    assert v([t(text)]) == []


class _SameRewriteLLM:
    """재작성 요청에 원래 parts를 그대로 돌려준다(고치지 못함)."""

    def generate(
        self, *, feature: str, org: str, prompt: str, output_model: type[Any], timeout_s: float | None = None
    ) -> Any:
        import json

        raw = json.loads(prompt.rsplit("parts: ", 1)[1].replace("&lt;", "<"))
        parts: list[Part] = [TextPart(**p) if p["type"] == "text" else RefPart(**p) for p in raw]
        assert output_model is ReviewLlmRewrite
        return ReviewLlmRewrite(parts=parts)


def test_resolve_refs_and_compliance_give_same_verdict() -> None:
    def s(*parts: Part) -> _Sentence:
        return _Sentence(tuple(parts), ["src#0"])

    drafts = {
        "far": (
            [
                s(t("용적률 "), r("far"), t("이 한도값을 넘습니다.")),
                s(t("용적률 이백을 넘습니다.")),
                s(t("용적률 "), r("coverage")),
                s(t("용적률 六十 수준.")),
                s(t("허가가 가능합니다.")),
                s(t("용적률 기준은 조례로 정합니다.")),
            ],
            [s(r("far")), s(t("조례 기준을 확인하세요."))],
        )
    }
    deps = ReviewDeps(llm=_SameRewriteLLM(), store=InMemoryStore(), embedder=HashEmbedder())
    via_resolve = resolve_refs(deps, org="o", drafts=drafts, fields=FIELDS, deadline=deps.clock() + 60)
    via_compliance = compliance(drafts, FIELDS)
    assert via_resolve == via_compliance
    kept, needs = via_resolve["far"]
    assert [x.text for x in kept] == ["용적률 산정값이 한도값을 넘습니다.", "용적률 기준은 조례로 정합니다."]
    assert [x.text for x in needs] == ["조례 기준을 확인하세요."]


# ---------------------------------------------------------------------------
# 재리뷰 3차: NFC·자모·연결어·오탐
# ---------------------------------------------------------------------------


def nfd(text: str) -> str:
    return unicodedata.normalize("NFD", text)


def raw_part(text: str) -> TextPart:
    """정규화 검증을 거치지 않은 TextPart(그래프 밖에서 들어온 값도 판정기가 NFC로 다시 본다)."""
    return TextPart.model_construct(type="text", text=text)


@pytest.mark.parametrize(
    ("text", "code"),
    [
        (nfd("삼십 평 이상입니다."), "korean_numeral"),
        (nfd("다섯층입니다."), "korean_numeral"),
        (nfd("허가 가능합니다."), "permit_assertion"),
    ],
)
def test_nfd_input_is_normalized_then_caught(text: str, code: str) -> None:
    assert text != unicodedata.normalize("NFC", text)
    assert code in v([t(text)])  # 모델 검증(NFC 정규화) 경로
    assert code in v([raw_part(text)])  # 판정기 자체 NFC 경로


@pytest.mark.parametrize("text", ["삼십ㅤ평", "용적률ᅠ이백", "삼십ᅟ평", "ㄱ", "ᄀ"])
def test_jamo_and_fillers_rejected(text: str) -> None:
    assert "disallowed_char" in v([raw_part(text)])


def test_every_non_syllable_hangul_codepoint_rejected() -> None:
    """음절(AC00–D7A3) 밖의 한글 코드포인트(결합·호환·확장 자모, 반각 한글, 채움 문자)는 모두 거부."""
    ranges = [(0x1100, 0x11FF), (0x3130, 0x318F), (0xA960, 0xA97F), (0xD7B0, 0xD7FF), (0xFFA0, 0xFFDF)]
    cps = [cp for a, b in ranges for cp in range(a, b + 1)]
    assert 0x115F in cps and 0x1160 in cps and 0x3164 in cps
    assert [hex(cp) for cp in cps if char_allowed(chr(cp))] == []
    hangul_named = [
        cp
        for cp in range(sys.maxunicode + 1)
        if not 0xD800 <= cp <= 0xDFFF and "HANGUL" in unicodedata.name(chr(cp), "") and not 0xAC00 <= cp <= 0xD7A3
    ]
    assert hangul_named and [hex(cp) for cp in hangul_named if char_allowed(chr(cp))] == []


@pytest.mark.parametrize(
    "text",
    [
        "건폐율 한도는 육십입니다.",
        "건폐율 기준 육십입니다.",
        "용적률 최대 이백입니다.",
        "높이 제한 삼십 이하입니다.",
        "층수 제한은 다섯입니다.",
        "건폐율이 육십이다.",
        "백분의 육십입니다.",
        "만 세대 규모입니다.",
        "백 세대 이상입니다.",
    ],
)
def test_connector_and_more_positive(text: str) -> None:
    assert "korean_numeral" in v([t(text)])


@pytest.mark.parametrize(
    "text",
    [
        "세대 수에 따라 다릅니다.",
        "세대의 규모를 확인하세요.",
        "세대 구성을 확인하세요.",
        "한층 더 엄격한 기준입니다.",
        "주변 일대 지역입니다.",
    ],
)
def test_connector_and_more_negative(text: str) -> None:
    assert v([t(text)]) == []


@pytest.mark.parametrize("text", ["THIRTEEN floors", "a Dozen units", "one Billion", "Nineteen", "xii"])
def test_ascii_backup_ignorecase(text: str) -> None:
    assert "korean_numeral" in v([t(text)])


@pytest.mark.parametrize(
    "text",
    ["용적률 한도 이백", "용적률 한도 이백 이하", "건폐율 한도 육십이다", "vi", "XII 구역"],
)
def test_connector_without_particle_and_roman_rejected(text: str) -> None:
    # 재검증 🟠: "한도"의 "도"를 조사로 떼면 연결어 건너뛰기가 실패하던 경우, 소문자 로마 숫자.
    assert "korean_numeral" in v([t(text)])


@pytest.mark.parametrize("text", ["단위는 mm 입니다", "cm 단위", "ID 확인", "LLM 해석", "mid 구간"])
def test_ascii_abbreviations_not_roman(text: str) -> None:
    # 재검증 🟡: 단위·약어가 로마 숫자로 오탐되지 않는다.
    assert v([t(text)]) == []
