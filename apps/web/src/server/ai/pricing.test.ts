// 단가 상수 = DB seed(읽기만). seed가 바뀌면 이 테스트가 깨져 pricing.ts를 같이 고치게 한다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  CHAT_TURN_CREDITS,
  CREDIT_PACKS,
  isValidRunVariant,
  priceOf,
  RUN_KIND_VARIANTS,
  RUN_PRICES,
  STT_CREDITS_PER_MINUTE,
  type RunVariant,
} from "./pricing.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SEED_SQL = readFileSync(path.join(ROOT, "supabase/modular/2400_arch.sql"), "utf8");

function seedPrices(): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of SEED_SQL.matchAll(/\('price\.([a-z_]+)',\s*(\d+),/g)) out.set(m[1] as string, Number(m[2]));
  return out;
}

test("단가: 모든 variant가 정수 > 0이고 상태 표기가 있다", () => {
  for (const [variant, entry] of Object.entries(RUN_PRICES)) {
    assert.ok(Number.isSafeInteger(entry.credits) && entry.credits > 0, variant);
    assert.ok(["근거", "제안", "미확정"].includes(entry.status), variant);
  }
  for (const entry of [CHAT_TURN_CREDITS, STT_CREDITS_PER_MINUTE]) assert.ok(Number.isSafeInteger(entry.credits));
});

test("단가: seed runtime_config price.<variant>와 같은 값·같은 집합", () => {
  const seed = seedPrices();
  assert.equal(seed.size, Object.keys(RUN_PRICES).length);
  for (const [variant, entry] of Object.entries(RUN_PRICES)) assert.equal(seed.get(variant), entry.credits, variant);
});

test("단가: 미확정 값은 명시돼 있다(review 15·walkthrough 40)", () => {
  assert.equal(RUN_PRICES.review.status, "미확정");
  assert.equal(RUN_PRICES.walkthrough.status, "미확정");
});

test("단가: kind·variant 표의 모든 variant에 단가가 있고 그 밖은 없다", () => {
  const variants = Object.values(RUN_KIND_VARIANTS).flat();
  assert.deepEqual([...variants].sort(), Object.keys(RUN_PRICES).sort());
  assert.equal(isValidRunVariant("render", "review"), false);
  assert.equal(isValidRunVariant("render", "render_hq"), true);
  assert.equal(isValidRunVariant("intake", "__proto__"), false);
  assert.throws(() => priceOf("__proto__" as RunVariant));
  assert.throws(() => priceOf("free" as RunVariant));
});

test("크레딧팩: seed credit_packs와 같은 크레딧·원 금액(정수)", () => {
  for (const [code, pack] of Object.entries(CREDIT_PACKS)) {
    const re = new RegExp(`\\('arch', '${code}',\\s*'[^']*',\\s*(\\d+),\\s*(\\d+),`);
    const m = re.exec(SEED_SQL);
    assert.ok(m, code);
    assert.equal(Number(m[1]), pack.credits, code);
    assert.equal(Number(m[2]), pack.priceKrw, code);
    assert.ok(Number.isSafeInteger(pack.priceKrw));
  }
});

test("하드코딩 단가는 pricing.ts에만: server/ai·app/api 아래 다른 파일에 price.<variant> 표가 없다", () => {
  const dirs = [path.join(ROOT, "apps/web/src/server/ai"), path.join(ROOT, "apps/web/src/app/api")];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSafe(dir)) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(ent.name) && !ent.name.endsWith(".test.ts") && !p.endsWith("pricing.ts")) files.push(p);
    }
  };
  for (const d of dirs) walk(d);
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, /render_std\s*:\s*\d|review\s*:\s*15\b|credits\s*:\s*\d/, f);
  }
});

function readdirSafe(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
