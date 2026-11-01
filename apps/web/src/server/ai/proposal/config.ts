// 제안서 PDF 실패 닫힘 스위치(웹·워커 공유 env 이름과 해석, AR-06-056 render와 같은 규칙).
// 켜짐 = 스위치가 정확히 "true" **이고** 사용 가능한 제공자(PDF 렌더러·서술)가 있음.
// 제공자 규칙은 워커(workers/arch-jobs/src/config.ts loadProposalConfig)와 같다: 지금은 "mock"만, NODE_ENV가 development·test일 때만.
// 공용 WeasyPrint 계약(R-A5, app_id에 arch 추가) 반영 전이라 실제 렌더러는 없다 → 운영에서는 항상 꺼짐(503·차감 0).
// 같은 입력 표로 양쪽을 검사하는 테스트: service.test.ts·handler.test.ts의 PROPOSAL_CONFIG_CASES.
// server-only를 import하지 않는다(node --test 대상).

export const PROPOSAL_ENABLED_ENV = "ARCH_AI_PROPOSAL_ENABLED";
export const PROPOSAL_PROVIDER_ENV = "ARCH_PROPOSAL_PROVIDER";
/** 서술 경로. 정확히 "oss"일 때만 국외 이전이 없다고 본다. 그 밖(값 없음 포함)은 국외 제공자로 보고 동의를 요구한다(실패 닫힘). */
export const PROPOSAL_NARRATIVE_ROUTE_ENV = "ARCH_PROPOSAL_NARRATIVE_ROUTE";

type Env = Readonly<Record<string, string | undefined>>;

const DEV_ENVS = new Set(["development", "test"]);

/** 사용 가능한 제공자 이름. 없으면 null. 실제 렌더러(공용 WeasyPrint)가 생기면 워커와 같은 작업에서 함께 추가한다. */
export function proposalProviderOf(env: Env): "mock" | null {
  return env[PROPOSAL_PROVIDER_ENV] === "mock" && DEV_ENVS.has(env["NODE_ENV"] ?? "") ? "mock" : null;
}

export function isProposalEnabled(env: Env): boolean {
  return env[PROPOSAL_ENABLED_ENV] === "true" && proposalProviderOf(env) !== null;
}

/** 서술 생성이 국외 제공자를 쓰는가(쓰면 kind='proposal' 요청에 국외 이전 동의가 필요하다, 01_PRD.md:265). */
export function isNarrativeCrossBorder(env: Env): boolean {
  return env[PROPOSAL_NARRATIVE_ROUTE_ENV] !== "oss";
}
