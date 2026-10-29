// 규칙 팩 로더·선택·배포 팩 불변식(AR-06-015): 근거 누락·미확인 수치 거부, 엔진 번들에 팩 0바이트, 매니페스트 최신.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 팩·소스 파일을 읽는다
import { createHash } from "node:crypto";
// eslint-disable-next-line no-restricted-imports -- 테스트는 팩·소스 파일을 읽는다
import { readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { canonicalJson, judge, loadRulePack, RulesError, selectRulePack, UNVERIFIED } from "./index.ts";
import { FIXTURE_PACK_RAW, fixtureModel } from "./test-fixtures.ts";
import { fixturePack } from "./test-helpers.ts";

const PACKS = new URL("../packs/", import.meta.url);
const readText = (u: URL) => readFileSync(u, "utf8").replace(/\r\n/g, "\n"); // autocrlf 체크아웃 대비(팀장 확인: .gitattributes)
const shippedVersions = readdirSync(PACKS).sort();

function rejects(mutate: (raw: typeof FIXTURE_PACK_RAW) => void, hint: RegExp): void {
  const raw = structuredClone(FIXTURE_PACK_RAW);
  mutate(raw);
  assert.throws(
    () => loadRulePack(raw),
    (e: unknown) => e instanceof RulesError && e.code === "INVALID_PACK" && hint.test(e.message),
  );
}

type RawRule = (typeof FIXTURE_PACK_RAW)["rules"][number] & Record<string, unknown>;
const rule = (raw: typeof FIXTURE_PACK_RAW, i: number) => raw.rules[i] as RawRule;
const UNVERIFIED_IDX = FIXTURE_PACK_RAW.rules.findIndex((r) => r.status === "unverified");

test("로더: 근거 누락·빈 칸·미확인 규칙의 수치·서명 없는 확정 규칙·조문 미확인 확정 규칙을 거부", () => {
  rejects((r) => (rule(r, 0).basis = []), /basis/);
  rejects((r) => ((rule(r, 0).basis[0] as { law: string }).law = "  "), /빈 문자열/);
  rejects((r) => (rule(r, UNVERIFIED_IDX).params = { min_floors: 2 }), /미확인 규칙에는 수치/);
  rejects((r) => delete rule(r, 0).review, /사람 법규 검토/);
  rejects((r) => delete rule(r, 0).params, /수치\(params\)가 필요/);
  rejects((r) => ((rule(r, 0).basis[0] as { article: string }).article = UNVERIFIED), /조문이 미확인/);
  rejects((r) => ((rule(r, 0).basis[0] as { effective_from: string }).effective_from = UNVERIFIED), /시행일이 날짜가 아닙니다/);
  rejects((r) => (rule(r, 0).effective_from = null), /시행일이 필요/);
  rejects((r) => (rule(r, 4).effective_to = "1999-12-31"), /폐지일/);
  rejects((r) => (rule(r, 1).id = rule(r, 0).id), /중복/);
  rejects((r) => (r.version = "2000.13.1"), /YYYY\.MM\.n/);
  rejects((r) => (rule(r, 0).params = { max_pct_by_district: { 가짜주거: 50.123 } }), /둘째 자리/);
  rejects((r) => (rule(r, 0).extra = 1), /Unrecognized/);
  rejects((r) => (rule(r, 1).ordinance_dependent = false), /ordinance_dependent가 true/); // 조례 근거(ordinance:true)
  rejects((r) => delete (rule(r, 2).params as Record<string, unknown>).far_floor_area_exclusions, /far_floor_area_exclusions/);
});

test("선택: 요청 버전이 있으면 그것, 없으면 최신 버전으로 폴백 표시", () => {
  const a = fixturePack();
  const raw = structuredClone(FIXTURE_PACK_RAW);
  raw.version = "2000.10.2";
  const b = loadRulePack(raw);
  assert.equal(selectRulePack([b, a], "2000.01.1").pack.version, "2000.01.1");
  assert.deepEqual(
    [selectRulePack([a, b], "2099.01.1").pack.version, selectRulePack([a, b], "2099.01.1").fallback],
    ["2000.10.2", true],
  );
  assert.throws(() => selectRulePack([], "x"), (e: unknown) => e instanceof RulesError && e.code === "NO_PACK");
});

test("배포 팩: 로드 가능, 정규 JSON, 미확인 규칙에는 수치 없음, 모든 규칙에 출처 문서", () => {
  assert.ok(shippedVersions.length > 0);
  for (const v of shippedVersions) {
    const text = readText(new URL(`${v}/pack.json`, PACKS));
    const pack = loadRulePack(JSON.parse(text));
    assert.equal(pack.version, v);
    assert.equal(text, canonicalJson(JSON.parse(text)), `${v}: 정규 JSON이 아님`);
    for (const r of pack.rules) {
      assert.ok(r.source.length > 0);
      if (r.status === "unverified") assert.equal(r.params, undefined);
    }
  }
});

test("배포 팩 판정: 합격·불합격 0, 모든 행 WARN·근거 있음, 조례 미확인 지자체 경고", () => {
  for (const v of shippedVersions) {
    const pack = loadRulePack(JSON.parse(readText(new URL(`${v}/pack.json`, PACKS))));
    const out = judge(fixtureModel({ rule_pack_version: v, application_date: "2026-11-01", municipality_code: "11000" }), pack);
    assert.ok(out.result.items.length > 0);
    for (const item of out.result.items) {
      assert.equal(item.verdict, "WARN");
      assert.ok(item.basis.length > 0);
    }
    assert.ok(out.warnings.some((w) => w.code === "MUNICIPALITY_NOT_IN_PACK"));
  }
});

test("매니페스트: pack.json 해시·바이트와 일치, 서명 칸은 비어 있다(키 없이 생성)", () => {
  for (const v of shippedVersions) {
    const text = readText(new URL(`${v}/pack.json`, PACKS));
    const manifest = JSON.parse(readText(new URL(`${v}/manifest.json`, PACKS))) as Record<string, unknown>;
    const bytes = Buffer.from(text, "utf8");
    assert.equal(manifest.sha256, createHash("sha256").update(bytes).digest("hex"), `${v}: manifest 갱신 필요(node scripts/rule-packs/manifest.ts packages/rules/packs/${v})`);
    assert.equal(manifest.bytes, bytes.length);
    assert.equal(manifest.version, v);
    assert.equal(manifest.signature, null);
    assert.equal(manifest.kid, null);
  }
});

test("엔진 번들에 팩 0바이트: src 배포 코드는 packs/·JSON을 import하지 않는다", () => {
  const src = new URL("./", import.meta.url);
  const files = readdirSync(src).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("test-"));
  for (const f of files) {
    const text = readFileSync(new URL(f, src), "utf8");
    assert.doesNotMatch(text, /from\s+["'][^"']*(packs\/|\.json["'])/, `${f}가 팩·JSON을 import한다`);
  }
});
