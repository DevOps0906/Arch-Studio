"""법규 해설 위키(AR-F-010) 설정과 결정적 lint 규칙.

근거: 01_PRD.md 3절 AR-F-010("위키 페이지마다 출처와 확인일"), 공용코어/LLM_WIKI.md 2·3장.
ingest·query·lint의 LLM 호출은 라우팅 feature(`wiki.*`)가 모델을 정하고, 여기 lint는 LLM 없이 도는 규칙 점검이다
(LLM lint의 모순 탐지는 이 결과를 입력으로 받아 후속 작업에서 붙인다).

페이지 본문 규칙: `## 출처` 절의 목록 항목마다 `확인일: YYYY-MM-DD`를 적는다.
예) `- 건축법 시행령 제NN조, 국가법령정보센터 (확인일: 2026-10-30)`
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal

PageType = Literal["index", "topic", "entity", "concept", "source", "log"]
Severity = Literal["error", "warn"]

# DB CHECK(wiki_pages_slug_check)와 같은 식.
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$")
LINK_RE = re.compile(r"\[\[([^\]\n]+)\]\]")
CONFIRMED_RE = re.compile(r"확인일:\s*(\d{4}-\d{2}-\d{2})")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_ITEM_RE = re.compile(r"^\s*[-*]\s+\S")


@dataclass(frozen=True)
class WikiConfig:
    app: str = "arch"
    features: Mapping[str, str] = field(
        default_factory=lambda: {"ingest": "wiki.ingest", "query": "wiki.query", "lint": "wiki.lint"}
    )
    collection_kind: str = "wiki"
    # 문서 1건당 갱신 페이지 상한(LLM_WIKI.md 3장 제안).
    max_pages_per_document: int = 5
    # 주 1회 lint 잡(제안).
    lint_interval_days: int = 7
    # 확인일이 이보다 오래되면 재확인 경고(제안).
    reconfirm_after_days: int = 365
    source_section: str = "출처"
    related_section: str = "관련"
    # 공공데이터 출처 표기 의무(D-14) 확인 전에는 False. 확인 후 True로 바꾸면 출처 항목에 표기 문구가 필수.
    require_attribution: bool = False


DEFAULT_CONFIG = WikiConfig()


@dataclass(frozen=True)
class WikiPage:
    slug: str
    title: str
    page_type: PageType
    body_md: str
    source_document_ids: tuple[str, ...]
    updated_at: datetime
    status: Literal["draft", "published", "archived"] = "published"


@dataclass(frozen=True)
class LintIssue:
    slug: str
    code: str
    severity: Severity
    message: str


def _sections(body: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    current: str | None = None
    for line in body.splitlines():
        m = _HEADING_RE.match(line)
        if m and len(m.group(1)) == 2:
            current = m.group(2)
            out.setdefault(current, [])
        elif current is not None:
            out[current].append(line)
    return out


def _summary(body: str) -> str:
    """빈 줄·주석·`# 제목` 다음 첫 줄. 바로 `##` 절이 나오면 요약 없음."""
    for line in body.splitlines():
        s = line.strip()
        if not s or s.startswith("<!--") or (s.startswith("# ")):
            continue
        return "" if s.startswith("#") else s
    return ""


def lint_page(
    page: WikiPage,
    *,
    today: date,
    known_slugs: set[str],
    document_updated_at: Mapping[str, datetime],
    config: WikiConfig = DEFAULT_CONFIG,
) -> list[LintIssue]:
    issues: list[LintIssue] = []

    def add(code: str, severity: Severity, message: str) -> None:
        issues.append(LintIssue(page.slug, code, severity, message))

    if not SLUG_RE.match(page.slug):
        add("bad_slug", "error", "slug는 소문자·숫자·하이픈과 `/`만 씁니다")
    if not _summary(page.body_md):
        add("missing_summary", "warn", "첫 줄 요약이 없습니다")

    sections = _sections(page.body_md)
    items = [ln.strip() for ln in sections.get(config.source_section, []) if _ITEM_RE.match(ln)]
    if not items:
        add("missing_source", "error", f"'## {config.source_section}' 절에 출처 항목이 없습니다")
    for item in items:
        m = CONFIRMED_RE.search(item)
        if m is None:
            add("missing_confirmed_date", "error", f"출처에 확인일이 없습니다: {item}")
            continue
        try:
            confirmed = date.fromisoformat(m.group(1))
        except ValueError:
            add("bad_confirmed_date", "error", f"확인일 형식이 잘못됐습니다: {m.group(1)}")
            continue
        if confirmed > today:
            add("future_confirmed_date", "error", f"확인일이 미래입니다: {confirmed.isoformat()}")
        elif today - confirmed > timedelta(days=config.reconfirm_after_days):
            add("confirm_outdated", "warn", f"확인일이 {config.reconfirm_after_days}일보다 오래됐습니다: {item}")
        if config.require_attribution and "표기:" not in item:
            add("missing_attribution", "error", f"출처 표기 문구가 없습니다: {item}")

    if not page.source_document_ids:
        add("missing_source_documents", "error", "source_document_ids가 비었습니다")
    for doc_id in page.source_document_ids:
        updated = document_updated_at.get(doc_id)
        if updated is None:
            add("unknown_source_document", "error", f"근거 문서를 찾을 수 없습니다: {doc_id}")
        elif updated > page.updated_at:
            add("stale_source", "warn", f"근거 문서가 페이지보다 새롭습니다: {doc_id}")

    if config.related_section not in sections:
        add("missing_related", "warn", f"'## {config.related_section}' 절이 없습니다")
    for target in sorted(set(LINK_RE.findall(page.body_md))):
        if target not in known_slugs:
            add("broken_link", "error", f"없는 페이지 링크: [[{target}]]")
    return issues


def lint_wiki(
    pages: Sequence[WikiPage],
    *,
    today: date,
    document_updated_at: Mapping[str, datetime],
    config: WikiConfig = DEFAULT_CONFIG,
) -> list[LintIssue]:
    """보관(archived) 페이지는 점검하지 않는다. 고아 페이지(index 제외, 들어오는 링크 없음)는 경고."""
    live = [p for p in pages if p.status != "archived"]
    known = {p.slug for p in live}
    issues: list[LintIssue] = []
    inbound: set[str] = set()
    for p in sorted(live, key=lambda p: p.slug):
        issues.extend(
            lint_page(p, today=today, known_slugs=known, document_updated_at=document_updated_at, config=config)
        )
        inbound.update(t for t in LINK_RE.findall(p.body_md) if t != p.slug)
    for p in sorted(live, key=lambda p: p.slug):
        if p.page_type != "index" and p.slug not in inbound:
            issues.append(LintIssue(p.slug, "orphan", "warn", "들어오는 링크가 없습니다"))
    return issues
