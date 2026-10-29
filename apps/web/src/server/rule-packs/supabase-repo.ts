// ReleaseDeps의 Supabase 구현. 클라이언트는 deps.ts가 만들어 넘긴다(env 접근은 거기서만).
// DB 오류는 SQLSTATE만 남기고(DbCallError) 메시지 원문은 버린다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCallError } from "../licenses/errors.ts";
import type { OrgFeaturesView } from "../licenses/payload.ts";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import type { BuildRow, CostCatalogRow, EligibleRulePackRow, ReleasePrivilegedRepo, ReleaseUserRepo, RulePackChangeRow, RulePackObjectRow } from "./types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

/** 빌드·규칙 팩·단가표 비공개 버킷(02_ARCHITECTURE.md 403행). */
export const RELEASES_BUCKET = "arch-releases";

function rows<T>(result: { data: unknown; error: unknown }): T[] {
  if (result.error) throw new DbCallError(result.error);
  return Array.isArray(result.data) ? (result.data as T[]) : [];
}

function maybeOne<T>(result: { data: unknown; error: unknown }): T | null {
  if (result.error) throw new DbCallError(result.error);
  return (result.data as T | null) ?? null;
}

export function supabaseReleaseUserRepo(client: Client, schemas: SchemaNames): ReleaseUserRepo {
  const arch = () => client.schema(schemas.arch);
  return {
    async eligibleRulePacks(orgId) {
      return rows<EligibleRulePackRow>(await arch().rpc("eligible_rule_packs", { p_org: orgId }));
    },
    async rulePackStatus(version) {
      return maybeOne<{ status: string }>(await arch().from("rule_packs").select("status").eq("version", version).maybeSingle());
    },
    async changesPublishedAfter(publishedAtIso, limit) {
      let q = arch().from("rule_packs").select("id").eq("status", "published");
      if (publishedAtIso) q = q.gt("published_at", publishedAtIso);
      const ids = rows<{ id: string }>(await q.limit(limit)).map((r) => r.id);
      if (ids.length === 0) return [];
      return rows<RulePackChangeRow>(
        await arch().from("rule_pack_changes").select("title, effective_from").in("rule_pack_id", ids).order("effective_from", { ascending: true }).limit(limit),
      );
    },
    async latestCostCatalog(orgId) {
      return rows<CostCatalogRow>(await arch().rpc("latest_cost_catalog", { p_org: orgId }))[0] ?? null;
    },
    async orgFeatures(orgId) {
      const r = await arch().rpc("org_features", { p_org: orgId });
      if (r.error) throw new DbCallError(r.error);
      return r.data as OrgFeaturesView;
    },
  };
}

export function supabaseReleasePrivilegedRepo(client: Client, schemas: SchemaNames): ReleasePrivilegedRepo {
  const arch = () => client.schema(schemas.arch);
  return {
    async rulePackObject(version) {
      return maybeOne<RulePackObjectRow>(
        await arch().from("rule_packs").select("storage_path, status, sha256, bytes, kid, signature").eq("version", version).maybeSingle(),
      );
    },
    async signedUrl(path, seconds) {
      const { data, error } = await client.storage.from(RELEASES_BUCKET).createSignedUrl(path, seconds);
      if (error || !data?.signedUrl) throw new DbCallError({ code: "internal" });
      return data.signedUrl;
    },
    async readSmallText(path, maxBytes) {
      const { data, error } = await client.storage.from(RELEASES_BUCKET).download(path);
      if (error || !data) return null;
      if (data.size > maxBytes) return null;
      const text = await data.text();
      return Buffer.byteLength(text, "utf8") <= maxBytes ? text : null;
    },
    async eligibleBuild(orgId, platform, current) {
      const r = await arch().rpc("eligible_build", { p_org: orgId, p_platform: platform, p_current: current });
      if (r.error) throw new DbCallError(r.error);
      const row = r.data as BuildRow | null;
      // 복합 반환형 null은 모든 열이 null인 행으로 올 수 있다.
      return row && typeof row.version === "string" ? row : null;
    },
    async build(platform, version) {
      return maybeOne<{ build_date: string }>(
        await arch().from("builds").select("build_date").eq("platform", platform).eq("version", version).eq("channel", "stable").maybeSingle(),
      );
    },
  };
}
