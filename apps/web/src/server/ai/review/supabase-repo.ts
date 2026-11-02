// 클라우드 검토 Supabase 구현. 클라이언트는 deps.ts가 만들어 넘긴다(env 접근은 거기서만).
// service_role 사용 지점(이유): RulePackSource 1곳. 규칙 팩 원문은 비공개 버킷 arch-releases에 있고 사용자 정책이 없다(02_ARCHITECTURE.md 403행).
// 읽는 경로는 DB 값이 아니라 버전에서 서버가 만든 경로(packStoragePath)이고, 게시(published) 행의 sha256·크기와 대조한 원문만 쓴다.
// 기능 판정은 사용자 JWT(RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../gateway/supabase-repo.ts";
import type { SchemaNames } from "../../licenses/supabase-repo.ts";
import { MAX_PACK_BYTES, packStoragePath, sha256Hex, VERSION_RE } from "../../rule-packs/manifest.ts";
import { supabaseReleasePrivilegedRepo } from "../../rule-packs/supabase-repo.ts";
import { parseRulePack, type RulePack } from "./recompute.ts";
import type { ReviewOrgRepo, RulePackSource } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

/** 검증을 통과한 팩 캐시(버전 + sha256 키). 팩은 게시 후 바뀌지 않지만 철회·교체에 대비해 sha256까지 맞을 때만 재사용한다. */
const CACHE_MAX = 8;

export function supabaseRulePackSource(service: Client, schemas: SchemaNames): RulePackSource {
  const repo = supabaseReleasePrivilegedRepo(service, schemas);
  const cache = new Map<string, RulePack>();
  return {
    async load(version) {
      if (!VERSION_RE.test(version)) return null;
      const row = await repo.rulePackObject(version);
      if (!row || row.status !== "published") return null;
      const key = `${version}:${row.sha256}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const text = await repo.readSmallText(packStoragePath(version), MAX_PACK_BYTES);
      if (text === null) return null;
      const bytes = Buffer.from(text, "utf8");
      if (bytes.byteLength !== row.bytes || sha256Hex(bytes) !== row.sha256) return null; // 원문 불일치: 실패 닫힘
      const pack = parseRulePack(text);
      if (!pack || pack.version !== version) return null;
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, pack);
      return pack;
    },
  };
}

export function supabaseReviewOrg(user: Client, schemas: SchemaNames): ReviewOrgRepo {
  return {
    async orgFeatures(orgId) {
      const { data, error } = await user.schema(schemas.arch).rpc("org_features", { p_org: orgId });
      if (error) throw new DbCodeError(error);
      return data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    },
    async reviewInputSha256(runId) {
      // RLS reviews_select(조직 구성원 읽기). 렌더 등 다른 실행 테이블의 id면 행이 없다 → null.
      const { data, error } = await user.schema(schemas.arch).from("reviews").select("model_summary").eq("id", runId).maybeSingle();
      if (error) throw new DbCodeError(error);
      const sha = (data as { model_summary?: { input_sha256?: unknown } } | null)?.model_summary?.input_sha256;
      return typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha) ? sha : null;
    },
  };
}
