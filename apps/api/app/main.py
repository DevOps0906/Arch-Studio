"""앱 팩토리. 실행: `uvicorn --factory app.main:create_app`.

설정·검증 키가 없거나 잘못되면 ConfigError로 기동을 거부한다(02_ARCHITECTURE.md 8장 "기동 실패").
"""

from __future__ import annotations

from fastapi import FastAPI

from app.ai.interfaces import GraphRunner, NotConfiguredRunner
from app.ai.products import registered_products
from app.ai.products.arch import APP as ARCH_APP
from app.ai.tools.arch.answer import ChatDeps
from app.auth.deps import AuthContext
from app.auth.keys import KeyStore
from app.auth.replay import JtiStore, MemoryJtiStore
from app.errors import install_error_handlers
from app.log import install_log_redaction
from app.middleware import BodySizeLimitMiddleware
from app.routes import graphs, health, tools
from app.runs import MemoryRunStore, RunStore
from app.settings import Settings, load_settings


def create_app(
    settings: Settings | None = None,
    *,
    keys: KeyStore | None = None,
    replay: JtiStore | None = None,
    runs: RunStore | None = None,
    runner: GraphRunner | None = None,
    chat: ChatDeps | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    # 이 설치의 검증 키는 제품 arch의 발급 키에 묶인다(제품별 키 분리, AI_ARCHITECTURE.md 2.1절).
    keys = keys or KeyStore.from_settings(settings, app=ARCH_APP)

    install_log_redaction()
    app = FastAPI(title="arch-studio-api", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.auth = AuthContext(keys=keys, replay=replay or MemoryJtiStore(), leeway_s=settings.token_leeway_s)
    app.state.products = registered_products()
    app.state.runs = runs or MemoryRunStore()
    app.state.runner = runner or NotConfiguredRunner()
    app.state.chat = chat  # None = 실제 LLM·코퍼스 미연결(503)

    install_error_handlers(app)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)
    app.include_router(health.router)
    app.include_router(graphs.router)
    app.include_router(tools.router)
    return app
