"""제품 확장 등록부. 공용 설치에 제품별 그래프·스키마를 붙인다."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ProductConfig:
    app: str
    # 그래프 이름 → 활성 여부(Phase 2는 False: 경로가 404).
    graphs: dict[str, bool] = field(default_factory=dict)


def registered_products() -> dict[str, ProductConfig]:
    from app.ai.products import arch

    return {arch.PRODUCT.app: arch.PRODUCT}
