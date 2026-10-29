"""검증 공개키(JWKS) 저장소. 키는 환경에서만 주입한다(AI_ARCHITECTURE.md 2.1절, 공격 A1·A14).

- 공개키만 받는다. JWK에 개인키 성분(`d`)이 있으면 기동을 거부한다(유출 신호).
- `kty=OKP`, `crv=Ed25519`, `kid` 필수. `alg`가 있으면 `EdDSA`, `use`가 있으면 `sig`만.
- 키는 발급 제품(app)에 묶인다. 이 설치의 env 키는 제품 `arch`의 발급 키다.
- URL 모드는 주기 TTL(기본 600초, `AI_TOKEN_JWKS_REFRESH_S`)마다 다시 조회한다. 유출된 키를 JWKS에서 빼면
  TTL 안에 반영된다(모르는 kid가 오지 않아도 갱신). 모르는 `kid`가 오면 최소 간격(60초)으로 즉시 재조회한다.
- 갱신 실패(네트워크·형식 오류·빈 JWKS)는 기존 키를 유지한다(fail-closed: 알던 키만 계속 유효). 시도 간격은 최소 60초.
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
DEFAULT_REFRESH_TTL_S = 600.0
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
            # 스트리밍으로 받아 상한을 넘으면 즉시 끊는다(응답 전체를 메모리에 올리지 않는다).
            with c.stream("GET", url, headers={"accept": "application/json"}) as res:
                if res.status_code != 200:
                    raise ConfigError(f"JWKS 조회 실패: HTTP {res.status_code}")
                declared = res.headers.get("content-length", "")
                if declared.isdigit() and int(declared) > MAX_JWKS_BYTES:
                    raise ConfigError("JWKS가 너무 큽니다")
                buf = bytearray()
                for chunk in res.iter_bytes():
                    buf += chunk
                    if len(buf) > MAX_JWKS_BYTES:
                        raise ConfigError("JWKS가 너무 큽니다")
                return bytes(buf)
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
        refresh_ttl_s: float = DEFAULT_REFRESH_TTL_S,
    ) -> None:
        self._keys = keys
        self._app = app
        self._fetcher = fetcher
        self._clock = clock
        self._refresh_ttl_s = refresh_ttl_s
        self._last_ok = clock()
        self._last_attempt = self._last_ok
        self._lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings: Settings, *, app: str, fetcher: Callable[[], bytes] | None = None) -> KeyStore:
        """기동 시 키를 읽는다. 실패하면 ConfigError → 기동 거부."""
        if settings.ai_token_jwks:
            return cls(parse_jwks(settings.ai_token_jwks, app), app=app)  # 인라인 JWKS는 갱신 대상 아님(재배포로 교체)
        if not settings.ai_token_jwks_url:  # Settings 검증이 보장하지만 -O 실행에서도 닫힌 상태로 둔다
            raise ConfigError("검증 키 설정이 없습니다")
        fetch = fetcher or http_fetcher(settings.ai_token_jwks_url)
        return cls(parse_jwks(fetch(), app), app=app, fetcher=fetch, refresh_ttl_s=settings.jwks_refresh_s)

    def get(self, kid: str) -> BoundKey | None:
        if self._fetcher is None:
            return self._keys.get(kid)
        with self._lock:
            now = self._clock()
            periodic = now - self._last_ok >= self._refresh_ttl_s
            unknown = kid not in self._keys
            if (periodic or unknown) and now - self._last_attempt >= REFRESH_MIN_INTERVAL_S:
                self._last_attempt = now
                try:
                    self._keys = parse_jwks(self._fetcher(), self._app)
                    self._last_ok = now
                except ConfigError as exc:
                    # 갱신 실패는 기존 키 유지(fail-closed: 알던 키만 유효, 모르는 kid는 계속 거부).
                    logger.warning("jwks refresh failed: %s", exc)
            return self._keys.get(kid)
