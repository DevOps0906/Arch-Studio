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
        now = int(time.time())
        base: dict[str, Any] = {
            "iss": "arch",
            "aud": "platform-ai:arch",
            "app": "arch",
            "org": ORG_A,
            "sub": f"job:{uuid.uuid4()}",
            "feat": "arch.review",
            "scope": "graph:arch.review",
            "jti": str(uuid.uuid4()),
            "iat": now,
            "exp": now + 600,
        }
        base.update(overrides)
        return {k: v for k, v in base.items() if v is not None}

    def token(self, headers: dict[str, Any] | None = None, **overrides: Any) -> str:
        h = {"kid": self.kid, **(headers or {})}
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
