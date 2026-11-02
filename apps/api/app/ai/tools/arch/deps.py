"""`/tools/answer*` 의존성. 테스트·배선은 `app.state.arch_chat`에 `ChatTools`를 둔다.

설정되지 않은 부분은 실패 닫힘(503)이다. 운영 배선(DB 대화 매핑·DB 색인·라우터 LLM)은
이 작업 밖이다(tasks/logs/AR-06-054.md).
내부 키 `DIFY_INTERNAL_API_KEY`는 `Settings`(없으면 기동 거부)에서 `create_app`이 넣는다. 값은 로그·응답에 넣지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Protocol

from fastapi import Request

from app.ai.products.arch.knowledge import ScoredChunk
from app.ai.tools.arch.answer import AnswerGenerator, GeneratedAnswer, Retriever, SourceSnippet


class NotConfigured(RuntimeError):
    """배선되지 않은 의존성. 라우트가 503 AI_UNAVAILABLE로 바꾼다."""


class ConversationMap(Protocol):
    """`core.ai_conversations`에서 (플랫폼 대화 id, dify_user)가 일치하는 active 행의 org. 없으면 None."""

    def org_for(self, platform_conversation_id: str, dify_user: str) -> str | None: ...


class _NoRetriever:
    def search(
        self, query: str, *, application_date: date, k: int = 5, jurisdiction: str | None = None
    ) -> list[ScoredChunk]:
        raise NotConfigured("retriever")


class _NoGenerator:
    def generate(self, *, feature: str, org: str, query: str, sources: Sequence[SourceSnippet]) -> GeneratedAnswer:
        raise NotConfigured("generator")


class _NoConversations:
    def org_for(self, platform_conversation_id: str, dify_user: str) -> str | None:
        raise NotConfigured("conversations")


_KST = timezone(timedelta(hours=9))


def _today_kst() -> date:
    """검색 기준일 = 오늘(한국 시간). 채팅은 허가 신청 기준일이 없어 현행 법령으로 답한다."""
    return datetime.now(_KST).date()


@dataclass(frozen=True)
class ChatTools:
    retriever: Retriever = field(default_factory=_NoRetriever)
    generator: AnswerGenerator = field(default_factory=_NoGenerator)
    conversations: ConversationMap = field(default_factory=_NoConversations)
    # None이면 `/tools/answer` 503(create_app 밖에서 만든 앱 방어).
    internal_key: str | None = None
    today: Callable[[], date] = _today_kst


def chat_tools(request: Request) -> ChatTools:
    tools = getattr(request.app.state, "arch_chat", None)
    if isinstance(tools, ChatTools):
        return tools
    tools = ChatTools()
    request.app.state.arch_chat = tools
    return tools
