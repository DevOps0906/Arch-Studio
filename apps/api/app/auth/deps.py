"""FastAPI 인증 의존성. 조직은 토큰 `org`에서만 얻는다(본문·쿼리 org_id 무시, 공격 A11)."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from app.auth.keys import KeyStore
from app.auth.replay import JtiStore
from app.auth.tokens import AuthError, TokenClaims, verify_token
from app.errors import ApiError
from app.log import logger

_MESSAGES = {401: "인증이 필요합니다", 403: "권한이 없습니다"}


@dataclass(frozen=True)
class AuthContext:
    keys: KeyStore
    replay: JtiStore
    leeway_s: int


def _to_api_error(err: AuthError) -> ApiError:
    # 사유 코드만 기록한다(토큰·클레임 값은 기록하지 않는다).
    logger.info("auth rejected: %s", err.code)
    headers = {"WWW-Authenticate": 'Bearer error="invalid_token"'} if err.status == 401 else None
    return ApiError(
        err.status, err.code if err.status == 403 else "UNAUTHORIZED", _MESSAGES[err.status], headers=headers
    )


def _bearer(request: Request) -> str:
    raw = request.headers.get("authorization")
    if raw is None:
        raise _to_api_error(AuthError(401, "TOKEN_MISSING"))
    scheme, _, token = raw.partition(" ")
    if scheme.lower() != "bearer" or not token or " " in token:
        raise _to_api_error(AuthError(401, "TOKEN_MALFORMED"))
    return token


def token_claims(request: Request) -> TokenClaims:
    """서명 토큰 또는 잡 토큰을 검증한다. 실패는 401."""
    ctx: AuthContext = request.app.state.auth
    try:
        return verify_token(_bearer(request), ctx.keys, leeway_s=ctx.leeway_s)
    except AuthError as err:
        raise _to_api_error(err) from None


def require_job_scope(claims: TokenClaims, scope: str) -> str:
    """잡 토큰(sub=job:<uuid>)이고 scope가 정확히 같아야 한다. 아니면 403. job_id를 돌려준다."""
    job_id = claims.job_id
    if job_id is None:
        raise _to_api_error(AuthError(403, "JOB_TOKEN_REQUIRED"))
    if claims.scope != scope:
        raise _to_api_error(AuthError(403, "SCOPE_MISMATCH"))
    return job_id


def consume_jti(request: Request, claims: TokenClaims) -> None:
    """비용·쓰기 경로의 jti 1회 사용. 재사용이면 401."""
    ctx: AuthContext = request.app.state.auth
    if not ctx.replay.consume(claims.app, claims.jti, claims.exp):
        raise _to_api_error(AuthError(401, "TOKEN_REPLAYED"))
