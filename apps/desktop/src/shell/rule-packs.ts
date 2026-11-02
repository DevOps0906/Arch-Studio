// RulePackProvider(AR-06-042): 엔진 워커에 규칙 팩을 공급한다. 앱 시작 때 한 번(그리고 refresh 때) 공급원을 부르고
// 결과를 load_rule_pack 메시지로 넣는다. 공급 실패는 이유 코드(AR063 팩 없음·AR064 검증 실패·AR065 자격 없음)로 알려,
// 판정·엔벨로프가 AR050(모델 무효)과 다른 안내를 띄우게 한다.
// - 설치형: Rust `rule_pack_load`(서명·sha256·크기·라이선스 자격을 디스크에서 다시 확인)만 믿는다.
// - 개발 데모: demo-rule-pack.ts(개발 빌드 + VITE_DEMO_MODE=1 조건 안에서만 동적 import, 릴리스 번들 0).
import type { EngineHost } from "@arch-studio/features/shell";
import type { RulePackLoadResult, RulePackStore } from "@arch-studio/shell-bridge";
import type { RulePackUnavailableCode } from "../workers/protocol.ts";

export type RulePackSupply =
  | { readonly kind: "pack"; readonly version: string; readonly sha256: string; readonly pack: unknown }
  | { readonly kind: "unavailable"; readonly code: RulePackUnavailableCode };

export interface RulePackProvider {
  current(): Promise<RulePackSupply>;
}

/** Rust 불러오기 결과 → 공급. 본문 JSON이 깨졌으면 검증 실패(AR064). */
export function supplyFromLoad(r: RulePackLoadResult): RulePackSupply {
  switch (r.state) {
    case "ok": {
      let pack: unknown;
      try {
        pack = JSON.parse(r.pack.text);
      } catch {
        return { kind: "unavailable", code: "AR064" };
      }
      return { kind: "pack", version: r.pack.version, sha256: r.pack.sha256, pack };
    }
    case "missing":
      return { kind: "unavailable", code: "AR063" };
    case "not_entitled":
      return { kind: "unavailable", code: "AR065" };
    default:
      return { kind: "unavailable", code: "AR064" };
  }
}

/**
 * 설치형 공급원. `licenseFile`은 저장된 서명 라이선스 파일 문자열(Rust가 다시 검증). 라이선스 저장 경로가 연결되기 전(041·074 후속)에는
 * null → 설치된 팩이 있어도 AR065(실패 닫힘). 저장소가 없으면(웹뷰 밖) AR063.
 */
export function rustRulePackProvider(store: RulePackStore | null, licenseFile: () => Promise<string | null>): RulePackProvider {
  return {
    async current() {
      if (!store) return { kind: "unavailable", code: "AR063" };
      let lic: string | null = null;
      try {
        lic = await licenseFile();
      } catch {
        lic = null;
      }
      return supplyFromLoad(await store.load(lic));
    },
  };
}

/**
 * 웹 스튜디오 공급원(AR-06-071 결정 11): 웹 규칙 팩(서명 URL 수신·서명 검증)은 075와 함께 온다. 그 전까지는 항상 팩 없음(AR063)
 * → 판정·엔벨로프 화면이 "규칙 팩 없음" 안내를 띄운다(모델 무효 AR050과 구분).
 */
export function webRulePackProvider(): RulePackProvider {
  return { current: async () => ({ kind: "unavailable", code: "AR063" }) };
}

/** 공급 결과를 워커 메시지로. 반환값은 화면 진단용(본문 없음). */
export async function connectRulePacks(
  engine: EngineHost,
  provider: RulePackProvider,
  newId: () => string = () => `rule-pack-${Date.now().toString(36)}`,
): Promise<{ state: "loaded"; version: string } | { state: "unavailable"; code: RulePackUnavailableCode }> {
  let supply: RulePackSupply;
  try {
    supply = await provider.current();
  } catch {
    supply = { kind: "unavailable", code: "AR064" };
  }
  if (supply.kind === "pack") {
    const msg = { op: "load_rule_pack", req_id: newId(), version: supply.version, sha256: supply.sha256, pack: supply.pack };
    engine.send(msg);
    return { state: "loaded", version: supply.version };
  }
  const msg = { op: "load_rule_pack", req_id: newId(), version: "", sha256: "", pack: null, unavailable: supply.code };
  engine.send(msg);
  return { state: "unavailable", code: supply.code };
}
