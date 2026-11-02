"""위키 설정과 lint(LLM_WIKI.md 43-47행). 상한 값은 모두 제안값이다(구현 시 결정 대기).

페이지마다 출처(sources)와 확인일(confirmed_on)이 필수다. 없으면 lint 가 거부한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from pydantic import BaseModel, ConfigDict, Field


@dataclass(frozen=True)
class WikiConfig:
    max_pages_per_document: int = 5  # 문서 1건당 갱신 페이지 상한(제안)
    min_ingest_interval_minutes: int = 10  # 같은 조직 ingest 배치 간격 N(제안, 미정)
    lint_interval_days: int = 7  # lint 주 1회(제안)
    daily_credit_cap: dict[str, int] | None = None  # feature -> 일일 상한(제안); None 이면 기본값
    stale_after_days: int = 365  # 확인일이 이보다 오래되면 경고(제안)

    def credit_cap(self, feature: str) -> int:
        caps = self.daily_credit_cap or {"wiki.ingest": 200, "wiki.lint": 100}
        return caps[feature]


class WikiPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(min_length=1)
    title: str = Field(min_length=1)
    body: str = ""
    sources: list[str] = Field(default_factory=list)
    confirmed_on: date | None = None


REJECTING = frozenset({"missing_source", "missing_confirmed_on", "future_confirmed_on"})


def lint_page(page: WikiPage, *, today: date, config: WikiConfig | None = None) -> list[str]:
    """위반 코드 목록. REJECTING 에 든 것은 거부, `stale` 은 경고."""
    cfg = config or WikiConfig()
    issues: list[str] = []
    if not [s for s in page.sources if s.strip()]:
        issues.append("missing_source")
    if page.confirmed_on is None:
        issues.append("missing_confirmed_on")
    elif page.confirmed_on > today:
        issues.append("future_confirmed_on")
    elif (today - page.confirmed_on).days > cfg.stale_after_days:
        issues.append("stale")
    return issues


def validate_page(page: WikiPage, *, today: date, config: WikiConfig | None = None) -> None:
    bad = REJECTING.intersection(lint_page(page, today=today, config=config))
    if bad:
        raise ValueError(f"위키 페이지 거부({page.slug}): {', '.join(sorted(bad))}")


def plan_ingest_pages(pages: list[WikiPage], config: WikiConfig | None = None) -> tuple[list[WikiPage], list[WikiPage]]:
    """문서 1건이 건드리는 페이지를 (이번 배치, 다음 배치로 미룸)으로 나눈다."""
    n = (config or WikiConfig()).max_pages_per_document
    return pages[:n], pages[n:]
