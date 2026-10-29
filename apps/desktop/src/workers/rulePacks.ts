// 규칙 팩 보관. 팩은 엔진 밖 데이터라 이 모듈은 받은 팩을 검사(loadRulePack)해 두고 선택(selectRulePack)만 한다.
// 팩의 출처(Rust 서명·자격 확인 후 load_rule_pack 메시지, 또는 후속 구현의 RulePackProvider)는 주입된다.
import { loadRulePack, selectRulePack, type PackSelection, type RulePack } from "@arch-studio/rules";
import { HandlerError } from "./runtime.ts";

/** 규칙 팩 공급자(구현은 후속 작업: 앱 번들·Rust 서명 확인 경로). 메시지로 받은 팩이 없을 때만 쓴다. */
export interface RulePackProvider {
  listPacks(): Promise<readonly unknown[]>;
}

export class RulePackStore {
  private readonly bySha = new Map<string, RulePack>();
  private readonly packs = new Map<string, RulePack>(); // version -> 팩
  private providerLoaded = false;

  private readonly provider: RulePackProvider | undefined;

  constructor(provider?: RulePackProvider) {
    this.provider = provider;
  }

  /** sha256 이 이미 있으면 다시 파싱하지 않는다(2.4절). */
  load(version: string, sha256: string, raw: unknown): { reused: boolean } {
    const known = this.bySha.get(sha256);
    if (known) {
      this.packs.set(known.version, known);
      return { reused: true };
    }
    const pack = loadRulePack(raw);
    if (pack.version !== version) throw new HandlerError("AR050", "규칙 팩 버전이 메시지와 다릅니다");
    this.bySha.set(sha256, pack);
    this.packs.set(pack.version, pack);
    return { reused: false };
  }

  async select(version: string): Promise<PackSelection> {
    if (this.packs.size === 0 && this.provider && !this.providerLoaded) {
      this.providerLoaded = true;
      for (const raw of await this.provider.listPacks()) {
        const pack = loadRulePack(raw);
        this.packs.set(pack.version, pack);
      }
    }
    if (this.packs.size === 0) throw new HandlerError("AR050", "규칙 팩이 없습니다");
    return selectRulePack([...this.packs.values()], version);
  }
}
