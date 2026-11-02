// 규칙 팩 서명 검증(AR-06-051 B1). 서버가 팩을 **쓰기 전에** 자기 손으로 확인한다(데스크톱 Rust verify_rule_pack과 같은 입력).
// 서명 입력 = "arch-rulepack-v1\n" ‖ manifest 바이트. 공개키 형식 = `kid:hex64[,kid:hex64…]`(데스크톱 ARCH_RULEPACK_PUBKEYS와 같다).
// 키가 없거나 형식이 틀리면 어떤 서명도 통과시키지 않는다(실패 닫힘). 개인키는 웹 서버에 없다.
// server-only를 import하지 않는다(node --test 대상).
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { RULEPACK_SIGNING_CONTEXT } from "./manifest.ts";

/** Ed25519 공개키 32바이트 → SPKI DER 접두. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const KID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** `kid:hex64,…` → kid별 공개키. 하나라도 형식이 틀리거나 kid가 겹치면 빈 맵(실패 닫힘). */
export function parseRulePackPubKeys(raw: string | undefined): ReadonlyMap<string, KeyObject> {
  const out = new Map<string, KeyObject>();
  if (!raw || raw.trim() === "") return out;
  try {
    for (const part of raw.split(",")) {
      const [kid, hex, ...rest] = part.trim().split(":");
      if (rest.length > 0 || !kid || !hex || !KID_RE.test(kid) || !HEX64.test(hex) || out.has(kid)) return new Map();
      out.set(kid, createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, "hex")]), format: "der", type: "spki" }));
    }
  } catch {
    return new Map();
  }
  return out;
}

export type PackSignatureCheck = { ok: true } | { ok: false; reason: "no_keys" | "unknown_kid" | "bad_signature" };

/** 서명 매니페스트 문자열(checkSignedManifest 통과분)의 Ed25519 서명을 공개키로 검증한다. */
export function verifySignedManifest(text: string, keys: ReadonlyMap<string, KeyObject>): PackSignatureCheck {
  if (keys.size === 0) return { ok: false, reason: "no_keys" };
  let outer: { manifest?: unknown; sig?: unknown; kid?: unknown };
  try {
    outer = JSON.parse(text) as typeof outer;
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (typeof outer.manifest !== "string" || typeof outer.sig !== "string" || typeof outer.kid !== "string") return { ok: false, reason: "bad_signature" };
  const key = keys.get(outer.kid);
  if (!key) return { ok: false, reason: "unknown_kid" };
  const body = Buffer.from(outer.manifest, "base64url");
  const sig = Buffer.from(outer.sig, "base64url");
  const ok = verify(null, Buffer.concat([Buffer.from(RULEPACK_SIGNING_CONTEXT, "utf8"), body]), key, sig);
  return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
}
