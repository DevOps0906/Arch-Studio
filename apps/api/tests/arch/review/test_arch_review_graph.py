"""그래프 `arch.review`: 출처 없는 문장 0·AR033, 숫자는 자리표시자 치환만(LLM 숫자 0), compliance, 시행 범위 검색."""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from datetime import date
from typing import Any, TypeVar

import pytest
from pydantic import BaseModel

from app.ai.compliance.arch import check_sentence
from app.ai.graphs.arch_review import (
    DISCLAIMER_VERSION,
    FEATURE,
    ArchReviewGraph,
    DraftItem,
    DraftSentence,
    InterpretOutput,
    ReviewGraphError,
    RewriteOutput,
    format_engine_value,
    select_items,
    snapshot_from_row,
)
from app.ai.products.arch.ingest import SourceDocument, ingest
from app.ai.products.arch.knowledge import KnowledgeChunk, KnowledgeIndex, ScoredChunk, SourceMeta
from app.ai.products.arch.knowledge.evaluation import HashingEmbedder
from app.ai.products.arch.schema import ReviewResultV1

T = TypeVar("T", bound=BaseModel)

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


class Loader:
    def __init__(self, row: Mapping[str, Any] | None = ROW) -> None:
        self.row = row

    def load(self, *, org: str, run_id: str) -> Mapping[str, Any] | None:
        return self.row if org == ORG and run_id == RUN else None


class FixedRetriever:
    """검색 결과 고정(시행 범위 필터는 별도 테스트에서 실제 색인으로)."""

    def __init__(self, chunks: list[KnowledgeChunk]) -> None:
        self.chunks = chunks
        self.calls: list[tuple[str, date, str | None]] = []

    def search(
        self, query: str, *, application_date: date, k: int = 5, jurisdiction: str | None = None
    ) -> list[ScoredChunk]:
        self.calls.append((query, application_date, jurisdiction))
        return [ScoredChunk(c, 1.0) for c in self.chunks[:k]]


class FakeLLM:
    def __init__(self, interpret: InterpretOutput | Exception, rewrite: Callable[[str], str] | None = None) -> None:
        self.interpret = interpret
        self.rewrite = rewrite
        self.prompts: list[tuple[str, str]] = []

    def generate(self, *, feature: str, org: str, prompt: str, output_model: type[T]) -> T:
        self.prompts.append((feature, prompt))
        if output_model is InterpretOutput:
            if isinstance(self.interpret, Exception):
                raise self.interpret
            return self.interpret  # type: ignore[return-value]
        if output_model is RewriteOutput:
            if self.rewrite is None:
                raise RuntimeError("no rewrite")
            text = prompt.rsplit("문장: ", 1)[1]
            return RewriteOutput(text=self.rewrite(text))  # type: ignore[return-value]
        raise AssertionError(output_model)


def out(
    items: list[tuple[str, list[tuple[str, list[str]]]]], needs: list[tuple[str, list[str]]] | None = None
) -> InterpretOutput:
    return InterpretOutput(
        items=[DraftItem(target=t, sentences=[DraftSentence(text=x, source_ids=s) for x, s in ss]) for t, ss in items],
        needs_check=[DraftSentence(text=x, source_ids=s) for x, s in (needs or [])],
    )


def run(llm: FakeLLM, chunks: list[KnowledgeChunk] | None = None) -> ReviewResultV1:
    graph = ArchReviewGraph(loader=Loader(), retriever=FixedRetriever(IN_FORCE if chunks is None else chunks), llm=llm)
    return graph.run(org=ORG, run_id=RUN)


def all_sentences(result: ReviewResultV1) -> list[tuple[str, list[str]]]:
    return [(s.text, s.source_ids) for i in result.items for s in i.sentences] + [
        (n.text, n.source_ids) for n in result.needs_check
    ]


def residual_digits(result: ReviewResultV1, text: str, source_ids: list[str]) -> str:
    """엔진 값 치환 문자열과 인용 조문 번호를 지운 뒤 남는 숫자(있으면 LLM이 만든 숫자)."""
    judgment = snapshot_from_row(ROW).judgment
    shown = sorted(
        (format_engine_value(float(v), i.unit) for i in judgment.items for v in (i.value, i.limit) if v is not None),
        key=len,
        reverse=True,
    )
    for s in shown:
        text = text.replace(s, "")
    by_id = {s.id: s for s in result.sources}
    for sid in source_ids:
        text = text.replace(by_id[sid].article, "")
    return "".join(ch for ch in text if ch.isdigit())


# ---------------------------------------------------------------------------


def test_select_items_fail_margin_and_unverified_ordinance() -> None:
    selected = select_items(snapshot_from_row(ROW))
    assert [(s.index, s.key, s.verdict) for s in selected] == [
        (0, "coverage", "PASS"),  # 59.5 / 60 → 5% 이내
        (1, "far", "FAIL"),
        (3, "parking", "CHECK"),  # 조례 미확인
    ]
    assert selected[1].engine_value is not None and selected[1].engine_value.value == 210.25


def test_happy_path_placeholders_resolved_engine_values_copied() -> None:
    llm = FakeLLM(
        out(
            [
                ("items.1", [("용적률 {ref:items.1.value}는 한도 {ref:items.1.limit}를 넘습니다.", [IDS["far-law"]])]),
                ("items.0", [("건폐율은 제55조 기준 한도에 가깝습니다.", [IDS["coverage-law"]])]),
            ],
            needs=[("부설주차장 조례 기준을 확인하세요.", [IDS["parking-ordinance"]])],
        )
    )
    result = run(llm)
    assert result.schema_version == "review.v1" and result.disclaimer_version == DISCLAIMER_VERSION
    far = next(i for i in result.items if i.key == "far")
    assert far.verdict == "FAIL" and far.engine_value is not None
    assert (far.engine_value.value, far.engine_value.limit, far.engine_value.unit) == (210.25, 200, "pct")
    assert far.sentences[0].text == "용적률 210.25%는 한도 200%를 넘습니다."
    assert {s.id for s in result.sources} == {IDS["far-law"], IDS["coverage-law"], IDS["parking-ordinance"]}
    parking_src = next(s for s in result.sources if s.id == IDS["parking-ordinance"])
    assert parking_src.kind == "ordinance" and parking_src.article == "제10조"
    # LLM은 판정 값 숫자를 보지 못한다(자리표시자만 받는다).
    feature, prompt = llm.prompts[0]
    assert feature == FEATURE
    for literal in ("59.5", "210.25", "6000", "20000"):
        assert literal not in prompt
    assert "{ref:items.1.value}" in prompt


def test_uncited_and_unknown_source_sentences_removed() -> None:
    result = run(
        FakeLLM(
            out(
                [
                    (
                        "items.1",
                        [
                            ("출처 없는 문장입니다.", []),
                            ("검색되지 않은 자료를 인용합니다.", ["made-up@2020-01-01#0"]),
                            ("용적률 상한은 조례로 정합니다.", [IDS["far-law"]]),
                        ],
                    ),
                    ("items.2", [("고르지 않은 항목입니다.", [IDS["far-law"]])]),
                ],
                needs=[("출처 없는 확인 사항.", [])],
            )
        )
    )
    sentences = all_sentences(result)
    assert sentences == [("용적률 상한은 조례로 정합니다.", [IDS["far-law"]])]
    assert all(sids for _, sids in sentences)


def test_no_cited_sentence_left_is_ar033() -> None:
    with pytest.raises(ReviewGraphError) as err:
        run(FakeLLM(out([("items.1", [("출처 없음.", [])])], needs=[("역시 출처 없음.", ["nope"])])))
    assert err.value.code == "AR033" and not err.value.retryable


def test_no_retrieved_chunks_is_ar033_without_llm_call() -> None:
    llm = FakeLLM(out([]))
    with pytest.raises(ReviewGraphError) as err:
        run(llm, chunks=[])
    assert err.value.code == "AR033"
    assert llm.prompts == []


def test_llm_number_rewritten_once_then_removed() -> None:
    rewrites: list[str] = []

    def rewrite(text: str) -> str:
        rewrites.append(text)
        if "58" in text:
            return "건폐율 {ref:items.0.value}는 한도에 가깝습니다."  # 자리표시자로 고침 → 통과
        return "여전히 약 12층 규모입니다."  # 또 숫자 → 제거

    result = run(
        FakeLLM(
            out(
                [
                    ("items.0", [("건폐율은 약 58%입니다.", [IDS["coverage-law"]])]),
                    ("items.1", [("약 15층 규모입니다.", [IDS["far-law"]]), ("용적률 초과입니다.", [IDS["far-law"]])]),
                ]
            ),
            rewrite=rewrite,
        )
    )
    assert len(rewrites) == 2  # 위반 문장마다 1회만
    texts = [t for t, _ in all_sentences(result)]
    assert texts == ["건폐율 59.5%는 한도에 가깝습니다.", "용적률 초과입니다."]


def test_unknown_placeholder_removed() -> None:
    result = run(
        FakeLLM(
            out(
                [
                    (
                        "items.1",
                        [
                            ("값 {ref:items.9.value}.", [IDS["far-law"]]),
                            ("용적률 {ref:items.1.value}.", [IDS["far-law"]]),
                        ],
                    )
                ]
            ),
            rewrite=lambda t: t,  # 고치지 못함
        )
    )
    assert [t for t, _ in all_sentences(result)] == ["용적률 210.25%."]


@pytest.mark.parametrize(
    "noise",
    ["60.1", "1,500", "7", "2027", "0.05", "999", "12", "210.3", "59"],
)
def test_no_llm_generated_number_reaches_output(noise: str) -> None:
    """LLM이 만든 숫자(엔진 값·인용 조문 번호 밖)는 결과에 0개."""
    result = run(
        FakeLLM(
            out(
                [
                    (
                        "items.1",
                        [
                            (f"용적률은 {noise}입니다.", [IDS["far-law"]]),
                            ("용적률 {ref:items.1.value} 초과.", [IDS["far-law"]]),
                        ],
                    ),
                    ("items.0", [(f"제55조 기준 {noise} 수준.", [IDS["coverage-law"]])]),
                ],
                needs=[(f"{noise}대 확인.", [IDS["parking-ordinance"]])],
            ),
            rewrite=lambda t: t,  # 재작성도 숫자를 그대로 둔다 → 제거돼야 함
        )
    )
    for text, sids in all_sentences(result):
        assert residual_digits(result, text, sids) == "", text
    assert [t for t, _ in all_sentences(result)] == ["용적률 210.25% 초과."]


def test_compliance_removes_assertions_and_all_removed_is_ar033() -> None:
    result = run(
        FakeLLM(
            out(
                [
                    (
                        "items.0",
                        [
                            ("이 계획은 허가 가능합니다.", [IDS["coverage-law"]]),
                            ("건축사 검토가 필요 없습니다.", [IDS["coverage-law"]]),
                            ("건폐율 기준은 조례로 정합니다.", [IDS["coverage-law"]]),
                        ],
                    )
                ]
            )
        )
    )
    assert [t for t, _ in all_sentences(result)] == ["건폐율 기준은 조례로 정합니다."]
    with pytest.raises(ReviewGraphError) as err:
        run(FakeLLM(out([("items.0", [("인허가를 보장합니다.", [IDS["coverage-law"]])])])))
    assert err.value.code == "AR033"


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
    with pytest.raises(ReviewGraphError):
        snapshot_from_row({**ROW, "rule_pack_version": "2026.09.0"})
    with pytest.raises(ReviewGraphError):
        snapshot_from_row({**ROW, "judgment": {**JUDGMENT, "x": 1}})
    with pytest.raises(ReviewGraphError):
        snapshot_from_row({**ROW, "application_date": "2026-03-02"})


def test_retrieve_uses_application_date_and_jurisdiction_filter() -> None:
    index = KnowledgeIndex(HashingEmbedder(), allow_examples=True)
    index.add(CHUNKS)
    llm = FakeLLM(out([("items.1", [("용적률 기준은 조례로 정합니다.", [IDS["far-law"]])])]))
    stages: list[str] = []
    graph = ArchReviewGraph(loader=Loader(), retriever=index, llm=llm, on_stage=stages.append)
    result = graph.run(org=ORG, run_id=RUN)
    assert stages == ["load", "retrieve", "interpret", "compliance"]
    prompt = llm.prompts[0][1]
    assert IDS["future-law"] not in prompt  # 신청 기준일 뒤 시행 조문은 검색되지 않는다
    assert IDS["parking-ordinance"] in prompt  # 관할 11680 조례는 검색된다
    assert result.items[0].key == "coverage"


def test_format_engine_value_is_deterministic() -> None:
    assert format_engine_value(1200, "mm") == "1,200mm"
    assert format_engine_value(26.666, "pct") == "26.67%"
    assert format_engine_value(3, "count") == "3대"
    assert format_engine_value(1, "bool") == "해당"
    assert not re.search(r"\d", format_engine_value(0, "bool"))


def test_check_sentence_codes() -> None:
    articles = {"제55조"}
    assert check_sentence("허가가 가능합니다.", articles) == ["legality_assertion"]
    assert check_sentence("구청이 보증한 계획입니다.", articles) == ["public_endorsement"]
    assert check_sentence("전문가를 대신해 판단합니다.", articles) == ["expert_replacement"]
    assert check_sentence("허가권자 확인이 필요합니다.", articles) == []
    # 자리표시자 밖 숫자는 엔진 값과 같아도 거부. 인용 조문 번호만 허용.
    assert check_sentence("한도는 60%입니다.", articles) == ["ungrounded_number"]
    assert check_sentence("제55조에 따라 조례로 정합니다.", articles) == []
    assert check_sentence("제56조에 따라 조례로 정합니다.", articles) == ["ungrounded_number"]
    assert check_sentence("제55조제2항에 따릅니다.", articles) == ["ungrounded_number"]


@pytest.mark.parametrize(
    "text",
    [
        "육십 퍼센트를 넘습니다.",
        "주차 세 대가 부족합니다.",
        "이십 층 규모입니다.",
        "열 미터 이격이 필요합니다.",
        "오십%입니다.",
    ],
)
def test_korean_numeral_with_unit_rejected(text: str) -> None:
    assert check_sentence(text, set()) == ["ungrounded_number"]


@pytest.mark.parametrize(
    "text", ["이 대지는 도로에 접합니다.", "세대수 기준을 확인하세요.", "사이 층에 둡니다.", "이 평면은 참고입니다."]
)
def test_common_words_not_mistaken_for_numbers(text: str) -> None:
    assert check_sentence(text, set()) == []


def test_number_bypasses_removed_and_cited_article_kept() -> None:
    """한글 수사·다른 항목 엔진 값(200%) 직접 기재는 재작성 실패 시 제거, 인용 조문 번호는 통과."""
    result = run(
        FakeLLM(
            out(
                [
                    (
                        "items.1",
                        [
                            ("용적률 한도 육십 퍼센트를 넘습니다.", [IDS["far-law"]]),
                            ("한도 200%를 넘습니다.", [IDS["far-law"]]),  # items.1.limit 값을 직접 씀 → 거부
                            ("제56조에 따라 조례로 정합니다.", [IDS["far-law"]]),  # 인용 자료 조문 → 허용
                            ("제57조도 봅니다.", [IDS["far-law"]]),  # 인용하지 않은 조문 번호 → 거부
                        ],
                    ),
                ],
                needs=[("주차 세 대가 부족합니다.", [IDS["parking-ordinance"]])],
            ),
            rewrite=lambda t: t,
        )
    )
    assert [t for t, _ in all_sentences(result)] == ["제56조에 따라 조례로 정합니다."]
