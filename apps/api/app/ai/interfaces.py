"""LLM 제공자·그래프 실행기 인터페이스(자리만). 구현은 그래프 작업(arch_review·arch_intake·arch_layout)에서 한다.

원칙(02_ARCHITECTURE.md 5장): LLM은 좌표·치수·면적·판정 값·금액을 만들지 않는다. 구조화 출력은 반드시
`app.ai.products.arch.schema`의 strict 모델로 검증하고, 모델·제공자는 설정값(feature 라우팅)으로 고른다(하드코딩 금지).
"""

from __future__ import annotations

from typing import Protocol, TypeVar

from pydantic import BaseModel

from app.runs import GraphRun

T = TypeVar("T", bound=BaseModel)


class StructuredLLM(Protocol):
    """feature 키로 라우팅된 제공자에서 구조화 출력을 받는다. 반환 전에 output_model로 strict 검증한다."""

    def generate(
        self, *, feature: str, org: str, prompt: str, output_model: type[T], timeout_s: float | None = None
    ) -> T: ...


class GraphRunner(Protocol):
    def start(self, run: GraphRun) -> None: ...


class NotConfiguredRunner:
    """그래프 미구현 상태. 실행 기록만 남기고 아무 외부 호출도 하지 않는다."""

    def start(self, run: GraphRun) -> None:
        return None
