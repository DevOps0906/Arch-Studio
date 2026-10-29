"""JWKS 주기 갱신(독립 보안 리뷰): 유출 키를 JWKS에서 빼면 모르는 kid가 오지 않아도 TTL 안에 반영된다."""

from __future__ import annotations

import json

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.auth.keys import MAX_JWKS_BYTES, KeyStore, http_fetcher, parse_jwks
from app.settings import ConfigError, Settings
from tests.conftest import public_jwk

URL = "https://jwks.example.invalid/jwks.json"


def doc(*pairs: tuple[Ed25519PrivateKey, str]) -> bytes:
    return json.dumps({"keys": [public_jwk(k, kid) for k, kid in pairs]}).encode()


def test_removed_key_disappears_after_ttl() -> None:
    leaked, good = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    docs = [doc((leaked, "leaked"), (good, "good")), doc((good, "good"))]
    calls: list[int] = []

    def fetch() -> bytes:
        calls.append(1)
        return docs[min(len(calls) - 1, 1)]

    now = [1000.0]
    store = KeyStore(parse_jwks(fetch(), "arch"), app="arch", fetcher=fetch, clock=lambda: now[0], refresh_ttl_s=600)
    assert store.get("leaked") is not None
    now[0] += 599
    assert store.get("leaked") is not None  # TTL 전: 재조회 없음
    assert len(calls) == 1
    now[0] += 2
    assert store.get("leaked") is None  # 알던 kid여도 TTL이 지나면 갱신되어 빠진다
    assert store.get("good") is not None
    assert len(calls) == 2


@pytest.mark.parametrize("bad", [b"not json", b'{"keys": []}', b"{}"])
def test_refresh_failure_keeps_existing_keys(bad: bytes) -> None:
    good = Ed25519PrivateKey.generate()
    results: list[object] = [doc((good, "good")), bad, ConfigError("JWKS 조회 실패: 네트워크")]

    def fetch() -> bytes:
        r = results.pop(0)
        if isinstance(r, Exception):
            raise r
        assert isinstance(r, bytes)
        return r

    now = [1000.0]
    store = KeyStore(parse_jwks(fetch(), "arch"), app="arch", fetcher=fetch, clock=lambda: now[0], refresh_ttl_s=600)
    now[0] += 601
    assert store.get("good") is not None  # 잘못된 문서 → 기존 키 유지
    assert store.get("unknown") is None  # 모르는 kid는 계속 거부(fail-closed)
    now[0] += 61
    assert store.get("good") is not None  # 네트워크 실패 → 기존 키 유지


def test_failed_refresh_is_retried_no_sooner_than_min_interval() -> None:
    good = Ed25519PrivateKey.generate()
    calls: list[int] = []

    def fetch() -> bytes:
        calls.append(1)
        if len(calls) == 1:
            return doc((good, "good"))
        raise ConfigError("JWKS 조회 실패: 네트워크")

    now = [1000.0]
    store = KeyStore(parse_jwks(fetch(), "arch"), app="arch", fetcher=fetch, clock=lambda: now[0], refresh_ttl_s=600)
    now[0] += 601
    for _ in range(5):
        store.get("good")
    assert len(calls) == 2  # 실패 직후 요청마다 재조회하지 않는다


def test_inline_jwks_is_never_refreshed(monkeypatch: pytest.MonkeyPatch, jwks_json: str) -> None:
    monkeypatch.delenv("AI_TOKEN_JWKS_URL", raising=False)
    monkeypatch.setenv("AI_TOKEN_JWKS", jwks_json)
    store = KeyStore.from_settings(Settings(), app="arch")
    assert store.get("nope") is None


def test_refresh_ttl_setting(monkeypatch: pytest.MonkeyPatch, jwks_json: str) -> None:
    monkeypatch.delenv("AI_TOKEN_JWKS_URL", raising=False)
    monkeypatch.setenv("AI_TOKEN_JWKS", jwks_json)
    assert Settings().jwks_refresh_s == 600
    monkeypatch.setenv("AI_TOKEN_JWKS_REFRESH_S", "5")
    with pytest.raises(ValueError):
        Settings()


def test_http_fetcher_stops_streaming_at_limit() -> None:
    sent = {"bytes": 0}

    def stream() -> object:
        for _ in range(100):  # 6.4MB를 보내려 한다
            sent["bytes"] += 64 * 1024
            yield b"a" * (64 * 1024)

    class Body(httpx.SyncByteStream):
        def __iter__(self):  # type: ignore[no-untyped-def]
            return iter(stream())  # type: ignore[call-overload]

    transport = httpx.MockTransport(lambda req: httpx.Response(200, stream=Body()))
    fetch = http_fetcher(URL, client=httpx.Client(transport=transport))
    with pytest.raises(ConfigError):
        fetch()
    assert sent["bytes"] <= 2 * MAX_JWKS_BYTES + 64 * 1024  # 상한 직후 끊는다(전체를 읽지 않음)


def test_http_fetcher_rejects_declared_oversize_and_accepts_normal() -> None:
    big = httpx.MockTransport(
        lambda req: httpx.Response(200, headers={"content-length": str(MAX_JWKS_BYTES + 1)}, content=b"x")
    )
    with pytest.raises(ConfigError):
        http_fetcher(URL, client=httpx.Client(transport=big))()
    good = Ed25519PrivateKey.generate()
    ok = httpx.MockTransport(lambda req: httpx.Response(200, content=doc((good, "good"))))
    assert b"good" in http_fetcher(URL, client=httpx.Client(transport=ok))()
