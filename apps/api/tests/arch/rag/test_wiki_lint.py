"""위키 lint: 페이지마다 출처·확인일(01_PRD.md 3절 AR-F-010), 낡은 근거·깨진 링크·고아(LLM_WIKI.md 1·2장)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime

from app.ai.products.arch.wiki_config import DEFAULT_CONFIG, LintIssue, WikiConfig, WikiPage, lint_page, lint_wiki

TODAY = date(2026, 11, 2)
UPDATED = datetime(2026, 11, 1, tzinfo=UTC)
DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
DOCS = {DOC: datetime(2026, 10, 1, tzinfo=UTC)}

GOOD_BODY = """# [예시] 다락 층수 산입
다락의 층수 산입 기준 요약(예시, 미확인).

## 본문
내용

## 출처
- [예시] 질의회신 다락의 층수 산입 (확인일: 2026-10-30)

## 관련
- [[concepts/floor-count]]
"""


def page(**over: object) -> WikiPage:
    base = WikiPage(
        slug="topics/attic",
        title="다락",
        page_type="topic",
        body_md=GOOD_BODY,
        source_document_ids=(DOC,),
        updated_at=UPDATED,
    )
    return replace(base, **over)  # type: ignore[arg-type]


def codes(issues: list[LintIssue]) -> set[str]:
    return {i.code for i in issues}


def run(p: WikiPage, config: WikiConfig = DEFAULT_CONFIG) -> set[str]:
    return codes(
        lint_page(
            p,
            today=TODAY,
            known_slugs={"topics/attic", "concepts/floor-count"},
            document_updated_at=DOCS,
            config=config,
        )
    )


def test_good_page_has_no_issues() -> None:
    assert run(page()) == set()


def test_missing_source_section() -> None:
    body = GOOD_BODY.replace("## 출처\n- [예시] 질의회신 다락의 층수 산입 (확인일: 2026-10-30)\n", "")
    assert "missing_source" in run(page(body_md=body))


def test_source_without_items() -> None:
    body = GOOD_BODY.replace("- [예시] 질의회신 다락의 층수 산입 (확인일: 2026-10-30)", "출처는 나중에")
    assert "missing_source" in run(page(body_md=body))


def test_each_source_needs_confirmed_date() -> None:
    body = GOOD_BODY.replace("(확인일: 2026-10-30)\n", "(확인일: 2026-10-30)\n- 건축법 해설집\n")
    assert run(page(body_md=body)) == {"missing_confirmed_date"}


def test_bad_future_and_outdated_dates() -> None:
    assert "bad_confirmed_date" in run(page(body_md=GOOD_BODY.replace("2026-10-30", "2026-13-40")))
    assert "future_confirmed_date" in run(page(body_md=GOOD_BODY.replace("2026-10-30", "2026-12-01")))
    assert run(page(body_md=GOOD_BODY.replace("2026-10-30", "2024-01-01"))) == {"confirm_outdated"}


def test_source_documents_required_and_stale() -> None:
    assert "missing_source_documents" in run(page(source_document_ids=()))
    assert "unknown_source_document" in run(page(source_document_ids=("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",)))
    assert run(page(updated_at=datetime(2026, 9, 1, tzinfo=UTC))) == {"stale_source"}


def test_broken_link_and_bad_slug() -> None:
    assert "broken_link" in run(page(body_md=GOOD_BODY.replace("concepts/floor-count", "concepts/nope")))
    assert "bad_slug" in run(page(slug="Topics/Attic"))


def test_summary_and_related_warnings() -> None:
    body = GOOD_BODY.replace("다락의 층수 산입 기준 요약(예시, 미확인).\n", "").replace(
        "## 관련\n- [[concepts/floor-count]]\n", ""
    )
    assert run(page(body_md=body)) == {"missing_summary", "missing_related"}


def test_attribution_required_after_d14() -> None:
    strict = WikiConfig(require_attribution=True)
    assert "missing_attribution" in run(page(), strict)
    body = GOOD_BODY.replace("(확인일: 2026-10-30)", "표기: 예시 표기 문구 (확인일: 2026-10-30)")
    assert run(page(body_md=body), strict) == set()


def test_lint_wiki_orphans_and_archived() -> None:
    concept = page(
        slug="concepts/floor-count",
        page_type="concept",
        body_md=GOOD_BODY.replace("[[concepts/floor-count]]", "[[topics/attic]]"),
    )
    archived = page(slug="topics/old", status="archived", body_md="")
    issues = lint_wiki([page(), concept, archived], today=TODAY, document_updated_at=DOCS)
    assert issues == []
    lonely = page(slug="topics/lonely")
    issues = lint_wiki([page(), concept, lonely], today=TODAY, document_updated_at=DOCS)
    assert [(i.slug, i.code) for i in issues] == [("topics/lonely", "orphan")]


def test_naive_datetime_reported_not_raised() -> None:
    assert "naive_datetime" in run(page(updated_at=datetime(2026, 11, 1)))
    naive_docs = {DOC: datetime(2026, 10, 1)}
    issues = lint_page(page(), today=TODAY, known_slugs={"concepts/floor-count"}, document_updated_at=naive_docs)
    assert codes(issues) == {"naive_datetime"}


def test_source_heading_inside_code_fence_ignored() -> None:
    body = GOOD_BODY.replace("## 출처\n", "## 출처 예시\n```md\n## 출처\n- 가짜 (확인일: 2026-10-30)\n```\n")
    assert "missing_source" in run(page(body_md=body))
    tilde = GOOD_BODY.replace("## 관련\n", "~~~\n## 관련\n~~~\n")
    assert "missing_related" in run(page(body_md=tilde))


def test_indented_sub_items_are_not_sources() -> None:
    body = GOOD_BODY.replace("(확인일: 2026-10-30)\n", "(확인일: 2026-10-30)\n  - 해당 조문 발췌 설명\n")
    assert run(page(body_md=body)) == set()


def test_each_source_on_one_line_needs_own_date() -> None:
    both = GOOD_BODY.replace("(확인일: 2026-10-30)", "(확인일: 2026-10-30); 건축법 해설집 (확인일: 2026-10-29)")
    assert run(page(body_md=both)) == set()
    one = GOOD_BODY.replace("(확인일: 2026-10-30)", "(확인일: 2026-10-30); 건축법 해설집")
    assert run(page(body_md=one)) == {"missing_confirmed_date"}


def test_config_defaults() -> None:
    assert DEFAULT_CONFIG.features == {"ingest": "wiki.ingest", "query": "wiki.query", "lint": "wiki.lint"}
    assert DEFAULT_CONFIG.max_pages_per_document == 5
    assert DEFAULT_CONFIG.require_attribution is False  # D-14 확인 전
