"""토큰 검증 공격 테스트(tasks/logs/AR-06-046.md 0장 A1~A7)."""

from __future__ import annotations

import base64
import json
import time
import uuid
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from app.auth.keys import KeyStore, parse_jwks
from app.auth.tokens import AuthError, verify_token
from tests.conftest import KID, Issuer, public_jwk

RUN_ID = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def keys(jwks_json: str) -> KeyStore:
    return KeyStore(parse_jwks(jwks_json, "arch"), app="arch")


def reason(token: str, keys: KeyStore) -> str:
    with pytest.raises(AuthError) as info:
        verify_token(token, keys)
    return info.value.code


def _b64(obj: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def test_valid_token(issuer: Issuer, keys: KeyStore) -> None:
    claims = verify_token(issuer.token(), keys)
    assert claims.app == "arch"
    assert claims.org == "11111111-1111-4111-8111-111111111111"
    assert claims.job_id is not None


def test_forged_signature_401(keys: KeyStore) -> None:
    forger = Issuer(Ed25519PrivateKey.generate())  # 같은 kid, 다른 키
    assert reason(forger.token(), keys) == "TOKEN_SIGNATURE"


def test_tampered_payload_401(issuer: Issuer, keys: KeyStore) -> None:
    head, _, sig = issuer.token().split(".")
    payload = _b64(issuer.claims(org="22222222-2222-4222-8222-222222222222"))
    assert reason(f"{head}.{payload}.{sig}", keys) == "TOKEN_SIGNATURE"


def test_unknown_kid_401(issuer: Issuer, keys: KeyStore) -> None:
    assert reason(issuer.token(headers={"kid": "nope"}), keys) == "TOKEN_KID"


def test_missing_kid_401(issuer: Issuer, keys: KeyStore) -> None:
    token = jwt.encode(issuer.claims(), issuer.private, algorithm="EdDSA")
    assert reason(token, keys) == "TOKEN_KID"


def test_alg_none_401(issuer: Issuer, keys: KeyStore) -> None:
    token = f"{_b64({'alg': 'none', 'typ': 'JWT', 'kid': KID})}.{_b64(issuer.claims())}."
    assert reason(token, keys) == "TOKEN_ALG"


def test_alg_hs256_with_public_key_401(issuer: Issuer, keys: KeyStore, jwks_json: str) -> None:
    # 공개키 x 값을 HMAC 비밀로 쓰는 고전적 알고리즘 혼동 공격
    secret = json.loads(jwks_json)["keys"][0]["x"].encode()
    token = jwt.encode(issuer.claims(), secret, algorithm="HS256", headers={"kid": KID})
    assert reason(token, keys) == "TOKEN_ALG"


@pytest.mark.parametrize("header", ["jku", "x5u", "jwk", "x5c"])
def test_embedded_key_header_401(issuer: Issuer, keys: KeyStore, header: str) -> None:
    value: Any = {"kty": "OKP"} if header == "jwk" else "https://attacker.invalid/k"
    assert reason(issuer.token(headers={header: value}), keys) == "TOKEN_HEADER"


def test_expired_401(issuer: Issuer, keys: KeyStore) -> None:
    now = int(time.time())
    assert reason(issuer.token(iat=now - 700, exp=now - 100), keys) == "TOKEN_EXPIRED"


def test_lifetime_too_long_401(issuer: Issuer, keys: KeyStore) -> None:
    now = int(time.time())
    assert reason(issuer.token(iat=now, exp=now + 3600), keys) == "TOKEN_LIFETIME"


def test_future_iat_401(issuer: Issuer, keys: KeyStore) -> None:
    now = int(time.time())
    assert reason(issuer.token(iat=now + 300, exp=now + 600), keys) in {"TOKEN_NOT_YET_VALID", "TOKEN_INVALID"}


@pytest.mark.parametrize("claim", ["exp", "iat", "jti", "sub", "iss", "aud"])
def test_missing_required_claim_401(issuer: Issuer, keys: KeyStore, claim: str) -> None:
    claims = issuer.claims()
    claims.pop(claim)
    token = jwt.encode(claims, issuer.private, algorithm="EdDSA", headers={"kid": KID})
    assert reason(token, keys) in {"TOKEN_CLAIMS", "TOKEN_AUDIENCE"}


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"aud": "platform-ai:toon"}, "TOKEN_AUDIENCE"),
        ({"aud": ["platform-ai:arch", "platform-ai:toon"]}, "TOKEN_AUDIENCE"),
        ({"iss": "toon"}, "TOKEN_AUDIENCE"),
        ({"app": "toon"}, "TOKEN_AUDIENCE"),
        ({"org": "not-a-uuid"}, "TOKEN_CLAIMS"),
        ({"org": None}, "TOKEN_CLAIMS"),
        ({"sub": "job:not-a-uuid"}, "TOKEN_CLAIMS"),
        ({"scope": "graph:arch.review graph:arch.intake"}, "TOKEN_SCOPE"),
        ({"scope": ["graph:arch.review"]}, "TOKEN_SCOPE"),
        ({"scope": None}, "TOKEN_SCOPE"),
        ({"jti": "short"}, "TOKEN_CLAIMS"),
    ],
)
def test_bad_claims_401(issuer: Issuer, keys: KeyStore, overrides: dict[str, Any], code: str) -> None:
    assert reason(issuer.token(**overrides), keys) == code


def test_valid_job_token_carries_binding(issuer: Issuer, keys: KeyStore) -> None:
    job = str(uuid.uuid4())
    claims = verify_token(issuer.token(sub=f"job:{job}", run=RUN_ID), keys)
    assert claims.job == job == claims.job_id
    assert claims.run == RUN_ID


@pytest.mark.parametrize("missing", ["run", "job"])
def test_job_token_without_binding_401(issuer: Issuer, keys: KeyStore, missing: str) -> None:
    assert reason(issuer.token(**{missing: None}), keys) == "TOKEN_BINDING"


def test_job_claim_must_match_sub_401(issuer: Issuer, keys: KeyStore) -> None:
    assert reason(issuer.token(job=str(uuid.uuid4())), keys) == "TOKEN_BINDING"


@pytest.mark.parametrize("value", ["not-a-uuid", 123, "", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"])
def test_run_claim_must_be_uuid_401(issuer: Issuer, keys: KeyStore, value: object) -> None:
    assert reason(issuer.token(run=value), keys) == "TOKEN_BINDING"


@pytest.mark.parametrize("extra", [{"run": RUN_ID}, {"job": "44444444-4444-4444-8444-444444444444"}])
def test_user_token_with_binding_claims_401(issuer: Issuer, keys: KeyStore, extra: dict[str, Any]) -> None:
    assert reason(issuer.token(sub=str(uuid.uuid4()), scope="chat", **extra), keys) == "TOKEN_CLAIMS"


def test_user_token_has_no_binding(issuer: Issuer, keys: KeyStore) -> None:
    claims = verify_token(issuer.token(sub=str(uuid.uuid4()), scope="chat"), keys)
    assert claims.run is None and claims.job is None and claims.job_id is None


def test_token_too_long_401(keys: KeyStore) -> None:
    assert reason("a" * 5000, keys) == "TOKEN_MALFORMED"


def test_garbage_token_401(keys: KeyStore) -> None:
    assert reason("not.a.jwt", keys) == "TOKEN_MALFORMED"


def test_key_bound_to_other_product_rejects_arch_token(issuer: Issuer, signing_key: Ed25519PrivateKey) -> None:
    # 같은 키가 다른 제품(toon)에 묶여 있으면 arch 토큰은 iss/aud 불일치로 거부된다(제품 간 교차 사용 차단).
    toon_keys = KeyStore(parse_jwks(json.dumps({"keys": [public_jwk(signing_key, KID)]}), "toon"), app="toon")
    assert reason(issuer.token(), toon_keys) == "TOKEN_AUDIENCE"


# --- HTTP 경로 ---------------------------------------------------------------


def test_no_token_401(client: TestClient) -> None:
    res = client.post("/graphs/arch.review/runs", json={"run_id": RUN_ID})
    assert res.status_code == 401
    assert res.headers["www-authenticate"].startswith("Bearer")
    assert res.json() == {"ok": False, "error": {"code": "UNAUTHORIZED", "message": "인증이 필요합니다"}}


def test_no_token_get_run_401(client: TestClient) -> None:
    assert client.get(f"/graphs/runs/{uuid.uuid4()}").status_code == 401


@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer a b", "token"])
def test_malformed_authorization_401(client: TestClient, header: str) -> None:
    res = client.post("/graphs/arch.review/runs", json={"run_id": RUN_ID}, headers={"Authorization": header})
    assert res.status_code == 401


def test_invalid_token_401_before_body_validation(client: TestClient) -> None:
    # 본문이 깨져 있어도 인증이 먼저다(인증 없이 검증 오류로 내부 계약을 탐색하지 못하게).
    res = client.post(
        "/graphs/arch.review/runs",
        content=b"{not json",
        headers={"Authorization": "Bearer x.y.z", "content-type": "application/json"},
    )
    assert res.status_code == 401


def test_forged_token_http_401(client: TestClient) -> None:
    token = Issuer(Ed25519PrivateKey.generate()).token()
    res = client.post("/graphs/arch.review/runs", json={"run_id": RUN_ID}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401
