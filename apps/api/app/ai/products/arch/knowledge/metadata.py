"""지식 원본·청크 메타데이터와 시행 범위 판정(결정적 순수 함수).

시행 범위는 반열린 구간 `[effective_from, effective_to)`다. `effective_to`는 다음 판의 시행일(이날부터 이 판은
적용되지 않음)이고, 없으면 현행이다. 같은 원본(`source_id`)의 판끼리 구간이 겹치면 ingest가 거부한다
(`app.ai.products.arch.ingest.pipeline.check_versions`).

DB 저장 위치: `ai_chunks.metadata`(jsonb)에 `SourceMeta.model_dump(mode="json")` + `chunk_index`를 넣는다
(core_lite 스키마 그대로, 추가 컬럼 제안은 tasks/logs/AR-06-050.md).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import date
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.ai.products.arch.schema import Strict

FEATURE = "arch.knowledge"
COLLECTION_NAME = "arch.knowledge"

# law: 법·시행령·시행규칙·조례, district_plan: 지구단위계획 결정·지침, qa_reply: 질의회신·해석례.
KnowledgeKind = Literal["law", "district_plan", "qa_reply"]

SOURCE_ID_RE = r"^[a-z0-9]+(-[a-z0-9]+)*$"
# 시군구 코드(법정동 코드 앞 5자리). 전국 공통이면 생략.
JURISDICTION_RE = r"^[0-9]{5}$"


Text300 = Annotated[str, Field(min_length=1, max_length=300)]


class SourceMeta(Strict):
    kind: KnowledgeKind
    source_id: Annotated[str, Field(pattern=SOURCE_ID_RE, max_length=120)]
    title: Text300
    effective_from: date
    effective_to: date | None = None
    jurisdiction: Annotated[str, Field(pattern=JURISDICTION_RE)] | None = None
    source_url: Annotated[str, Field(pattern=r"^https://", max_length=2000)] | None = None
    # 사람이 원문을 확인한 날(위키 "확인일"과 같은 뜻). 없으면 색인하지 않는다.
    retrieved_on: date
    # 출처 표기 문구. 공공데이터 이용 조건(D-14) 확인 전에는 비워 두고, 확인 후 필수로 바꾼다.
    attribution: Text300 | None = None
    # 예시(미확인) 자료. 운영 ingest는 거부한다(테스트·하니스 전용).
    is_example: bool = False

    @model_validator(mode="after")
    def _range(self) -> SourceMeta:
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            raise ValueError("effective_to는 effective_from보다 뒤여야 합니다")
        if self.retrieved_on < date(2000, 1, 1):
            raise ValueError("retrieved_on이 비정상입니다")
        return self

    @property
    def version_key(self) -> str:
        return f"{self.source_id}@{self.effective_from.isoformat()}"


class KnowledgeChunk(Strict):
    meta: SourceMeta
    chunk_index: Annotated[int, Field(ge=0)]
    content: Annotated[str, Field(min_length=1)]
    content_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]

    @property
    def chunk_id(self) -> str:
        """판 단위 안정 id. `cite_check`가 문장 출처로 쓴다."""
        return f"{self.meta.version_key}#{self.chunk_index}"


def in_force(meta: SourceMeta, application_date: date, jurisdiction: str | None = None) -> bool:
    """`application_date`에 시행 중이고, 관할이 맞으면(전국 공통 자료는 항상) True."""
    if application_date < meta.effective_from:
        return False
    if meta.effective_to is not None and application_date >= meta.effective_to:
        return False
    if meta.jurisdiction is not None and meta.jurisdiction != jurisdiction:
        return False
    return True


def filter_in_force(
    chunks: Iterable[KnowledgeChunk], application_date: date, jurisdiction: str | None = None
) -> list[KnowledgeChunk]:
    if jurisdiction is not None and not re.fullmatch(JURISDICTION_RE, jurisdiction):
        raise ValueError("jurisdiction은 시군구 코드 5자리입니다")
    return [c for c in chunks if in_force(c.meta, application_date, jurisdiction)]
