// 규칙 팩 보관. 팩은 엔진 밖 데이터라 이 모듈은 받은 팩을 검사(loadRulePack)해 두고 선택(selectRulePack)만 한다.
// 팩의 출처는 셸(apps/desktop/src/shell/rule-packs.ts)이 Rust `rule_pack_load`(서명·해시·자격 확인)로 얻어 load_rule_pack 메시지로 넣는다.
// 개발 데모 모드만 번들 개발용 팩을 넣는다(features/demo, 릴리스 번들 0). 공급이 실패하면 이유 코드(AR063~065)를 받아 그대로 답한다.
import { loadRulePack, selectRulePack, type PackSelection, type RulePack } from "@arch-studio/rules";
import type { RulePackUnavailableCode } from "./protocol.ts";
import { HandlerError } from "./runtime.ts";

const UNAVAILABLE_TEXT: Readonly<Record<RulePackUnavailableCode, string>> = {
  AR063: "설치된 규칙 팩이 없습니다",
  AR064: "규칙 팩 검증에 실패했습니다",
  AR065: "규칙 팩을 쓸 자격이 없습니다",
};

export class RulePackStore {
  private readonly bySha = new Map<string, RulePack>();
  private readonly packs = new Map<string, RulePack>(); // version -> 팩
  private unavailable: RulePackUnavailableCode = "AR063";

  /** sha256 이 이미 있으면 다시 파싱하지 않는다(2.4절). 형식이 틀린 팩은 AR064. */
  load(version: string, sha256: string, raw: unknown): { reused: boolean } {
    const known = this.bySha.get(sha256);
    if (known) {
      this.packs.set(known.version, known);
      return { reused: true };
    }
    let pack: RulePack;
    try {
      pack = loadRulePack(raw);
    } catch {
      throw new HandlerError("AR064", "규칙 팩 형식이 올바르지 않습니다");
    }
    if (pack.version !== version) throw new HandlerError("AR064", "규칙 팩 버전이 메시지와 다릅니다");
    this.bySha.set(sha256, pack);
    this.packs.set(pack.version, pack);
    return { reused: false };
  }

  /** 공급 실패: 받은 팩을 모두 비우고(만료 뒤 옛 팩으로 판정하지 않게) 이유 코드를 기억한다. */
  markUnavailable(code: RulePackUnavailableCode): void {
    this.packs.clear();
    this.bySha.clear();
    this.unavailable = code;
  }

  async select(version: string): Promise<PackSelection> {
    if (this.packs.size === 0) throw new HandlerError(this.unavailable, UNAVAILABLE_TEXT[this.unavailable]);
    return selectRulePack([...this.packs.values()], version);
  }
}
