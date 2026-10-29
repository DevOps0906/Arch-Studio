// 설치형 RulePackStore: Rust `rule_pack_install`·`rule_pack_load`(AR-06-042). 응답은 알려진 상태 이름만 받아들이고,
// 모양이 틀리면 실패 닫힘(load → invalid, install → malformed). 입력 상한은 IPC 전에 TS가 먼저 거부하고 Rust가 다시 강제한다.
import {
  RULE_PACK_INSTALL_STATES,
  RULE_PACK_LIMITS,
  RULE_PACK_LOAD_STATES,
  type RulePackInstallResult,
  type RulePackInstallState,
  type RulePackLoadResult,
  type RulePackStore,
} from "../adapters/rule-packs.ts";
import { RULE_PACK_INSTALL_COMMAND, RULE_PACK_LOAD_COMMAND, type InvokeFn } from "./invoke.ts";

const VERSION = /^[0-9]{4}\.[0-9]{2}\.[0-9]{1,3}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export class TauriRulePackStore implements RulePackStore {
  readonly #invoke: InvokeFn;

  constructor(invoke: InvokeFn) {
    this.#invoke = invoke;
  }

  async load(licenseFile: string | null): Promise<RulePackLoadResult> {
    let raw: unknown;
    try {
      raw = await this.#invoke(RULE_PACK_LOAD_COMMAND, { licenseFile });
    } catch {
      return { state: "invalid" };
    }
    if (!isObj(raw) || !(RULE_PACK_LOAD_STATES as readonly unknown[]).includes(raw.state)) return { state: "invalid" };
    if (raw.state !== "ok") return { state: raw.state as Exclude<RulePackLoadResult["state"], "ok"> };
    const p = raw.pack;
    if (
      !isObj(p) ||
      typeof p.version !== "string" ||
      !VERSION.test(p.version) ||
      typeof p.sha256 !== "string" ||
      !HEX64.test(p.sha256) ||
      typeof p.basis_date !== "string" ||
      typeof p.published_at !== "string" ||
      typeof p.text !== "string"
    ) {
      return { state: "invalid" };
    }
    return { state: "ok", pack: Object.freeze({ version: p.version, sha256: p.sha256, basisDate: p.basis_date, publishedAt: p.published_at, text: p.text }) };
  }

  async install(licenseFile: string | null, signedManifest: string, packText: string): Promise<RulePackInstallResult> {
    if (utf8Bytes(signedManifest) > RULE_PACK_LIMITS.maxSignedManifestBytes || utf8Bytes(packText) > RULE_PACK_LIMITS.maxPackBytes) {
      return { state: "too_large", version: null };
    }
    let raw: unknown;
    try {
      raw = await this.#invoke(RULE_PACK_INSTALL_COMMAND, { licenseFile, signedManifest, pack: packText });
    } catch {
      return { state: "write_failed", version: null };
    }
    if (!isObj(raw) || !(RULE_PACK_INSTALL_STATES as readonly unknown[]).includes(raw.state)) return { state: "malformed", version: null };
    const version = typeof raw.version === "string" && VERSION.test(raw.version) ? raw.version : null;
    return { state: raw.state as RulePackInstallState, version };
  }
}
