// 제안 적용(순수): 후보 매스로 모델의 매스를 통째로 바꾼다. 모델러 이력에는 명령 1개("매스 제안 적용")로 쌓여 실행 취소 한 번에 되돌아간다.
// - 후보 좌표는 엔진이 만든 값이지만 신뢰 경계 밖에서 왔으므로 모델러 명령과 같은 범위 검사를 한 번 더 한다(footprintIssue·LIMITS).
// - 매스를 바꾸면 기존 층 평면(floor_layouts)은 가리킬 층이 없어지므로 함께 지운다(실행 취소로 복원).
import type { CommandResult, Mass, Model } from "../state/commands.ts";
import { LIMITS, footprintIssue } from "../state/commands.ts";

export const SUGGEST_LABEL = "매스 제안 적용";

export function applySuggestion(model: Model, masses: readonly Mass[]): CommandResult {
  const fail = (reason: string): CommandResult => ({ ok: false, reason });
  if (masses.length < 1) return fail("적용할 매스가 없습니다.");
  if (masses.length > LIMITS.masses) return fail(`매스는 ${LIMITS.masses}개까지입니다.`);
  const ids = new Set<string>();
  const floorIds = new Set<string>();
  for (const m of masses) {
    if (ids.has(m.id)) return fail("제안 결과의 매스 번호가 겹칩니다.");
    ids.add(m.id);
    const issue = footprintIssue(m.footprint.outer);
    if (issue) return fail(`제안 결과를 쓸 수 없습니다: ${issue}`);
    if (m.floors.length < 1 || m.floors.length > LIMITS.floors) return fail(`제안 결과의 층 수가 범위(1~${LIMITS.floors})를 벗어납니다.`);
    for (const f of m.floors) {
      if (!Number.isSafeInteger(f.height_mm) || f.height_mm < LIMITS.floorHeightMin || f.height_mm > LIMITS.floorHeightMax) return fail("제안 결과의 층고가 범위를 벗어납니다.");
      if (floorIds.has(f.id)) return fail("제안 결과의 층 번호가 겹칩니다.");
      floorIds.add(f.id);
    }
  }
  return { ok: true, model: { ...model, masses: [...masses], floor_layouts: [] }, select: masses[0]?.id ?? null };
}
