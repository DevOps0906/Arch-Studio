"""기동 설정(02_ARCHITECTURE.md 8장). 검증 실패 = 기동 거부.

검증 키는 환경에서만 주입한다. 기본값·하드코딩 키는 없다. `.env` 파일은 읽지 않는다(배포 환경 변수만).
"""

from __future__ import annotations

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ConfigError(RuntimeError):
    """기동을 거부해야 하는 설정 오류. 메시지에 값(키·URL 쿼리)을 넣지 않는다."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=True, frozen=True)

    # 둘 중 정확히 하나. URL은 https만(AI_ARCHITECTURE.md 2.1절 "공개키(JWKS)로 검증만").
    ai_token_jwks_url: str | None = Field(default=None, validation_alias="AI_TOKEN_JWKS_URL")
    ai_token_jwks: str | None = Field(default=None, validation_alias="AI_TOKEN_JWKS")

    # 비밀이 아닌 운영 상한(기본값 허용).
    max_body_bytes: int = Field(default=64 * 1024, ge=1024, le=1024 * 1024, validation_alias="AI_API_MAX_BODY_BYTES")
    token_leeway_s: int = Field(default=30, ge=0, le=120, validation_alias="AI_TOKEN_LEEWAY_S")
    # URL 모드 JWKS 주기 갱신(초). 유출 키를 JWKS에서 뺐을 때 반영되는 최대 지연.
    jwks_refresh_s: int = Field(default=600, ge=60, le=86400, validation_alias="AI_TOKEN_JWKS_REFRESH_S")

    @model_validator(mode="after")
    def _exactly_one_key_source(self) -> Settings:
        url = (self.ai_token_jwks_url or "").strip()
        inline = (self.ai_token_jwks or "").strip()
        if bool(url) == bool(inline):
            raise ValueError("AI_TOKEN_JWKS_URL 또는 AI_TOKEN_JWKS 중 정확히 하나가 필요합니다")
        if url and not url.startswith("https://"):
            raise ValueError("AI_TOKEN_JWKS_URL은 https만 허용합니다")
        return self


def load_settings() -> Settings:
    """환경 변수에서 설정을 읽는다. 실패하면 ConfigError(값은 메시지에 넣지 않는다)."""
    try:
        return Settings()
    except ValueError as exc:  # pydantic ValidationError 포함
        reasons = "; ".join(str(e.get("msg", "invalid")) for e in getattr(exc, "errors", lambda: [])())
        raise ConfigError(f"설정 검증 실패: {reasons or 'invalid'}") from None
