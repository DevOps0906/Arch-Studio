"""그래프 `arch.review`: 출처 없는 문장 0·AR033, parts[Text|Ref] 구조(출력 문장 숫자 0), 단일 판정기, 시행 범위 검색."""

from __future__ import annotations

import sys
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from datetime import date
from typing import Any, TypeVar

import pytest
from pydantic import BaseModel

from app.ai.compliance.arch import RefPart, TextPart, char_allowed, validate_free_text
from app.ai.graphs.arch_review import (
    DISCLAIMER_VERSION,
    FEATURE,
    ArchReviewGraph,
    Draft,
    DraftItem,
    DraftSentence,
    InterpretOutput,
    ReviewGraphError,
    RewriteOutput,
    apply_compliance,
    ref_fields_of,
    resolve_refs,
    select_items,
    snapshot_from_row,
)
from app.ai.products.arch.ingest import SourceDocument, ingest
from app.ai.products.arch.knowledge import KnowledgeChunk, KnowledgeIndex, ScoredChunk, SourceMeta
from app.ai.products.arch.knowledge.evaluation import HashingEmbedder
from app.ai.products.arch.schema import ReviewResultV1

T = TypeVar("T", bound=BaseModel)
Part = TextPart | RefPart

ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
RUN = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001"
APP_DATE = "2026-03-01"

BASIS = [{"law": "건축법", "article": "제55조", "effective_from": "2020-01-01", "ordinance": False}]
JUDGMENT: dict[str, Any] = {
    "engine_version": "rules-0.1.0",
    "rule_pack_version": "2026.10.0",
    "application_date": APP_DATE,
    "pending_changes": 0,
    "items": [
        {"key": "coverage", "verdict": "PASS", "value": 59.5, "limit": 60, "unit": "pct", "basis": BASIS},
        {"key": "far", "verdict": "FAIL", "value": 210.25, "limit": 200, "unit": "pct", "basis": BASIS},
        {"key": "height", "verdict": "PASS", "value": 6000, "limit": 20000, "unit": "mm", "basis": BASIS},
        {
            "key": "parking",
            "verdict": "WARN",
            "value": 2,
            "limit": 3,
            "unit": "count",
            "basis": [
                {"law": "주차장법 시행령", "article": "별표1", "effective_from": "2020-01-01", "ordinance": True}
            ],
        },
        {"key": "seismic", "verdict": "NA", "unit": "bool", "basis": BASIS},
    ],
}
ROW: dict[str, Any] = {
    "rule_pack_version": "2026.10.0",
    "application_date": APP_DATE,
    "municipality_code": "1168010100",
    "judgment": JUDGMENT,
    "model_summary": {"use_district": "제2종일반주거지역", "ordinance_unverified": ["parking"]},
}


def doc(source_id: str, text: str, *, kind: str = "law", frm: date = date(2020, 1, 1), **over: Any) -> SourceDocument:
    meta = SourceMeta(
        kind=kind,  # type: ignore[arg-type]
        source_id=source_id,
        title=f"[예시] {source_id}",
        effective_from=frm,
        retrieved_on=date(2026, 11, 2),
        is_example=True,
        **over,
    )
    return SourceDocument(meta=meta, text=text)


CHUNKS: list[KnowledgeChunk] = ingest(
    [
        doc("coverage-law", "제55조(건폐율) 대지면적에 대한 건축면적의 비율 상한은 조례로 정한다."),
        doc("far-law", "제56조(용적률) 대지면적에 대한 연면적의 비율 상한은 조례로 정한다."),
        doc("parking-ordinance", "제10조(부설주차장) 시설면적당 설치 기준은 조례로 정한다.", jurisdiction="11680"),
        doc("future-law", "제99조(신설) 아직 시행되지 않은 조문이다.", frm=date(2027, 1, 1)),
    ],
    allow_examples=True,
)
IDS = {c.meta.source_id: c.chunk_id for c in CHUNKS}
IN_FORCE = [c for c in CHUNKS if c.meta.source_id != "future-law"]
FIELDS = ref_fields_of(snapshot_from_row(ROW).judgment)


def t(text: str) -> TextPart:
    return TextPart(type="text", text=text)


def r(item: str, field: str = "value") -> RefPart:
    return RefPart(type="ref", item=item, field=field)  # type: ignore[arg-type]


class Loader:
    def load(self, *, org: str, run_id: str) -> Mapping[str, Any] | None:
        return ROW if org == ORG and run_id == RUN else None


class FixedRetriever:
    def __init__(self, chunks: list[KnowledgeChunk]) -> None:
        self.chunks = chunks

    def search(
        self, query: str, *, application_date: date, k: int = 5, jurisdiction: str | None = None
    ) -> list[ScoredChunk]:
        return [ScoredChunk(c, 1.0) for c in self.chunks[:k]]


Rewrite = Callable[[list[Part]], list[Part]]


class FakeLLM:
    def __init__(self, interpret: InterpretOutput | Exception, rewrite: Rewrite | None = None) -> None:
        self.interpret = interpret
        self.rewrite = rewrite
        self.prompts: list[tuple[str, str]] = []
        self.rewrites = 0

    def generate(self, *, feature: str, org: str, prompt: str, output_model: type[T]) -> T:
        self.prompts.append((feature, prompt))
        if output_model is InterpretOutput:
            if isinstance(self.interpret, Exception):
                raise self.interpret
            return self.interpret  # type: ignore[return-value]
        if output_model is RewriteOutput:
            self.rewrites += 1
            if self.rewrite is None:
                raise RuntimeError("no rewrite")
            import json

            raw = json.loads(prompt.rsplit("parts: ", 1)[1])
            parts: list[Part] = [TextPart(**p) if p["type"] == "text" else RefPart(**p) for p in raw]
            return RewriteOutput(parts=self.rewrite(parts))  # type: ignore[return-value]
        raise AssertionError(output_model)


Sent = tuple[list[Part], list[str]]


def out(items: list[tuple[str, list[Sent]]], needs: list[Sent] | None = None) -> InterpretOutput:
    return InterpretOutput(
        items=[
            DraftItem(target=tg, sentences=[DraftSentence(parts=p, source_ids=s) for p, s in ss]) for tg, ss in items
        ],
        needs_check=[DraftSentence(parts=p, source_ids=s) for p, s in (needs or [])],
    )


def run(llm: FakeLLM, chunks: list[KnowledgeChunk] | None = None) -> ReviewResultV1:
    graph = ArchReviewGraph(loader=Loader(), retriever=FixedRetriever(IN_FORCE if chunks is None else chunks), llm=llm)
    return graph.run(org=ORG, run_id=RUN)


def texts(result: ReviewResultV1) -> list[str]:
    return [s.text for i in result.items for s in i.sentences] + [n.text for n in result.needs_check]


FAR = IDS["far-law"]
COV = IDS["coverage-law"]
PARK = IDS["parking-ordinance"]


# ---------------------------------------------------------------------------
# 그래프 흐름
# ---------------------------------------------------------------------------


def test_select_items_fail_margin_and_unverified_ordinance() -> None:
    selected = select_items(snapshot_from_row(ROW))
    assert [(s.index, s.key, s.verdict) for s in selected] == [
        (0, "coverage", "PASS"),
        (1, "far", "FAIL"),
        (3, "parking", "CHECK"),
    ]
    assert selected[1].engine_value is not None and selected[1].engine_value.value == 210.25


def test_happy_path_refs_render_words_numbers_only_in_engine_value() -> None:
    llm = FakeLLM(
        out(
            [("items.1", [([t("용적률 "), r("items.1"), t("이 "), r("items.1", "limit"), t("을 넘습니다.")], [FAR])])],
            needs=[([t("부설주차장 조례 기준을 확인하세요.")], [PARK])],
        )
    )
    result = run(llm)
    assert result.schema_version == "review.v1" and result.disclaimer_version == DISCLAIMER_VERSION
    far = next(i for i in result.items if i.key == "far")
    assert far.verdict == "FAIL" and far.engine_value is not None
    assert (far.engine_value.value, far.engine_value.limit, far.engine_value.unit) == (210.25, 200, "pct")
    assert far.sentences[0].text == "용적률 산정값이 한도값을 넘습니다."
    assert far.sentences[0].nature == "interpretation" and result.needs_check[0].nature == "interpretation"
    dumped = result.model_dump()
    assert dumped["items"][1]["sentences"][0]["nature"] == "interpretation"
    for text in texts(result):  # 출력 문장에 숫자성 문자 0
        assert all(char_allowed(ch) for ch in text), text
    feature, prompt = llm.prompts[0]
    assert feature == FEATURE
    for literal in ("59.5", "210.25", "6000", "20000"):
        assert literal not in prompt  # LLM은 판정 숫자를 보지 못한다


def test_uncited_and_unknown_source_sentences_removed() -> None:
    result = run(
        FakeLLM(
            out(
                [
                    (
                        "items.1",
                        [
                            ([t("출처 없는 문장입니다.")], []),
                            ([t("검색되지 않은 자료를 인용합니다.")], ["made-up@2020-01-01#0"]),
                            ([t("용적률 상한은 조례로 정합니다.")], [FAR]),
                        ],
                    ),
                    ("items.2", [([t("고르지 않은 항목입니다.")], [FAR])]),
                ],
                needs=[([t("출처 없는 확인 사항.")], [])],
            )
        )
    )
    assert texts(result) == ["용적률 상한은 조례로 정합니다."]


def test_no_cited_sentence_left_is_ar033() -> None:
    with pytest.raises(ReviewGraphError) as err:
        run(FakeLLM(out([("items.1", [([t("출처 없음.")], [])])], needs=[([t("역시 출처 없음.")], ["nope"])])))
    assert err.value.code == "AR033" and not err.value.retryable


def test_no_retrieved_chunks_is_ar033_without_llm_call() -> None:
    llm = FakeLLM(out([]))
    with pytest.raises(ReviewGraphError) as err:
        run(llm, chunks=[])
    assert err.value.code == "AR033" and llm.prompts == []


def test_every_sentence_violates_is_ar033() -> None:
    llm = FakeLLM(
        out(
            [
                ("items.1", [([t("용적률 이백을 넘습니다.")], [FAR]), ([t("허가 가능합니다.")], [FAR])]),
                ("items.0", [([t("건폐율 "), r("items.1")], [COV])]),
            ],
            needs=[([t("주차 세 대가 부족합니다.")], [PARK]), ([r("items.3")], [PARK])],
        ),
        rewrite=lambda parts: parts,  # 고치지 못함
    )
    with pytest.raises(ReviewGraphError) as err:
        run(llm)
    assert err.value.code == "AR033"
    assert llm.rewrites == 5  # 위반 문장마다 1회만


def test_violation_rewritten_once_then_kept_or_removed() -> None:
    def rewrite(parts: list[Part]) -> list[Part]:
        joined = "".join(p.text for p in parts if isinstance(p, TextPart))
        if "육십" in joined:
            return [t("건폐율 "), r("items.0"), t("은 한도에 가깝습니다.")]
        return [t("여전히 다섯층 규모입니다.")]

    llm = FakeLLM(
        out(
            [
                ("items.0", [([t("건폐율은 육십 퍼센트에 가깝습니다.")], [COV])]),
                ("items.1", [([t("다섯층 규모입니다.")], [FAR]), ([t("용적률 초과입니다.")], [FAR])]),
            ]
        ),
        rewrite=rewrite,
    )
    result = run(llm)
    assert llm.rewrites == 2
    assert texts(result) == ["건폐율 산정값은 한도에 가깝습니다.", "용적률 초과입니다."]


def test_llm_failure_is_retryable_ai_unavailable() -> None:
    with pytest.raises(ReviewGraphError) as err:
        run(FakeLLM(TimeoutError("provider 504 sk-secret")))
    assert err.value.code == "AI_UNAVAILABLE" and err.value.retryable
    assert "sk-secret" not in str(err.value)


def test_other_org_run_not_found() -> None:
    graph = ArchReviewGraph(loader=Loader(), retriever=FixedRetriever(CHUNKS), llm=FakeLLM(out([])))
    with pytest.raises(ReviewGraphError) as err:
        graph.run(org=OTHER_ORG, run_id=RUN)
    assert err.value.code == "not_found"


def test_snapshot_rejects_version_mismatch_and_extra_keys() -> None:
    for bad in (
        {**ROW, "rule_pack_version": "2026.09.0"},
        {**ROW, "judgment": {**JUDGMENT, "x": 1}},
        {**ROW, "application_date": "2026-03-02"},
    ):
        with pytest.raises(ReviewGraphError):
            snapshot_from_row(bad)


def test_retrieve_uses_application_date_and_jurisdiction_filter() -> None:
    index = KnowledgeIndex(HashingEmbedder(), allow_examples=True)
    index.add(CHUNKS)
    llm = FakeLLM(out([("items.1", [([t("용적률 기준은 조례로 정합니다.")], [FAR])])]))
    stages: list[str] = []
    graph = ArchReviewGraph(loader=Loader(), retriever=index, llm=llm, on_stage=stages.append)
    graph.run(org=ORG, run_id=RUN)
    assert stages == ["load", "retrieve", "interpret", "compliance"]
    prompt = llm.prompts[0][1]
    assert IDS["future-law"] not in prompt and PARK in prompt


# ---------------------------------------------------------------------------
# 단일 판정기(validate_free_text)
# ---------------------------------------------------------------------------


def v(parts: Sequence[Part], target: str = "items.1") -> list[str]:
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
    for ch in ("가", "힣", "ㄱ", "a", "Z", " ", ".", "·", "(", "“"):
        assert char_allowed(ch), repr(ch)


def test_ref_binding_rejections() -> None:
    assert v([t("용적률 "), r("items.0"), t("입니다.")], target="items.1") == ["ref_target_mismatch"]
    assert v([r("items.3"), t(" 확인.")], target="needs_check") == ["ref_forbidden"]
    assert v([r("items.1"), t(" 확인.")], target="district_plan") == ["ref_forbidden"]
    assert v([t("내진 "), r("items.4")], target="items.4") == ["ref_unknown"]  # NA 행: value 없음
    assert v([t("용적률 "), r("items.1"), t("입니다.")]) == []


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


def test_forbidden_phrases() -> None:
    assert v([t("허가가 가능합니다.")]) == ["legality_assertion"]
    assert v([t("구청이 보증한 계획입니다.")]) == ["public_endorsement"]
    assert v([t("전문가를 대신해 판단합니다.")]) == ["expert_replacement"]
    assert v([t("인허가를 보장합니다.")]) == ["permit_guarantee"]


def test_resolve_refs_and_compliance_give_same_verdict() -> None:
    corpus = [
        Draft("items.1", (t("용적률 "), r("items.1"), t("이 한도값을 넘습니다.")), (FAR,)),
        Draft("items.1", (t("용적률 이백을 넘습니다."),), (FAR,)),
        Draft("items.1", (t("용적률 "), r("items.0")), (FAR,)),
        Draft("needs_check", (r("items.3"),), (PARK,)),
        Draft("needs_check", (t("조례 기준을 확인하세요."),), (PARK,)),
        Draft("district_plan", (t("지구단위계획 높이 기준을 확인하세요."),), (PARK,)),
        Draft("items.0", (t("건폐율 六十 수준."),), (COV,)),
        Draft("items.0", (t("허가가 가능합니다."),), (COV,)),
        Draft("items.0", (t("건폐율 기준은 조례로 정합니다."),), (COV,)),
    ]
    judgment = snapshot_from_row(ROW).judgment
    via_resolve = resolve_refs(corpus, judgment, lambda _d: None)
    via_compliance = apply_compliance(corpus, judgment)
    assert via_resolve == via_compliance
    assert [d.target for d in via_resolve] == ["items.1", "needs_check", "district_plan", "items.0"]
