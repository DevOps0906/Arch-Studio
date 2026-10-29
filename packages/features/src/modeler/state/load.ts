// 저장된 설계 모델 문자열 → DesignModel v1(zod 검사, 순수). 형식이 틀리면 화면은 오류 상태를 보인다(조용히 고치지 않는다).
import { designModelV1Schema } from "@arch-studio/domain";
import type { Model } from "./commands.ts";

export type ParsedModel = { readonly ok: true; readonly model: Model } | { readonly ok: false };

export function parseModelJson(text: string): ParsedModel {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const r = designModelV1Schema.safeParse(raw);
  return r.success ? { ok: true, model: r.data } : { ok: false };
}

/** 저장된 문자열이 이 모델과 같은 내용인가(저장 후 reload 판별). 키 순서 차이는 다시 읽어 비교한다. */
export function sameModelJson(model: Model, text: string): boolean {
  const own = JSON.stringify(model);
  if (own === text) return true;
  const p = parseModelJson(text);
  return p.ok && JSON.stringify(p.model) === own;
}
