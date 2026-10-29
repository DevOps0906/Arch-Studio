"""기동 거부: 검증 키 없음·잘못된 키·평문 URL·개인키 포함(공격 A1·A14)."""

from __future__ import annotations

import json

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.auth.keys import KeyStore, http_fetcher, parse_jwks
from app.main import create_app
from app.settings import ConfigError, Settings, load_settings
from tests.conftest import KID, b64url, public_jwk


def test_no_key_refuses_boot(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AI_TOKEN_JWKS", raising=False)
    monkeypatch.delenv("AI_TOKEN_JWKS_URL", raising=False)
    with pytest.raises(ConfigError):
        load_settings()
    with pytest.raises(ConfigError):
        create_app()


def test_both_key_sources_refuse_boot(monkeypatch: pytest.MonkeyPatch, jwks_json: str) -> None:
    monkeypatch.setenv("AI_TOKEN_JWKS", jwks_json)
    monkeypatch.setenv("AI_TOKEN_JWKS_URL", "https://example.invalid/jwks.json")
    with pytest.raises(ConfigError):
        load_settings()


def test_jwks_url_must_be_https(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AI_TOKEN_JWKS", raising=False)
    monkeypatch.setenv("AI_TOKEN_JWKS_URL", "http://example.invalid/jwks.json")
    with pytest.raises(ConfigError):
        load_settings()


def test_jwks_with_private_key_refuses_boot(signing_key: Ed25519PrivateKey) -> None:
    from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat

    jwk = public_jwk(signing_key, KID)
    jwk["d"] = b64url(signing_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption()))
    with pytest.raises(ConfigError, match="개인키"):
        parse_jwks(json.dumps({"keys": [jwk]}), "arch")


@pytest.mark.parametrize(
    "doc",
    [
        "not json",
        json.dumps({}),
        json.dumps({"keys": []}),
        json.dumps({"keys": [{"kty": "RSA", "n": "x", "e": "AQAB", "kid": "r"}]}),
        json.dumps({"keys": [{"kty": "oct", "k": "c2VjcmV0", "kid": "h"}]}),
        json.dumps({"keys": [{"kty": "OKP", "crv": "X25519", "x": "AAAA", "kid": "x"}]}),
        json.dumps({"keys": [{"kty": "OKP", "crv": "Ed25519", "x": "AAAA"}]}),  # kid 없음
        json.dumps({"keys": [{"kty": "OKP", "crv": "Ed25519", "x": "AAAA", "kid": "k", "alg": "HS256"}]}),
        json.dumps({"keys": [{"kty": "OKP", "crv": "Ed25519", "x": "!!", "kid": "k"}]}),
    ],
)
def test_bad_jwks_refuses_boot(doc: str) -> None:
    with pytest.raises(ConfigError):
        parse_jwks(doc, "arch")


def test_duplicate_kid_refuses_boot(signing_key: Ed25519PrivateKey) -> None:
    jwk = public_jwk(signing_key, KID)
    with pytest.raises(ConfigError):
        parse_jwks(json.dumps({"keys": [jwk, jwk]}), "arch")


def test_jwks_url_fetch_failure_refuses_boot(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AI_TOKEN_JWKS", raising=False)
    monkeypatch.setenv("AI_TOKEN_JWKS_URL", "https://jwks.example.invalid/jwks.json")
    transport = httpx.MockTransport(lambda req: httpx.Response(503))
    fetch = http_fetcher("https://jwks.example.invalid/jwks.json", client=httpx.Client(transport=transport))
    with pytest.raises(ConfigError):
        KeyStore.from_settings(Settings(), app="arch", fetcher=fetch)


def test_jwks_url_mode_refreshes_unknown_kid_rate_limited(jwks_json: str) -> None:
    other = Ed25519PrivateKey.generate()
    docs = [jwks_json, json.dumps({"keys": [public_jwk(other, "kid-2")]})]
    calls: list[int] = []

    def fetch() -> bytes:
        calls.append(1)
        return docs[min(len(calls) - 1, 1)].encode()

    now = [1000.0]
    store = KeyStore(parse_jwks(fetch(), "arch"), app="arch", fetcher=fetch, clock=lambda: now[0])
    assert store.get(KID) is not None
    assert store.get("kid-2") is None  # 60초 안: 재조회하지 않는다
    assert len(calls) == 1
    now[0] += 61
    assert store.get("kid-2") is not None
    assert len(calls) == 2
