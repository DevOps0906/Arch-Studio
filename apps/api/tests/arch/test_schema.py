"""AI 결과 스키마: LLM은 좌표를 만들지 않는다(AGENTS.md 3장, 02_ARCHITECTURE.md 위험 #10)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from app.ai.products.arch.schema import IntakeCandidateV1, LayoutIntentV1, ReviewResultV1, check_layout_rooms

FORBIDDEN_NAMES = {"x", "y", "z", "polygon", "outline", "outer", "points", "coordinates", "area_mm2", "w", "h"}


def _walk(node: Any, path: str = "$") -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    if isinstance(node, dict):
        out.append((path, node))
        for key, value in node.items():
            out += _walk(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            out += _walk(value, f"{path}[{i}]")
    return out


def _schema(model: type[BaseModel]) -> dict[str, Any]:
    return model.model_json_schema()


@pytest.mark.parametrize("model", [IntakeCandidateV1, LayoutIntentV1, ReviewResultV1])
def test_no_coordinate_fields(model: type[BaseModel]) -> None:
    names = {name for _, node in _walk(_schema(model)) for name in node.get("properties", {})}
    assert not names & FORBIDDEN_NAMES


def test_layout_has_no_numeric_fields() -> None:
    # 파라미터 제안만: 수 타입은 weight 열거값(1|2|3)뿐이다. 좌표·치수·면적이 들어갈 자리가 없다.
    numeric = [
        path
        for path, node in _walk(_schema(LayoutIntentV1))
        if (node.get("type") in {"number", "integer"} and "enum" not in node) or "prefixItems" in node
    ]
    assert numeric == []
    weight = _schema(LayoutIntentV1)["$defs"]["LayoutAdjacency"]["properties"]["weight"]
    assert sorted(weight["enum"]) == [1, 2, 3]


def test_intake_numbers_are_only_user_stated() -> None:
    def is_numeric(prop: dict[str, Any]) -> bool:
        types = {prop.get("type")} | {m.get("type") for m in prop.get("anyOf", [])}
        return bool(types & {"number", "integer"})

    numeric = sorted(
        name
        for _, node in _walk(_schema(IntakeCandidateV1))
        for name, prop in node.get("properties", {}).items()
        if is_numeric(prop)
    )
    # answer(체크리스트 답), count(실 개수), target_area_m2(사용자가 말한 값만, 근거 필수)
    assert numeric == ["answer", "count", "target_area_m2"]


def _layout(rooms: list[list[str]]) -> dict[str, Any]:
    variant = {
        "label": "A",
        "zones": [{"id": f"z{i}", "kind": "public", "rooms": r} for i, r in enumerate(rooms)],
        "adjacency": [{"a": "r1", "b": "r2", "relation": "near", "weight": 1}],
    }
    return {"schema_version": "layout_intent.v1", "variants": [variant, variant, variant]}


def test_check_layout_rooms_ok() -> None:
    intent = LayoutIntentV1.model_validate(_layout([["r1"], ["r2", "r3"]]))
    check_layout_rooms(intent, ["r1", "r2", "r3"])


@pytest.mark.parametrize(
    ("rooms", "ids"),
    [
        ([["r1"], ["r2"]], ["r1", "r2", "r3"]),  # 빠진 실
        ([["r1", "r9"], ["r2"]], ["r1", "r2"]),  # 없는 실(LLM이 지어낸 실)
        ([["r1", "r2"], ["r2"]], ["r1", "r2"]),  # 중복 배정
    ],
)
def test_check_layout_rooms_rejects(rooms: list[list[str]], ids: list[str]) -> None:
    intent = LayoutIntentV1.model_validate(_layout(rooms))
    with pytest.raises(ValueError, match="variants"):
        check_layout_rooms(intent, ids)


def test_check_layout_adjacency_unknown_room() -> None:
    doc = _layout([["r1"], ["r2"]])
    doc["variants"][0]["adjacency"] = [{"a": "r1", "b": "ghost", "relation": "door", "weight": 2}]
    with pytest.raises(ValueError, match="인접"):
        check_layout_rooms(LayoutIntentV1.model_validate(doc), ["r1", "r2"])


def test_string_numbers_not_coerced() -> None:
    doc = _layout([["r1"], ["r2"]])
    doc["variants"][0]["adjacency"][0]["weight"] = "2"
    with pytest.raises(ValidationError):
        LayoutIntentV1.model_validate_json(json.dumps(doc))


def test_nan_rejected() -> None:
    raw = (
        '{"schema_version":"intake.v1","checklist_answers":[],"memo":[],'
        '"rooms":[{"name":"a","use":"b","count":1,"target_area_m2":NaN,"area_evidence":"x"}]}'
    )
    with pytest.raises(ValidationError):
        IntakeCandidateV1.model_validate_json(raw)
