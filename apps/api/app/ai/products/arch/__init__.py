"""Arch Studio 제품 확장(02_ARCHITECTURE.md 2장 ai-service 행). 그래프 3종은 후속 작업에서 구현한다."""

from __future__ import annotations

from app.ai.products import ProductConfig

APP = "arch"

# 04_API.md 6.3절. arch.layout은 Phase 2라 비활성(경로 404).
PRODUCT = ProductConfig(
    app=APP,
    graphs={
        "arch.review": True,
        "arch.intake": True,
        "arch.layout": False,
    },
)
