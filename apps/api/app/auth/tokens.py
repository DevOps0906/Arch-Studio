"""서명 토큰·잡 토큰 검증(AI_ARCHITECTURE.md 2.1절, 04_API.md 2.2절).

JWT EdDSA(Ed25519). 클레임: iss=<app>, aud=platform-ai:<app>, org, app, sub, scope, jti, iat, exp (+ feat, conv 선택).
잡 토큰은 sub=job:<job_id>. 검증 순서: 길이 → 헤더(alg 화이트리스트, 키 주입 헤더 거부, kid) → 서명 → 클레임.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import jwt
from jwt.exceptions import (
    ExpiredSignatureError,
    ImmatureSignatureError,
    InvalidAudienceError,
    InvalidIssuerError,
    InvalidSignatureError,
    InvalidTokenError,
    MissingRequiredClaimError,
)

from app.auth.keys import KeyStore

ALLOWED_ALGORITHMS = ("EdDSA",)
FORBIDDEN_HEADERS = frozenset({"jku", "x5u", "jwk", "x5c", "x5t", "x5t#S256", "crit"})
MAX_TOKEN_LENGTH = 4096
MAX_LIFETIME_S = 600  # 10분(AI_ARCHITECTURE.md 2.1절 "수명")
REQUIRED_CLAIMS = ("iss", "aud", "sub", "jti", "iat", "exp")
JOB_SUB_PREFIX = "job:"


class AuthError(Exception):
    """status 401(토큰 자체 문제) 또는 403(유효한 토큰이지만 권한 밖). code는 응답·로그에 쓰는 사유 코드."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def _unauthorized(code: str) -> AuthError:
    return AuthError(401, code)


@dataclass(frozen=True)
class TokenClaims:
    app: str
    org: str
    sub: str
    scope: str
    jti: str
    iat: int
    exp: int
    feat: str | None = None
    conv: str | None = None

    @property
    def job_id(self) -> str | None:
        """잡 토큰이면 job_id, 아니면 None."""
        if self.sub.startswith(JOB_SUB_PREFIX):
            return self.sub[len(JOB_SUB_PREFIX) :]
        return None


def _is_uuid(value: object) -> bool:
    if not isinstance(value, str) or len(value) != 36:
        return False
    try:
        return str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False


def _int_claim(payload: Mapping[str, Any], name: str) -> int:
    value = payload.get(name)
    if isinstance(value, bool) or not isinstance(value, int):
        raise _unauthorized("TOKEN_CLAIMS")
    return value


def _opt_str(payload: Mapping[str, Any], name: str) -> str | None:
    value = payload.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not (1 <= len(value) <= 128):
        raise _unauthorized("TOKEN_CLAIMS")
    return value


def verify_token(
    token: str,
    keys: KeyStore,
    *,
    leeway_s: int = 30,
    clock: Callable[[], float] = time.time,
) -> TokenClaims:
    if not token or len(token) > MAX_TOKEN_LENGTH:
        raise _unauthorized("TOKEN_MALFORMED")
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError:
        raise _unauthorized("TOKEN_MALFORMED") from None

    # 서명 검증 전에 alg를 고정 목록으로 거부한다(alg=none, HS256 혼동).
    if header.get("alg") not in ALLOWED_ALGORITHMS:
        raise _unauthorized("TOKEN_ALG")
    if FORBIDDEN_HEADERS.intersection(header):
        raise _unauthorized("TOKEN_HEADER")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise _unauthorized("TOKEN_KID")
    key = keys.get(kid)
    if key is None:
        raise _unauthorized("TOKEN_KID")

    app = key.app
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            key.public_key,
            algorithms=list(ALLOWED_ALGORITHMS),
            audience=f"platform-ai:{app}",
            issuer=app,
            leeway=leeway_s,
            options={"require": list(REQUIRED_CLAIMS), "verify_signature": True},
        )
    except ExpiredSignatureError:
        raise _unauthorized("TOKEN_EXPIRED") from None
    except ImmatureSignatureError:
        raise _unauthorized("TOKEN_NOT_YET_VALID") from None
    except (InvalidAudienceError, InvalidIssuerError):
        raise _unauthorized("TOKEN_AUDIENCE") from None
    except InvalidSignatureError:
        raise _unauthorized("TOKEN_SIGNATURE") from None
    except MissingRequiredClaimError:
        raise _unauthorized("TOKEN_CLAIMS") from None
    except InvalidTokenError:
        raise _unauthorized("TOKEN_INVALID") from None

    # aud는 자기 app 하나의 문자열만(배열에 여러 제품을 넣는 토큰 거부).
    if payload.get("aud") != f"platform-ai:{app}" or payload.get("app") != app:
        raise _unauthorized("TOKEN_AUDIENCE")

    iat = _int_claim(payload, "iat")
    exp = _int_claim(payload, "exp")
    now = clock()
    if iat > now + leeway_s:
        raise _unauthorized("TOKEN_NOT_YET_VALID")
    if exp - iat > MAX_LIFETIME_S:
        raise _unauthorized("TOKEN_LIFETIME")

    org = payload.get("org")
    if not _is_uuid(org):
        raise _unauthorized("TOKEN_CLAIMS")
    sub = payload.get("sub")
    if not isinstance(sub, str) or not (1 <= len(sub) <= 200):
        raise _unauthorized("TOKEN_CLAIMS")
    if sub.startswith(JOB_SUB_PREFIX) and not _is_uuid(sub[len(JOB_SUB_PREFIX) :]):
        raise _unauthorized("TOKEN_CLAIMS")
    # scope는 문자열 하나. 공백 구분 다중 scope·배열은 형식 오류(scope 우회 차단).
    scope = payload.get("scope")
    if not isinstance(scope, str) or not scope or len(scope) > 128 or any(ch.isspace() for ch in scope):
        raise _unauthorized("TOKEN_SCOPE")
    jti = payload.get("jti")
    if not isinstance(jti, str) or not (8 <= len(jti) <= 128):
        raise _unauthorized("TOKEN_CLAIMS")

    return TokenClaims(
        app=app,
        org=str(org).lower(),
        sub=sub,
        scope=scope,
        jti=jti,
        iat=iat,
        exp=exp,
        feat=_opt_str(payload, "feat"),
        conv=_opt_str(payload, "conv"),
    )
