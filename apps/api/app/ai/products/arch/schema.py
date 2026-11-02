"""Arch 계약 스키마(pydantic v2). 두 부류다.

1. 로컬 엔진 계약 사본(04_API.md 4.7절): DesignModelV1, JudgmentResult, SheetSpec, DraftingProfile.
   정본은 `packages/domain`(zod)이고 이 파일은 **필드 단위 사본**이다. 바꾸면 동치 테스트
   (`tests/contract/test_zod_equivalence.py`)가 실패한다. 먼저 zod를 바꾸고 여기를 맞춘다(02_ARCHITECTURE.md 위험 #3).
2. AI 그래프 결과(04_API.md 4.2·4.3·4.6절): ReviewResultV1, IntakeCandidateV1, LayoutIntentV1.
   LLM 구조화 출력을 받는 모델이다. **좌표·치수·면적 계산 필드가 없고**(LayoutIntent는 파라미터 제안만),
   정의 밖 키는 모두 거부한다(위험 #10, 프롬프트 인젝션이 좌표를 들여오는 경로 차단).
   2026-10-29 현재 zod 쪽 정의가 `packages/domain`에 없다(문서 기준 구현, tasks/logs/AR-06-046.md).

zod 의미와 맞추는 규칙:
- 모든 객체 `extra="forbid"`(= zod `.strict()`), `strict=True`(문자열 "1"을 수로, 1을 문자열로 바꾸지 않음).
- `z.number().int()` = `Int`: 정수만. JSON `1.0`은 JS에서 1과 같아 zod가 받으므로 소수부 0인 실수는 받는다.
  bool 거부.
- `.optional()` = `X | None = None`: 키 생략은 허용, 명시적 `null`은 거부(`Strict._optional_not_null`).
- 수 리터럴(`z.literal(1)`)은 `true`를 거부한다(파이썬 `True == 1` 함정).
- NaN·Infinity 거부.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# 공통 타입
# ---------------------------------------------------------------------------

MM_COORD_LIMIT = 10_000_000  # packages/domain units.ts 와 같은 값(±10km)


def _int_like(value: Any) -> Any:
    if isinstance(value, bool):
        raise ValueError("정수가 필요합니다(불리언 불가)")
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


# 안전 정수 범위(±(2^53−1)). JS `JSON.parse`는 이보다 큰 정수를 정밀도 손실로 바꾸므로 양쪽이 같은 값을 보게 제한한다.
# 주의: zod `z.number().int()`는 이 범위를 강제하지 않는다(packages/domain 수정 금지 → 후속: zod에도 `.safe()` 필요).
# 동치 코퍼스의 `unsafe_*` 사례가 이 차이를 `zod` 키로 기록한다.
SAFE_INT = 2**53 - 1

Int = Annotated[int, Field(ge=-SAFE_INT, le=SAFE_INT), BeforeValidator(_int_like)]
NonNegInt = Annotated[int, Field(ge=0, le=SAFE_INT), BeforeValidator(_int_like)]
Mm = Annotated[int, Field(ge=-MM_COORD_LIMIT, le=MM_COORD_LIMIT), BeforeValidator(_int_like)]
NonNegMm = Annotated[int, Field(ge=0, le=MM_COORD_LIMIT), BeforeValidator(_int_like)]
Point = tuple[Mm, Mm]


def _max_len(limit: int) -> Any:
    """zod `.max(n)`은 UTF-16 코드 단위로 센다. 같은 기준으로 맞춘다(한글은 1, 이모지는 2)."""

    def check(value: str) -> str:
        if len(value.encode("utf-16-le")) // 2 > limit:
            raise ValueError(f"{limit}자 이하여야 합니다")
        return value

    return AfterValidator(check)


class Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False, frozen=True)

    @model_validator(mode="after")
    def _optional_not_null(self) -> Strict:
        """선택 필드(`X | None = None`)는 키 생략만 허용하고 명시적 null은 거부한다(zod `.optional()`).

        BeforeValidator로 막으면 안쪽 검증이 파이썬 모드로 바뀌어 strict 튜플이 JSON 배열을 거부한다
        (동치 코퍼스가 잡은 결함, tasks/logs/AR-06-046.md). 그래서 after 단계에서 model_fields_set으로 판정한다.
        """
        fields = type(self).model_fields
        for name in self.model_fields_set:
            if not fields[name].is_required() and getattr(self, name) is None:
                raise ValueError(f"{name}: null은 허용하지 않습니다(키를 생략하세요)")
        return self


# ---------------------------------------------------------------------------
# 1. DesignModel v1 (packages/domain/src/design-model.ts)
# ---------------------------------------------------------------------------


class Polygon(Strict):
    outer: Annotated[list[Point], Field(min_length=3)]
    holes: list[Annotated[list[Point], Field(min_length=3)]] | None = None


class Road(Strict):
    edge_index: NonNegInt
    width_mm: NonNegMm


class Zoning(Strict):
    use_district: Annotated[str, Field(min_length=1)]
    districts: list[str]
    building_line: list[Point] | None = None


class Parcel(Strict):
    pnu: str | None = None
    address_label: str | None = None


class Site(Strict):
    boundary: Polygon
    north_angle_deg: float
    roads: list[Road]
    zoning: Zoning
    parcel: Parcel


class RuleContext(Strict):
    rule_pack_version: str
    application_date: str
    municipality_code: str
    ordinance_applied: bool


class Floor(Strict):
    id: str
    level: Int  # 지하 -1, 1층 1
    height_mm: Mm
    use: str


class Roof(Strict):
    type: Literal["flat", "gable", "hip", "shed"]
    pitch: float | None = None


class Mass(Strict):
    id: str
    footprint: Polygon
    base_level_mm: Mm
    floors: list[Floor]
    roof: Roof


class Room(Strict):
    id: str
    name: str
    use: str
    polygon: Polygon


class OpeningHost(Strict):
    room_id: str
    edge_index: NonNegInt


class Opening(Strict):
    id: str
    kind: Literal["door", "window"]
    host: OpeningHost
    offset_mm: Mm
    width_mm: Mm
    swing: Literal["left", "right"] | None = None


class FloorLayout(Strict):
    floor_id: str
    rooms: list[Room]
    openings: list[Opening]


ChecklistAnswer = str | float | bool | list[str]


class ProgramTarget(Strict):
    name: str
    use: str
    target_area_m2: float


class Program(Strict):
    checklist_answers: dict[str, ChecklistAnswer]
    targets: list[ProgramTarget]
    user_locked_rows: list[str]


class Meta(Strict):
    created_by_engine_version: str


def _exact_int(expected: int) -> Any:
    def check(value: Any) -> Any:
        if isinstance(value, bool) or value != expected:
            raise ValueError(f"{expected}이어야 합니다")
        return expected

    return BeforeValidator(check)


class DesignModelV1(Strict):
    schema_version: Annotated[Literal[1], _exact_int(1)]
    units: Literal["mm"]
    site: Site
    rule_context: RuleContext
    masses: list[Mass]
    floor_layouts: list[FloorLayout]
    program: Program
    meta: Meta


# ---------------------------------------------------------------------------
# JudgmentResult (packages/domain/src/judgment.ts)
# ---------------------------------------------------------------------------

JudgmentKey = Literal[
    "coverage", "far", "height", "sunlight", "setback", "parking", "seismic", "zero_energy", "supervision"
]


class JudgmentBasis(Strict):
    law: str
    article: str
    effective_from: str
    ordinance: bool


class JudgmentItem(Strict):
    key: JudgmentKey
    verdict: Literal["PASS", "FAIL", "WARN", "NA"]
    value: float | None = None
    limit: float | None = None
    unit: Literal["pct", "mm", "m2", "count", "bool"]
    basis: list[JudgmentBasis]


class JudgmentResult(Strict):
    engine_version: str
    rule_pack_version: str
    application_date: str
    items: list[JudgmentItem]
    pending_changes: NonNegInt


# ---------------------------------------------------------------------------
# SheetSpec, DraftingProfile (packages/domain/src/sheet.ts)
# ---------------------------------------------------------------------------

StdLayer = Literal[
    "A-SITE-BNDY",
    "A-SITE-ROAD",
    "A-SITE-SETB",
    "A-ENVL",
    "A-MASS",
    "A-WALL",
    "A-DOOR",
    "A-GLAZ",
    "A-AREA",
    "A-AREA-IDEN",
    "A-PARK",
    "A-ANNO-DIMS",
    "A-ANNO-TEXT",
    "A-ANNO-NRTH",
    "A-TTLB",
    "A-REFR",
]
Paper = Literal["A3", "A2", "A1"]


def _no_bool(value: Any) -> Any:
    if isinstance(value, bool):
        raise ValueError("불리언은 허용하지 않습니다")
    return _int_like(value)


class SectionLine(Strict):
    a: Point
    b: Point


# 주석 편집층(AR-06-086). 상한은 packages/domain sheet.ts ANNOTATION_LIMITS 와 같은 값이다.
ANNO_COUNT_MAX = 500
ANNO_TEXT_MAX = 200
ANNO_ID_MAX = 200
ANNO_REF_MAX = 128
CLOUD_POINTS_MAX = 64
LEADER_POINTS_MAX = 16
ANNO_OFFSET_MM_MAX = 10_000

AnnoId = Annotated[str, Field(min_length=1, max_length=ANNO_ID_MAX), _max_len(ANNO_ID_MAX)]
AnnoText = Annotated[str, Field(max_length=ANNO_TEXT_MAX), _max_len(ANNO_TEXT_MAX)]
PaperMm = Annotated[float, Field(ge=-ANNO_OFFSET_MM_MAX, le=ANNO_OFFSET_MM_MAX)]


class Anchor(Strict):
    ref: Annotated[str, Field(min_length=1, max_length=ANNO_REF_MAX), _max_len(ANNO_REF_MAX)]
    part: Literal["vertex", "edge", "center"]
    index: NonNegInt | None = None
    at: Literal["start", "end", "mid"] | None = None


class OverrideAnnotation(Strict):
    id: AnnoId
    kind: Literal["override"]
    target: str
    dx_mm: PaperMm | None = None
    dy_mm: PaperMm | None = None
    text: AnnoText | None = None
    hidden: bool | None = None


class DimAnnotation(Strict):
    id: AnnoId
    kind: Literal["dim"]
    a: Anchor
    b: Anchor
    offset_mm: PaperMm
    text: AnnoText | None = None


class TextAnnotation(Strict):
    id: AnnoId
    kind: Literal["text"]
    anchor: Anchor | None = None
    dx_mm: PaperMm
    dy_mm: PaperMm
    text: AnnoText


class LeaderAnnotation(Strict):
    id: AnnoId
    kind: Literal["leader"]
    anchors: Annotated[list[Anchor], Field(min_length=1, max_length=LEADER_POINTS_MAX)]
    dx_mm: PaperMm
    dy_mm: PaperMm
    text: AnnoText


class CloudAnnotation(Strict):
    id: AnnoId
    kind: Literal["cloud"]
    anchors: Annotated[list[Anchor], Field(min_length=3, max_length=CLOUD_POINTS_MAX)]
    text: AnnoText | None = None


Annotation = Annotated[
    OverrideAnnotation | DimAnnotation | TextAnnotation | LeaderAnnotation | CloudAnnotation,
    Field(discriminator="kind"),
]


class SheetSpec(Strict):
    id: str
    kind: Literal["site_plan", "area_plan", "sunlight_section", "floor_plan", "elevation"]
    paper: Paper
    orientation: Literal["landscape", "portrait"]
    scale: Annotated[Literal["auto", 100, 200, 300, 500, 600], BeforeValidator(_no_bool)]
    floor_id: str | None = None
    section_line: SectionLine | None = None
    elevation_face: Literal["N", "S", "E", "W"] | None = None
    annotations: Annotated[list[Annotation], Field(max_length=ANNO_COUNT_MAX)] | None = None
    include_in_proposal: bool

    @model_validator(mode="after")
    def _unique_annotation_ids(self) -> SheetSpec:
        ids = [a.id for a in self.annotations or []]
        if len(set(ids)) != len(ids):
            raise ValueError("주석 id 중복")
        return self


class DraftingProfile(Strict):
    office_name: str
    architect_name: str | None = None
    contact: str | None = None
    logo_storage_path: str | None = None
    layer_map: dict[StdLayer, str]
    default_paper: Paper
    default_text_height_mm: Annotated[float, Field(gt=0)]
    font_family: str


# ---------------------------------------------------------------------------
# 2. AI 그래프 결과 (04_API.md 4.2·4.3·4.6절)
# ---------------------------------------------------------------------------


# 길이·개수 상한(LLM 출력 DoS·저장/렌더 폭주 방어). 04_API.md 4.2·4.6절에는 상한이 없다 → 보수적 제안값이며
# 04_API.md 4.3절의 값(evidence 120, name 40, memo 300, count 1..20)만 문서 근거다. 근거는 tasks/logs/AR-06-046.md.
# zod 정의가 생기면 같은 상한을 넣어야 한다(PENDING_ZOD).
ID_MAX = 128  # source id·질문 id·실 id·zone id
KEY_MAX = 64
SENTENCE_MAX = 1000  # 판정 설명 한 문장
LABEL_MAX = 40
SHORT_MAX = 200  # 법령명·조문 등
VERSION_MAX = 64
T_SENTENCE_MAX = Annotated[str, Field(max_length=SENTENCE_MAX), _max_len(SENTENCE_MAX)]
T_SHORT_MAX = Annotated[str, Field(max_length=SHORT_MAX), _max_len(SHORT_MAX)]
T_VERSION_MAX = Annotated[str, Field(max_length=VERSION_MAX), _max_len(VERSION_MAX)]
T_LABEL_MAX = Annotated[str, Field(max_length=LABEL_MAX), _max_len(LABEL_MAX)]
T_KEY_MAX = Annotated[str, Field(max_length=KEY_MAX), _max_len(KEY_MAX)]
T_32 = Annotated[str, Field(max_length=32), _max_len(32)]
IdStr = Annotated[str, Field(max_length=ID_MAX), _max_len(ID_MAX)]
SourceIds = Annotated[list[IdStr], Field(max_length=20)]


class ReviewEngineValue(Strict):
    """엔진 값을 그대로 복사한다. LLM이 만든 숫자를 넣지 않는다(그래프 resolve_refs가 채운다)."""

    value: float
    limit: float
    unit: Annotated[str, Field(max_length=16), _max_len(16)]


# AI 문장 표식: "해석(수치 아님)". 수치는 ReviewItem.engine_value·verdict로만 나간다(AR-06-051 [DECISION]).
SentenceNature = Literal["interpretation"]


class ReviewSentence(Strict):
    text: T_SENTENCE_MAX
    source_ids: Annotated[list[IdStr], Field(min_length=1, max_length=20)]  # 빈 문장 출처 = AR033
    nature: SentenceNature = "interpretation"


class ReviewNeedsCheck(Strict):
    text: T_SENTENCE_MAX
    source_ids: Annotated[list[IdStr], Field(min_length=1, max_length=20)]  # 확인 필요도 출처 필수
    nature: SentenceNature = "interpretation"


class ReviewSource(Strict):
    id: IdStr
    law: T_SHORT_MAX
    article: T_SHORT_MAX
    effective_from: T_32
    kind: Literal["law", "ordinance", "interpretation", "district_plan"]


class ReviewItem(Strict):
    key: T_KEY_MAX  # JudgmentResult.items[].key 또는 RAG 전용 항목('district_plan' 등)
    verdict: Literal["PASS", "FAIL", "WARN", "CHECK"]
    engine_value: ReviewEngineValue | None = None
    sentences: Annotated[list[ReviewSentence], Field(max_length=20)]


class ReviewResultV1(Strict):
    schema_version: Literal["review.v1"]
    rule_pack_version: T_VERSION_MAX
    items: Annotated[list[ReviewItem], Field(max_length=50)]
    needs_check: Annotated[list[ReviewNeedsCheck], Field(max_length=50)]
    sources: Annotated[list[ReviewSource], Field(max_length=100)]
    disclaimer_version: T_VERSION_MAX

    @model_validator(mode="after")
    def _sources_resolve(self) -> ReviewResultV1:
        ids = [s.id for s in self.sources]
        if len(set(ids)) != len(ids):
            raise ValueError("sources[].id가 중복됩니다")
        known = set(ids)
        cited = [sid for item in self.items for s in item.sentences for sid in s.source_ids]
        cited += [sid for n in self.needs_check for sid in n.source_ids]
        if any(sid not in known for sid in cited):
            raise ValueError("sources에 없는 source_id를 인용했습니다")
        return self


# --- arch.review 실행 계약(AR-06-051). 워커가 서버 재계산한 JudgmentResult를 본문으로 넘긴다(DB 없음). ---

_DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
_RUN_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


class ReviewRunInput(Strict):
    """POST /graphs/arch.review/runs 본문. org는 받지 않는다(토큰 org만 신뢰)."""

    run_id: Annotated[str, Field(pattern=_RUN_UUID_PATTERN)]
    attempt: Annotated[int, Field(ge=1, le=10)]
    application_date: Annotated[str, Field(pattern=_DATE_PATTERN)]
    timeout_s: Annotated[int, Field(ge=1, le=600)] = 600  # 전체 10분 중 남은 시간(시도당 상한)
    judgment: JudgmentResult


class ReviewRunResult(Strict):
    """GET 응답 result. refs는 남은 문장의 Ref 경로 `<key>.<value|limit>` → 그 Ref가 가리킨 엔진 값."""

    review: ReviewResultV1
    refs: dict[str, float]


class TextPart(Strict):
    """LLM 문장 조각(글). 숫자성 문자·한글 수사 검사는 compliance `validate_free_text`가 한다."""

    type: Literal["text"]
    text: T_SENTENCE_MAX

    @field_validator("text")
    @classmethod
    def _nfc(cls, value: str) -> str:
        return unicodedata.normalize("NFC", value)


class RefPart(Strict):
    """엔진 값 참조. item = 판정 항목 key(문장이 속한 항목과 같아야 한다), field = value | limit."""

    type: Literal["ref"]
    item: T_KEY_MAX
    field: Literal["value", "limit"]


SentencePart = Annotated[TextPart | RefPart, Field(discriminator="type")]
SentenceParts = Annotated[list[SentencePart], Field(min_length=1, max_length=20)]


class ReviewLlmSentence(Strict):
    parts: SentenceParts
    source_ids: list[str]


class ReviewLlmItem(Strict):
    key: str
    sentences: list[ReviewLlmSentence]
    needs_check: list[ReviewLlmSentence]


class ReviewLlmOutput(Strict):
    """interpret 노드의 LLM 구조화 출력. 문장은 parts[Text|Ref]이고 엔진 값은 Ref로만 가리킨다."""

    items: list[ReviewLlmItem]


class ReviewLlmRewrite(Strict):
    parts: SentenceParts


AREA_M2_MAX = 1_000_000  # 1km² : 소형 건축 면적 입력으로는 충분히 큰 보수적 상한(제안)
IntakeAnswer = (
    Annotated[str, Field(max_length=300), _max_len(300)] | float | bool | Annotated[list[IdStr], Field(max_length=20)]
)


class IntakeChecklistAnswer(Strict):
    question_id: Annotated[
        str, Field(min_length=1, max_length=ID_MAX), _max_len(ID_MAX)
    ]  # packages/program 체크리스트 문항 id(허용 목록은 normalize 노드)
    answer: IntakeAnswer
    confidence: Literal["high", "medium", "low"]
    evidence: Annotated[str, Field(max_length=120), _max_len(120)]  # 원문 인용(원문 포함 검사는 validate 노드)


class IntakeRoom(Strict):
    name: Annotated[str, Field(max_length=40), _max_len(40)]
    use: T_KEY_MAX  # 규칙 팩 용도 코드(허용 목록은 normalize 노드)
    count: Annotated[int, Field(ge=1, le=20), BeforeValidator(_int_like)]
    target_area_m2: (
        Annotated[float, Field(gt=0, le=AREA_M2_MAX)] | None
    )  # 사용자가 말한 값만. 말하지 않았으면 null(면적은 packages/program이 계산)
    area_evidence: Annotated[str, Field(max_length=120), _max_len(120)] | None  # evidence와 같은 120자

    @model_validator(mode="after")
    def _area_needs_evidence(self) -> IntakeRoom:
        if self.target_area_m2 is not None and not self.area_evidence:
            raise ValueError("target_area_m2에는 원문 인용(area_evidence)이 필요합니다(AR032)")
        return self


class IntakeMemo(Strict):
    kind: Literal["preference", "budget", "constraint", "other"]
    text: Annotated[str, Field(max_length=300), _max_len(300)]


class IntakeCandidateV1(Strict):
    schema_version: Literal["intake.v1"]
    checklist_answers: Annotated[list[IntakeChecklistAnswer], Field(max_length=100)]
    rooms: Annotated[list[IntakeRoom], Field(max_length=50)]
    memo: Annotated[list[IntakeMemo], Field(max_length=20)]


class LayoutZone(Strict):
    id: IdStr
    kind: Literal["public", "private", "service", "wet"]
    rooms: Annotated[list[IdStr], Field(max_length=50)]
    preferred_side: Literal["N", "S", "E", "W", "entrance"] | None = None


class LayoutAdjacency(Strict):
    a: IdStr
    b: IdStr
    relation: Literal["adjacent", "near", "apart", "door"]
    weight: Annotated[Literal[1, 2, 3], BeforeValidator(_no_bool)]


class LayoutVariant(Strict):
    label: T_LABEL_MAX
    zones: Annotated[list[LayoutZone], Field(max_length=20)]
    adjacency: Annotated[list[LayoutAdjacency], Field(max_length=200)]


class LayoutIntentV1(Strict):
    """실 인접 의도만. 좌표·치수·면적 키 금지. 실 다각형은 packages/layout 솔버가 만든다."""

    schema_version: Literal["layout_intent.v1"]
    variants: Annotated[list[LayoutVariant], Field(min_length=3, max_length=3)]


def check_layout_rooms(intent: LayoutIntentV1, room_ids: Iterable[str]) -> None:
    """그래프 validate 노드의 결정적 검사(02_ARCHITECTURE.md 5장): 안마다 실 id 집합 = 입력 실 id 집합.

    인접 a·b도 입력 실 id여야 하고, 한 안 안에서 zone id·실 배정은 중복되면 안 된다. 위반은 ValueError(AR032 계열).
    """
    expected = set(room_ids)
    for index, variant in enumerate(intent.variants):
        zone_ids = [z.id for z in variant.zones]
        if len(set(zone_ids)) != len(zone_ids):
            raise ValueError(f"variants[{index}]: zone id 중복")
        assigned = [r for z in variant.zones for r in z.rooms]
        if len(set(assigned)) != len(assigned):
            raise ValueError(f"variants[{index}]: 한 실이 여러 zone에 배정됨")
        if set(assigned) != expected:
            raise ValueError(f"variants[{index}]: 실 id 집합이 입력과 다름")
        for adj in variant.adjacency:
            if adj.a not in expected or adj.b not in expected or adj.a == adj.b:
                raise ValueError(f"variants[{index}]: 인접 관계의 실 id가 입력에 없음")


__all__ = [
    "DesignModelV1",
    "DraftingProfile",
    "IntakeCandidateV1",
    "JudgmentResult",
    "LayoutIntentV1",
    "ReviewResultV1",
    "SheetSpec",
    "check_layout_rooms",
]
