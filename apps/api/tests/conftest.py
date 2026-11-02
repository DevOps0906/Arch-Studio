"""테스트 공용: 테스트 전용 Ed25519 키 쌍(실행마다 새로 생성, 저장소에 키 없음), 토큰 발급기, 앱 클라이언트."""

from __future__ import annotations

import base64
import json
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

ORG_A = "11111111-1111-4111-8111-111111111111"
ORG_B = "22222222-2222-4222-8222-222222222222"
KID = "test-kid-1"
RUN_A = "33333333-3333-4333-8333-333333333333"  # 기본 run 클레임(test_graphs.RUN_ID와 같은 값)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def public_jwk(private: Ed25519PrivateKey, kid: str) -> dict[str, str]:
    raw = private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return {"kty": "OKP", "crv": "Ed25519", "x": b64url(raw), "kid": kid, "alg": "EdDSA", "use": "sig"}


@dataclass
class Issuer:
    private: Ed25519PrivateKey
    kid: str = KID

    def claims(self, **overrides: Any) -> dict[str, Any]:
        """잡 토큰 기본값. `sub`만 바꾸면 `job`은 sub의 job_id로 맞추고(사용자 sub면 `run`·`job` 제거),
        `run`·`job`을 직접 주면 그대로 쓴다(바인딩 불일치 테스트용)."""
        now = int(time.time())
        job = str(uuid.uuid4())
        base: dict[str, Any] = {
            "iss": "arch",
            "aud": "platform-ai:arch",
            "app": "arch",
            "org": ORG_A,
            "sub": f"job:{job}",
            "job": job,
            "run": RUN_A,
            "feat": "arch.review",
            "scope": "graph:arch.review",
            "jti": str(uuid.uuid4()),
            "iat": now,
            "exp": now + 600,
        }
        base.update(overrides)
        sub = base.get("sub")
        if isinstance(sub, str) and sub.startswith("job:"):
            if "job" not in overrides:
                base["job"] = sub[len("job:") :]
        elif isinstance(sub, str):
            for name in ("run", "job"):
                if name not in overrides:
                    base.pop(name, None)
        return {k: v for k, v in base.items() if v is not None}

    def token(self, headers: dict[str, Any] | None = None, **overrides: Any) -> str:
        h = {"kid": self.kid, "ctx": "arch-ai-token-v1", **(headers or {})}
        h = {k: v for k, v in h.items() if v is not None}
        return jwt.encode(self.claims(**overrides), self.private, algorithm="EdDSA", headers=h)


@pytest.fixture(scope="session")
def signing_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


@pytest.fixture(scope="session")
def jwks_json(signing_key: Ed25519PrivateKey) -> str:
    return json.dumps({"keys": [public_jwk(signing_key, KID)]})


@pytest.fixture
def issuer(signing_key: Ed25519PrivateKey) -> Issuer:
    return Issuer(signing_key)


@pytest.fixture(autouse=True)
def dify_internal_key(monkeypatch: pytest.MonkeyPatch) -> str:
    """기동 필수 설정(테스트 전용 값, 32자 이상)."""
    key = "test-dify-internal-key-0123456789abcdef"
    monkeypatch.setenv("DIFY_INTERNAL_API_KEY", key)
    return key


@pytest.fixture
def settings(jwks_json: str, monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.delenv("AI_TOKEN_JWKS_URL", raising=False)
    monkeypatch.setenv("AI_TOKEN_JWKS", jwks_json)
    return Settings()


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings), raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def auth(issuer: Issuer) -> Callable[..., dict[str, str]]:
    def make(**overrides: Any) -> dict[str, str]:
        return {"Authorization": f"Bearer {issuer.token(**overrides)}"}

    return make
