"""검증 공개키(JWKS) 저장소. 키는 환경에서만 주입한다(AI_ARCHITECTURE.md 2.1절, 공격 A1·A14).

- 공개키만 받는다. JWK에 개인키 성분(`d`)이 있으면 기동을 거부한다(유출 신호).
- `kty=OKP`, `crv=Ed25519`, `kid` 필수. `alg`가 있으면 `EdDSA`, `use`가 있으면 `sig`만.
- 키는 발급 제품(app)에 묶인다. 이 설치의 env 키는 제품 `arch`의 발급 키다.
- URL 모드에서 모르는 `kid`가 오면 최소 간격(60초)으로만 다시 조회한다(키 교체 대응, 조회 폭주 방지).
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from jwt import PyJWK
from jwt.exceptions import InvalidKeyError, PyJWKError

from app.log import logger
from app.settings import ConfigError, Settings

MAX_KEYS = 16
REFRESH_MIN_INTERVAL_S = 60.0
FETCH_TIMEOUT_S = 5.0
MAX_JWKS_BYTES = 64 * 1024


@dataclass(frozen=True)
class BoundKey:
    kid: str
    app: str
    public_key: Ed25519PublicKey


def parse_jwks(raw: str | bytes, app: str) -> dict[str, BoundKey]:
    """JWKS 문서를 검사해 kid → 키로 만든다. 규칙 위반은 ConfigError(값은 메시지에 넣지 않는다)."""
    if len(raw) > MAX_JWKS_BYTES:
        raise ConfigError("JWKS가 너무 큽니다")
    try:
        doc = json.loads(raw)
    except ValueError:
        raise ConfigError("JWKS JSON이 아닙니다") from None
    keys = doc.get("keys") if isinstance(doc, dict) else None
    if not isinstance(keys, list) or not keys:
        raise ConfigError("JWKS에 keys가 없습니다")
    if len(keys) > MAX_KEYS:
        raise ConfigError("JWKS 키가 너무 많습니다")
    out: dict[str, BoundKey] = {}
    for jwk in keys:
        if not isinstance(jwk, dict):
            raise ConfigError("JWK 형식이 아닙니다")
        if "d" in jwk:
            raise ConfigError("JWKS에 개인키 성분이 있습니다(공개키만 허용)")
        if jwk.get("kty") != "OKP" or jwk.get("crv") != "Ed25519":
            raise ConfigError("Ed25519(OKP) 키만 허용합니다")
        if jwk.get("alg", "EdDSA") != "EdDSA" or jwk.get("use", "sig") != "sig":
            raise ConfigError("alg=EdDSA, use=sig 키만 허용합니다")
        kid = jwk.get("kid")
        if not isinstance(kid, str) or not (1 <= len(kid) <= 128):
            raise ConfigError("JWK kid가 필요합니다")
        if kid in out:
            raise ConfigError("JWK kid가 중복됩니다")
        try:
            key = PyJWK(_public_fields(jwk), algorithm="EdDSA").key
        except (PyJWKError, InvalidKeyError, ValueError):
            raise ConfigError("JWK를 읽을 수 없습니다") from None
        if not isinstance(key, Ed25519PublicKey):
            raise ConfigError("Ed25519 공개키가 아닙니다")
        out[kid] = BoundKey(kid=kid, app=app, public_key=key)
    return out


def _public_fields(jwk: dict[str, Any]) -> dict[str, Any]:
    return {k: jwk[k] for k in ("kty", "crv", "x", "kid") if k in jwk}


def http_fetcher(url: str, *, client: httpx.Client | None = None) -> Callable[[], bytes]:
    def fetch() -> bytes:
        c = client or httpx.Client(timeout=FETCH_TIMEOUT_S, follow_redirects=False)
        try:
            res = c.get(url, headers={"accept": "application/json"})
            if res.status_code != 200:
                raise ConfigError(f"JWKS 조회 실패: HTTP {res.status_code}")
            return res.content
        except httpx.HTTPError:
            raise ConfigError("JWKS 조회 실패: 네트워크") from None
        finally:
            if client is None:
                c.close()

    return fetch


class KeyStore:
    def __init__(
        self,
        keys: dict[str, BoundKey],
        *,
        app: str,
        fetcher: Callable[[], bytes] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._keys = keys
        self._app = app
        self._fetcher = fetcher
        self._clock = clock
        self._last_fetch = clock()
        self._lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings: Settings, *, app: str, fetcher: Callable[[], bytes] | None = None) -> KeyStore:
        """기동 시 키를 읽는다. 실패하면 ConfigError → 기동 거부."""
        if settings.ai_token_jwks:
            return cls(parse_jwks(settings.ai_token_jwks, app), app=app)
        if not settings.ai_token_jwks_url:  # Settings 검증이 보장하지만 -O 실행에서도 닫힌 상태로 둔다
            raise ConfigError("검증 키 설정이 없습니다")
        fetch = fetcher or http_fetcher(settings.ai_token_jwks_url)
        return cls(parse_jwks(fetch(), app), app=app, fetcher=fetch)

    def get(self, kid: str) -> BoundKey | None:
        key = self._keys.get(kid)
        if key is not None or self._fetcher is None:
            return key
        with self._lock:
            if kid not in self._keys and self._clock() - self._last_fetch >= REFRESH_MIN_INTERVAL_S:
                self._last_fetch = self._clock()
                try:
                    self._keys = parse_jwks(self._fetcher(), self._app)
                except ConfigError as exc:
                    # 갱신 실패는 기존 키 유지(fail-closed: 모르는 kid는 계속 거부).
                    logger.warning("jwks refresh failed: %s", exc)
            return self._keys.get(kid)
