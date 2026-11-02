"""zod(packages/domain) ↔ pydantic(app.ai.products.arch.schema) 동치 테스트.

1. 구조: zod → JSON Schema(Node `tests/contract/node/dump.ts`, 테스트 시 생성)와 pydantic `model_json_schema()`를
   정규화해 비교한다(필드명·필수·타입·정수·범위·길이·추가 필드 금지·열거값).
2. 동작: 공유 코퍼스(`tests/contract/corpus/*.json`)를 양쪽에 돌려 수락/거부가 같은지, 그리고 기대와 같은지 본다.

Node가 없으면 zod 쪽 비교는 건너뛰고(이유 표시) pydantic 코퍼스 기대 검사만 돈다.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from functools import cache
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from app.ai.products.arch import schema as S

HERE = Path(__file__).parent
REPO_ROOT = HERE.parents[3]
CORPUS_DIR = HERE / "corpus"

# pydantic 모델 이름 = zod 계약 이름(node/zod-contract.ts ZOD_SCHEMAS).
MODELS: dict[str, type[BaseModel]] = {
    "DesignModelV1": S.DesignModelV1,
    "JudgmentResult": S.JudgmentResult,
    "SheetSpec": S.SheetSpec,
    "DraftingProfile": S.DraftingProfile,
    "IntakeCandidateV1": S.IntakeCandidateV1,
    "ReviewResultV1": S.ReviewResultV1,
    "LayoutIntentV1": S.LayoutIntentV1,
}
# zod 정의가 아직 packages/domain에 없는 모델(04_API.md 4.2·4.3·4.6절 문서 기준 구현).
# zod가 추가되면 이 집합에서 빼야 test_pending_set_is_exact가 통과한다 → 그때부터 자동으로 구조·코퍼스 비교 대상.
PENDING_ZOD = {"IntakeCandidateV1", "ReviewResultV1", "LayoutIntentV1"}

_DROP_KEYS = {"title", "description", "default", "examples", "$schema"}


@cache
def zod_dump() -> dict[str, Any]:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node 없음: zod 쪽 비교 생략")
    script = HERE / "node" / "dump.ts"
    out = subprocess.run([node, str(script)], cwd=REPO_ROOT, capture_output=True, text=True, timeout=60, check=False)
    if out.returncode != 0:
        pytest.fail(f"zod 덤프 실패:\n{out.stderr[-2000:]}")
    result: dict[str, Any] = json.loads(out.stdout)
    return result


def load_corpus() -> list[dict[str, Any]]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(CORPUS_DIR.glob("*.json"))]


def corpus_cases() -> list[Any]:
    """(schema, case name, expect, raw JSON) — raw는 파일의 원래 표기(1.0 등)를 보존한다."""
    out = []
    for path in sorted(CORPUS_DIR.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        for case in doc["cases"]:
            raw = json.dumps(case["value"], ensure_ascii=False)
            out.append(
                pytest.param(
                    doc["schema"],
                    case["name"],
                    case["expect"],
                    raw,
                    case.get("zod", case["expect"]),
                    id=f"{doc['schema']}-{case['name']}",
                )
            )
    return out


# --- 정규화 ------------------------------------------------------------------


def _sort_key(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def normalize(node: Any, defs: dict[str, Any]) -> Any:
    if isinstance(node, list):
        return [normalize(n, defs) for n in node]
    if not isinstance(node, dict):
        return node
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        return normalize(defs[name], defs)
    out: dict[str, Any] = {}
    for key, value in node.items():
        if key in _DROP_KEYS or key == "$defs":
            continue
        out[key] = normalize(value, defs)

    # 안전 정수 범위 제한은 pydantic 쪽에만 있다(알려진 차이, 코퍼스 `unsafe_*` 사례가 동작 차이를 고정한다).
    if out.get("type") == "integer":
        if out.get("maximum") == S.SAFE_INT:
            out.pop("maximum")
        if out.get("minimum") == -S.SAFE_INT:
            out.pop("minimum")

    if "const" in out:
        out["enum"] = [out.pop("const")]
    if "enum" in out:
        out.pop("type", None)
        out["enum"] = sorted(out["enum"], key=_sort_key)
    if "anyOf" in out:
        members = out["anyOf"]
        if all(set(m) == {"enum"} for m in members):
            out.pop("anyOf")
            out["enum"] = sorted({_sort_key(v): v for m in members for v in m["enum"]}.values(), key=_sort_key)
        else:
            out["anyOf"] = sorted(members, key=_sort_key)
    if "oneOf" in out:
        # 판별 유니온(zod discriminatedUnion ↔ pydantic Field(discriminator)): 멤버 순서는 의미가 없고,
        # pydantic 의 mapping($ref 이름)은 표현 차이라 버린다. 판별 키(propertyName)는 비교 대상이다.
        out["oneOf"] = sorted(out["oneOf"], key=_sort_key)
    if isinstance(out.get("discriminator"), dict):
        out["discriminator"] = {"propertyName": out["discriminator"].get("propertyName")}
    if out.get("type") == "object" and "properties" in out:
        required = set(out.get("required", []))
        props = {}
        for name, prop in out["properties"].items():
            if name not in required:
                prop = _strip_null(prop)  # 선택 필드의 null 허용 표기는 pydantic 표현 방식(실제로는 _NotNull로 거부)
            props[name] = prop
        out["properties"] = props
        out["required"] = sorted(required)
        out.setdefault("additionalProperties", True)
    if out.get("type") == "array" and "prefixItems" in out and out.get("items") is False:
        out.pop("items")
    return out


def _strip_null(prop: dict[str, Any]) -> dict[str, Any]:
    members = prop.get("anyOf")
    if not members:
        return prop
    kept = [m for m in members if m != {"type": "null"}]
    if len(kept) == 1:
        rest = {k: v for k, v in prop.items() if k != "anyOf"}
        return {**kept[0], **rest}
    return {**prop, "anyOf": kept}


def diff(a: Any, b: Any, path: str = "$") -> list[str]:
    if isinstance(a, dict) and isinstance(b, dict):
        out: list[str] = []
        for key in sorted(set(a) | set(b)):
            if key not in a:
                out.append(f"{path}.{key}: pydantic에만 있음 = {_sort_key(b[key])[:120]}")
            elif key not in b:
                out.append(f"{path}.{key}: zod에만 있음 = {_sort_key(a[key])[:120]}")
            else:
                out.extend(diff(a[key], b[key], f"{path}.{key}"))
        return out
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [d for i, (x, y) in enumerate(zip(a, b, strict=True)) for d in diff(x, y, f"{path}[{i}]")]
    return [] if a == b else [f"{path}: zod={_sort_key(a)[:120]} pydantic={_sort_key(b)[:120]}"]


def pydantic_schema(model: type[BaseModel]) -> Any:
    raw = model.model_json_schema()
    return normalize(raw, raw.get("$defs", {}))


# --- 테스트 ------------------------------------------------------------------


@pytest.mark.parametrize("name", sorted(set(MODELS) - PENDING_ZOD))
def test_structure_matches_zod(name: str) -> None:
    zod = normalize(zod_dump()["schemas"][name], {})
    py = pydantic_schema(MODELS[name])
    problems = diff(zod, py)
    assert not problems, f"{name} zod↔pydantic 구조 불일치:\n" + "\n".join(problems)


def test_pending_set_is_exact() -> None:
    zod_names = set(zod_dump()["schemas"])
    assert zod_names == set(MODELS) - PENDING_ZOD, "zod 계약 목록이 바뀌었다: PENDING_ZOD·MODELS를 맞춘다"


def test_every_model_has_corpus() -> None:
    assert {doc["schema"] for doc in load_corpus()} == set(MODELS)


@pytest.mark.parametrize(("schema", "case", "expect", "raw", "zod_expect"), corpus_cases())
def test_corpus_pydantic_matches_expectation(schema: str, case: str, expect: str, raw: str, zod_expect: str) -> None:
    model = MODELS[schema]
    try:
        model.model_validate_json(raw)
        accepted = True
    except ValidationError:
        accepted = False
    assert accepted == (expect == "accept"), f"{schema}/{case}"


@pytest.mark.parametrize(("schema", "case", "expect", "raw", "zod_expect"), corpus_cases())
def test_corpus_zod_and_pydantic_agree(schema: str, case: str, expect: str, raw: str, zod_expect: str) -> None:
    if schema in PENDING_ZOD:
        pytest.skip("zod 정의 없음")
    zod_ok = zod_dump()["verdicts"][schema][case]
    try:
        MODELS[schema].model_validate_json(raw)
        py_ok = True
    except ValidationError:
        py_ok = False
    # 알려진 차이(코퍼스의 `zod` 키)가 없는 사례는 양쪽이 같아야 한다. 차이가 있는 사례는 차이 자체를 고정한다:
    # zod가 고쳐지면(차이가 사라지면) 이 단언이 깨져 코퍼스의 `zod` 키를 지우게 한다.
    assert zod_ok == (zod_expect == "accept"), f"{schema}/{case}: zod 판정이 코퍼스 기록과 다름"
    assert py_ok == (expect == "accept"), f"{schema}/{case}: pydantic 판정이 기대와 다름"
    if zod_expect == expect:
        assert zod_ok == py_ok, f"{schema}/{case}: zod={zod_ok} pydantic={py_ok}"


def test_all_models_forbid_extra_fields_everywhere() -> None:
    def walk(node: Any, path: str) -> list[str]:
        bad: list[str] = []
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node and node.get("additionalProperties") is not False:
                bad.append(path)
            for key, value in node.items():
                bad += walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for i, value in enumerate(node):
                bad += walk(value, f"{path}[{i}]")
        return bad

    for name, model in MODELS.items():
        assert walk(pydantic_schema(model), name) == []


# --- 정규화기 자체 검증(판별 유니온, AR-06-086 결정 9): 일부러 어긋난 스키마를 잡아내야 한다 -----------------------


def _variant(kind: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    props = {"id": {"type": "string"}, "kind": {"const": kind}, **(extra or {})}
    return {"type": "object", "properties": props, "required": ["id", "kind"], "additionalProperties": False}


def _union(*variants: dict[str, Any], key: str = "kind") -> dict[str, Any]:
    return {"oneOf": list(variants), "discriminator": {"propertyName": key}}


def test_union_normalizer_ignores_member_order_and_mapping() -> None:
    a, b = _variant("a"), _variant("b", {"n": {"type": "number"}})
    zod = _union(a, b)
    py = {**_union(b, a), "discriminator": {"propertyName": "kind", "mapping": {"a": "#/$defs/A", "b": "#/$defs/B"}}}
    assert diff(normalize(zod, {}), normalize(py, {})) == []


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda u: {**u, "oneOf": u["oneOf"][:1]}, id="member_missing"),
        pytest.param(lambda u: {**u, "oneOf": [*u["oneOf"], _variant("c")]}, id="member_extra"),
        pytest.param(lambda u: {**u, "discriminator": {"propertyName": "type"}}, id="discriminator_renamed"),
        pytest.param(lambda u: {**u, "oneOf": [_variant("a"), _variant("z")]}, id="kind_value_changed"),
        pytest.param(
            lambda u: {**u, "oneOf": [u["oneOf"][0], _variant("b", {"n": {"type": "string"}})]},
            id="field_type_changed",
        ),
        pytest.param(
            lambda u: {**u, "oneOf": [u["oneOf"][0], {**u["oneOf"][1], "additionalProperties": True}]},
            id="extra_keys_allowed",
        ),
        pytest.param(lambda u: {"anyOf": u["oneOf"]}, id="oneOf_vs_anyOf"),
    ],
)
def test_union_normalizer_detects_mismatch(mutate: Any) -> None:
    zod = _union(_variant("a"), _variant("b", {"n": {"type": "number"}}))
    assert diff(normalize(zod, {}), normalize(mutate(zod), {})), "어긋난 스키마를 잡아내지 못했다"


def test_sheet_annotations_are_a_discriminated_union_on_both_sides() -> None:
    py = pydantic_schema(S.SheetSpec)
    node = py["properties"]["annotations"]
    items = (node.get("anyOf") or [node])[0]["items"] if "anyOf" in node else node["items"]
    assert items["discriminator"]["propertyName"] == "kind"
    assert len(items["oneOf"]) == 5
    zod = normalize(zod_dump()["schemas"]["SheetSpec"], {})
    assert zod["properties"]["annotations"]["items"]["discriminator"] == {"propertyName": "kind"}
