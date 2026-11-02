// 시트 목록 저장 v2 이행(AR-06-086): v1(annotation_overrides) 읽기 전용 이행, 시트 단위 실패 격리, v1 불변.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_PROJECTS } from "../demo/samples.ts";
import { legacyStoreKey, newSpec, parseStored, parseStoredLegacy, readStoredSheets, serializeStored, storeKey } from "./model.ts";

const house = DEMO_PROJECTS[0]!.model;

function memStorage(init: Record<string, string>) {
  const data = new Map(Object.entries(init));
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k);
      data.set(k, v);
    },
  };
}
const legacySpec = (id: string, overrides: unknown[] = []) => ({
  id,
  kind: "site_plan",
  paper: "A3",
  orientation: "landscape",
  scale: "auto",
  annotation_overrides: overrides,
  include_in_proposal: true,
});
const v1 = (specs: unknown[]) => JSON.stringify({ engine_version: "1.0.0", specs });

test("저장 키는 v2, v1은 읽기만 한다(키 이름)", () => {
  assert.equal(storeKey("p1"), "arch.sheets.v2.p1");
  assert.equal(legacyStoreKey("p1"), "arch.sheets.v1.p1");
});

test("v1 저장본을 v2 모양으로 1:1 이행하고 v1은 쓰기·삭제하지 않는다", () => {
  const st = memStorage({
    [legacyStoreKey("p")]: v1([
      legacySpec("a", [
        { target: "dim:1", dx_mm: 1.5, dy_mm: -2, text: "메모", hidden: false },
        { target: "note:7", dx_mm: 5, dy_mm: 6, text: "노트" },
      ]),
      legacySpec("b"),
    ]),
  });
  const before = st.data.get(legacyStoreKey("p"));
  const out = readStoredSheets(st, "p");
  assert.equal(out.engine_version, "1.0.0");
  assert.deepEqual(out.specs.map((s) => s.id), ["a", "b"]);
  assert.deepEqual(out.specs[0]?.annotations, [
    { id: "note-7", kind: "text", dx_mm: 5, dy_mm: 6, text: "노트" },
    { id: "ov-dim:1", kind: "override", target: "dim:1", dx_mm: 1.5, dy_mm: -2, text: "메모", hidden: false },
  ]);
  assert.equal("annotations" in (out.specs[1] ?? {}), false);
  assert.deepEqual(st.writes, []);
  assert.equal(st.data.get(legacyStoreKey("p")), before);
  assert.equal(st.data.has(storeKey("p")), false);
});

test("이행은 시트 단위 실패 격리: 깨진 시트·중복 id만 건너뛰고 나머지는 유지", () => {
  const raw = v1([
    legacySpec("a"),
    { ...legacySpec("bad"), paper: "A0" },
    legacySpec("a"),
    legacySpec("c", [{ target: "x", text: "가".repeat(201) }]),
    legacySpec("d"),
  ]);
  const out = parseStoredLegacy(raw);
  assert.deepEqual(out.specs.map((s) => s.id), ["a", "d"]);
  assert.equal(out.engine_version, "1.0.0");
  assert.deepEqual(parseStoredLegacy("{").specs, []);
  assert.deepEqual(parseStoredLegacy(JSON.stringify({ engine_version: "1", specs: "x" })).specs, []);
  assert.deepEqual(parseStoredLegacy(JSON.stringify({ engine_version: "1", specs: [], extra: 1 })).specs, []);
});

test("v2가 있으면 v2만 읽는다(깨졌으면 빈 목록, v1로 되돌아가지 않는다). 새 시트는 annotations 키 없이 저장", () => {
  const spec = newSpec("site_plan", [], house, "A3");
  assert.equal("annotations" in spec, false);
  const good = serializeStored({ engine_version: "1", specs: [{ ...spec, annotations: [] }] });
  assert.equal(good.includes("annotations"), false, "빈 배열은 저장하지 않는다");
  const st = memStorage({ [storeKey("p")]: good, [legacyStoreKey("p")]: v1([legacySpec("old")]) });
  assert.deepEqual(readStoredSheets(st, "p").specs.map((s) => s.id), [spec.id]);
  const broken = memStorage({ [storeKey("p")]: "{", [legacyStoreKey("p")]: v1([legacySpec("old")]) });
  assert.deepEqual(readStoredSheets(broken, "p").specs, []);
  assert.deepEqual(readStoredSheets(null, "p").specs, []);
  assert.deepEqual(
    readStoredSheets(
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      "p",
    ).specs,
    [],
  );
});

test("v2 저장본에 옛 annotation_overrides 가 섞이면 통째로 거부(이행은 v1 읽기 경로에서만)", () => {
  assert.deepEqual(parseStored(v1([legacySpec("a")])).specs, []);
});
