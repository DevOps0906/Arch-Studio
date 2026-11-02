// sheet/{fit,validate,assemble} + 결정성 속성 테스트(AR-06-020).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 sha256 기준값 비교에만 쓴다
import { createHash } from "node:crypto";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import {
  buildSheet,
  canonicalJson,
  DraftingError,
  fitSheet,
  cosSinDeg,
  viewBounds,
  sha256Hex,
  usableRect,
  validateDraftingInput,
  type FitInput,
} from "../index.ts";
import { sampleInput, sampleModel, sampleView } from "./test-fixtures.ts";

const A3: Omit<FitInput, "bounds" | "scale"> = { paper: "A3", orientation: "landscape", kind: "site_plan" };
const box = (w: number, h: number) => ({ min: [0, 0] as [number, number], max: [w, h] as [number, number] });

test("fit: A3 가로 배치도 1/100 경계(사용 가능 305×237mm − 주석 띠 30mm)", () => {
  const u = usableRect("A3", "landscape", "site_plan");
  assert.deepEqual([u.x1 - u.x0, u.y1 - u.y0], [30_500, 23_700]);
  assert.equal(fitSheet({ ...A3, bounds: box(27_500, 20_700), scale: "auto" }).scale, 100);
  assert.equal(fitSheet({ ...A3, bounds: box(27_501, 100), scale: "auto" }).scale, 200);
  assert.equal(fitSheet({ ...A3, bounds: box(100, 20_701), scale: "auto" }).scale, 200);
  assert.equal(fitSheet({ ...A3, bounds: null, scale: "auto" }).scale, 100);
});

test("fit: 용지에 맞는 가장 큰 축척(속성, 구현과 독립된 기대식)", () => {
  // A3 가로 배치도: 용지 420×297 − 여백(왼 25, 나머지 10) − 표제란 40 − 요약표 80 = 가용 305×237mm.
  // 모델 범위 w/분모 + 주석 띠 30mm ≤ 가용 → w ≤ 275×분모, h ≤ 207×분모. 후보에서 분모가 가장 작은 것.
  const candidates = [100, 200, 300, 500, 600] as const;
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 400_000 }), fc.integer({ min: 0, max: 400_000 }), (w, h) => {
      const r = fitSheet({ ...A3, bounds: box(w, h), scale: "auto" });
      const expected = candidates.find((d) => w / d <= 305 - 30 && h / d <= 237 - 30);
      if (expected === undefined) {
        assert.equal(r.scale, 600);
        assert.equal(r.fits, false);
        assert.equal(r.warning?.code, "AR058");
      } else {
        assert.equal(r.scale, expected);
        assert.equal(r.fits, true);
        assert.equal(r.warning, undefined);
      }
    }),
    { numRuns: 1000 },
  );
});

test("fit 경계: ARC는 시작·끝점 + 지나는 사분면 극점, INSERT는 블록을 회전·이동해 포함", () => {
  const arc = (a0: number, a1: number) =>
    viewBounds([{ view_id: "v", prims: [{ layer: "A-DOOR", key: "a", t: "arc", c: [0, 0], r: 20_000, a0, a1 }] }]);
  assert.deepEqual(arc(0, 90), { min: [0, 0], max: [20_000, 20_000] });
  assert.deepEqual(arc(90, 0), { min: [-20_000, -20_000], max: [20_000, 20_000] }); // 270° 호: 90→180→270→0
  assert.deepEqual(arc(45, 135), { min: [-14_142, 14_142], max: [14_142, 20_000] }); // 20000×√2/2 = 14142.1
  assert.deepEqual(arc(-30, 30), { min: [17_321, -10_000], max: [20_000, 10_000] });
  const [c60, s60] = cosSinDeg(60);
  assert.ok(Math.abs(c60 - 0.5) < 1e-15 && Math.abs(s60 - Math.sqrt(3) / 2) < 1e-15);
  assert.deepEqual(cosSinDeg(-90), [0, -1]);

  const blocks = [{ name: "DOOR", entities: [{ layer: "A-DOOR" as const, key: "l", t: "line" as const, a: [0, 0] as [number, number], b: [900, 100] as [number, number] }] }];
  const ins = (rot: 0 | 90 | 180 | 270) => [{ view_id: "v", prims: [{ layer: "A-DOOR" as const, key: "i", t: "insert" as const, block: "DOOR", at: [1_000, 2_000] as [number, number], rot_deg: rot }] }];
  assert.deepEqual(viewBounds(ins(0), blocks), { min: [1_000, 2_000], max: [1_900, 2_100] });
  assert.deepEqual(viewBounds(ins(90), blocks), { min: [900, 2_000], max: [1_000, 2_900] });
  assert.deepEqual(viewBounds(ins(270), blocks), { min: [1_000, 1_100], max: [1_100, 2_000] });
  assert.throws(() => viewBounds(ins(0), []), (e) => e instanceof DraftingError && /없는 블록/.test(e.message));
  assert.throws(() => viewBounds(ins(45 as 0), blocks), (e) => e instanceof DraftingError && /90° 배수/.test(e.message));
});

test("fit: 안 맞으면 AR058, 고정 축척은 조용히 바꾸지 않는다", () => {
  const big = box(300_000, 200_000);
  const auto = fitSheet({ ...A3, bounds: big, scale: "auto" });
  assert.equal(auto.scale, 600);
  assert.equal(auto.warning?.code, "AR058");
  assert.match(auto.warning?.detail ?? "", /A2·A1/);

  const fixed = fitSheet({ ...A3, bounds: box(40_000, 10_000), scale: 100 });
  assert.equal(fixed.scale, 100, "고정 1/100이 맞지 않아도 1/200으로 바꾸지 않는다");
  assert.equal(fixed.fits, false);
  assert.equal(fixed.warning?.code, "AR058");
  assert.equal(fitSheet({ ...A3, bounds: box(40_000, 10_000), scale: 200 }).warning, undefined);

  // 시트 조립까지 같은 축척 + AR058 경고가 남는다.
  const model = sampleModel({ w: 60_000, h: 40_000 });
  const input = sampleInput(model);
  input.sheet.scale = 100;
  const { sheet } = buildSheet(input, sampleView(model));
  assert.equal(sheet.scale, 100);
  assert.deepEqual(sheet.warnings.map((w) => w.code), ["AR058"]);
});

test("fit: 뷰 중앙이 사용 가능 영역 중앙(0.01mm 내림)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.integer({ min: 0, max: 50_000 }),
      fc.integer({ min: 0, max: 50_000 }),
      (x, y, w, h) => {
        const r = fitSheet({ ...A3, bounds: { min: [x, y], max: [x + w, y + h] }, scale: "auto" });
        const u = r.usable;
        // 용지 위치 = origin + 모델 × 100 / scale. 중앙 차이는 [0, 1) 0.01mm.
        const cx = r.origin[0] + ((2 * x + w) * 100) / (2 * r.scale);
        const cy = r.origin[1] + ((2 * y + h) * 100) / (2 * r.scale);
        const ex = (u.x0 + u.x1) / 2 - cx;
        const ey = (u.y0 + u.y1) / 2 - cy;
        assert.ok(ex >= -1e-9 && ex < 1, `x ${ex}`);
        assert.ok(ey >= -1e-9 && ey < 1, `y ${ey}`);
        assert.ok(Number.isSafeInteger(r.origin[0]) && Number.isSafeInteger(r.origin[1]));
      },
    ),
    { numRuns: 300 },
  );
});

test("validate: 정상 입력 통과, 깨진 입력 AR050, 저장 엔진 버전이 다르면 AR059", () => {
  const ok = validateDraftingInput(sampleInput());
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.notices, []);

  const notice = validateDraftingInput(sampleInput(), { saved_engine_version: "-0.1" });
  assert.equal(notice.ok && notice.notices[0]?.code, "AR059");

  const model = sampleModel();
  model.site.boundary = { outer: [[0, 0], [10, 10], [10, 0], [0, 10]] }; // 나비꼴(면적 0)
  model.masses = [];
  const input = sampleInput(model) as unknown as Record<string, unknown>;
  input.date = "2026/10/29";
  (input.judgment as { items: unknown[] }).items = [];
  const bad = validateDraftingInput(input);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.code, "AR050");
    const all = bad.issues.join("\n");
    for (const re of [/site\.boundary: [A-Z_]+/, /층이 없습니다/, /date/, /판정이 끝나지/]) assert.match(all, re);
  }
  const strict = validateDraftingInput({ ...sampleInput(), profile: { ...sampleInput().profile, disclaimer: "x" } });
  assert.equal(strict.ok, false, "DraftingProfile에 모르는 칸(고지 등)은 거부");
  const tiny = sampleInput();
  tiny.profile.default_text_height_mm = 0.001;
  const tinyR = validateDraftingInput(tiny);
  assert.ok(!tinyR.ok && tinyR.issues.some((i) => i.startsWith("profile.default_text_height_mm")));
  const fp = sampleInput();
  fp.sheet.kind = "floor_plan";
  const noFloor = validateDraftingInput(fp);
  assert.equal(noFloor.ok, false);
});

test("assemble: 정렬(레이어 표 → 종류 → key)·key 중복·정수 좌표 검사", () => {
  const model = sampleModel();
  const view = sampleView(model);
  const { sheet } = buildSheet(sampleInput(model), view);
  const layers = sheet.views[0]?.prims.map((p) => p.layer);
  assert.deepEqual(layers, ["A-SITE-BNDY", "A-MASS", "A-AREA"]);
  assert.equal(sheet.views[0]?.origin.length, 2);
  assert.match(sheet.input_hash, /^[0-9a-f]{64}$/);

  const dup = sampleView(model);
  dup.views[0]?.prims.push({ layer: "A-PARK", key: "site", t: "line", a: [0, 0], b: [1, 1] });
  assert.throws(() => buildSheet(sampleInput(model), dup), (e) => e instanceof DraftingError && e.code === "DUPLICATE_KEY");

  const frac = sampleView(model);
  frac.views[0]?.prims.push({ layer: "A-PARK", key: "p", t: "line", a: [0, 0.5], b: [1, 1] });
  assert.throws(() => buildSheet(sampleInput(model), frac), (e) => e instanceof DraftingError && e.code === "INVALID_ARGUMENT");
});

test("결정성: 같은 입력 같은 출력, 형상 입력 순서와 무관(속성)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 5_000, max: 200_000 }),
      fc.integer({ min: 5_000, max: 150_000 }),
      fc.integer({ min: 1, max: 6 }),
      fc.integer({ min: 1, max: 12 }),
      fc.boolean(),
      fc.option(fc.integer({ min: 0, max: 9 }), { nil: undefined }),
      fc.array(fc.record({ i: fc.nat(20), dx: fc.double({ min: -50, max: 50, noNaN: true }), hide: fc.boolean() }), { maxLength: 5 }),
      fc.integer({ min: 0, max: 1_000 }),
      (w, h, masses, rooms, watermark, fallback, ovs, seed) => {
        const model = sampleModel({ w, h, masses, rooms });
        const input = sampleInput(model, {
          license: fallback === undefined ? { drafting_watermark: watermark } : { drafting_watermark: watermark, fallback_revisions: fallback },
        });
        const targets = new Map<string, { dx: number; hide: boolean }>();
        for (const o of ovs) {
          const t = o.i % 2 ? `dim:setback:edge0:mass-m${String(o.i % masses).padStart(3, "0")}` : `label:room:r${String(o.i).padStart(3, "0")}`;
          targets.set(t, { dx: o.dx, hide: o.hide });
        }
        input.sheet.annotations = [...targets].map(([target, o]) => ({ id: `ov-${target}`, kind: "override" as const, target, dx_mm: o.dx, hidden: o.hide }));
        const a = buildSheet(input, sampleView(model));
        const b = buildSheet(structuredClone(input), sampleView(structuredClone(model)));
        assert.equal(canonicalJson(a), canonicalJson(b));
        // 뷰 형상·주석 배열 순서를 섞어도 같은 시트.
        const shuffled = sampleView(model);
        const prims = shuffled.views[0]?.prims ?? [];
        const rot = seed % Math.max(1, prims.length);
        shuffled.views[0] = { view_id: "main", prims: [...prims.slice(rot), ...prims.slice(0, rot)].reverse() };
        const inner = shuffled.annotate;
        shuffled.annotate = (ctx) => (inner ? inner(ctx).reverse() : []);
        assert.equal(canonicalJson(buildSheet(input, shuffled)), canonicalJson(a));
      },
    ),
    { numRuns: 60 },
  );
});

test("hash: sha256 기준값(node:crypto)과 같고 정규화 JSON은 키 순서와 무관", () => {
  for (const s of ["", "abc", "가나다 ㎡ 😀", "x".repeat(1000), "\ud800 짝 없는 서로게이트"]) {
    assert.equal(sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"), s.slice(0, 10));
  }
  assert.equal(canonicalJson({ b: 1, a: [1, -0, { d: undefined, c: "x" }] }), '{"a":[1,0,{"c":"x"}],"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});
