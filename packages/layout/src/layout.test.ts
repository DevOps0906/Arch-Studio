// layout(AR-06-026): 겹침·외곽 검사(AR051), 벽 두께, 문·창 위치, 경계 이동 후 면적·목표 차이.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import type { DesignModelV1, Polygon } from "@arch-studio/domain";
import { area2, union } from "@arch-studio/geometry";
import {
  checkRooms,
  createLayoutState,
  createLayoutStateFrom,
  floorOutline,
  floorPlanGeometry,
  LayoutError,
  moveBoundary,
  placeOpenings,
  prepareOutline,
  prepareRoom,
  roomsOverlap,
  validateLayout,
  wallPieces,
  wallSegments,
  type FloorLayout,
  type LayoutState,
  type PreparedRoom,
  type Room,
} from "./index.ts";

const rect = (x: number, y: number, w: number, h: number): Polygon => ({
  outer: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});
const room = (id: string, polygon: Polygon, name = id): Room => ({ id, name, use: "주거", polygon });
const prep = (r: Room) => prepareRoom(r) as PreparedRoom;
const outline = (...p: Polygon[]) => prepareOutline(union(p));
const kinds = (s: LayoutState) => s.issues.map((i) => `${i.kind}:${i.room_ids.join(",")}${i.opening_ids ? `/${i.opening_ids.join(",")}` : ""}`);

function model(rooms: Room[], openings: FloorLayout["openings"] = [], targets: DesignModelV1["program"]["targets"] = []): Pick<DesignModelV1, "masses" | "floor_layouts" | "program"> {
  return {
    masses: [{ id: "m1", footprint: rect(0, 0, 10_000, 6_000), base_level_mm: 0, floors: [{ id: "f1", level: 1, height_mm: 3_000, use: "주택" }], roof: { type: "flat" } }],
    floor_layouts: [{ floor_id: "f1", rooms, openings }],
    program: { checklist_answers: {}, targets, user_locked_rows: [] },
  };
}

// ---------------- 시드 고정 의사 난수(mulberry32) ----------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

test("층 외곽 = 같은 level 매스 외곽 합집합, 없는 층은 UNKNOWN_FLOOR", () => {
  const m = {
    masses: [
      { id: "a", footprint: rect(0, 0, 5_000, 5_000), base_level_mm: 0, floors: [{ id: "a1", level: 1, height_mm: 3_000, use: "x" }], roof: { type: "flat" as const } },
      { id: "b", footprint: rect(5_000, 0, 5_000, 5_000), base_level_mm: 0, floors: [{ id: "b1", level: 1, height_mm: 3_000, use: "x" }, { id: "b2", level: 2, height_mm: 3_000, use: "x" }], roof: { type: "flat" as const } },
    ],
  };
  const o = floorOutline(m, "a1");
  assert.equal(o.length, 1);
  assert.equal(area2(o[0] as Polygon), 2 * 50_000_000);
  assert.equal(area2((floorOutline(m, "b2")[0] as Polygon)), 2 * 25_000_000);
  assert.throws(() => floorOutline(m, "zz"), (e: unknown) => e instanceof LayoutError && e.code === "UNKNOWN_FLOOR");
});

test("겹침: 경계 접촉은 허용, 내부 겹침·포함·동일·L자 홈은 정확히 판정", () => {
  const a = prep(room("a", rect(0, 0, 4_000, 3_000)));
  assert.equal(roomsOverlap(a, prep(room("b", rect(4_000, 0, 3_000, 3_000)))), false, "변 공유");
  assert.equal(roomsOverlap(a, prep(room("b", rect(4_000, 3_000, 1_000, 1_000)))), false, "꼭짓점 접촉");
  assert.equal(roomsOverlap(a, prep(room("b", rect(3_999, 0, 3_000, 3_000)))), true, "1mm 겹침");
  assert.equal(roomsOverlap(a, prep(room("b", rect(0, 0, 4_000, 3_000)))), true, "동일(경계만 닿는 표본 → 합집합 면적)");
  assert.equal(roomsOverlap(a, prep(room("b", rect(1_000, 1_000, 1_000, 1_000)))), true, "포함");
  // L자 실의 홈에 정확히 맞는 사각형: 경계만 닿는다.
  const L = prep(room("L", { outer: [[0, 0], [6_000, 0], [6_000, 3_000], [3_000, 3_000], [3_000, 6_000], [0, 6_000]] }));
  assert.equal(roomsOverlap(L, prep(room("n", rect(3_000, 3_000, 3_000, 3_000)))), false);
  assert.equal(roomsOverlap(L, prep(room("n", rect(2_900, 3_000, 3_000, 3_000)))), true);
  // 대각선 변: 삼각형 두 개가 빗변을 공유.
  const t1 = prep(room("t1", { outer: [[0, 0], [3_000, 0], [0, 3_000]] }));
  const t2 = prep(room("t2", { outer: [[3_000, 0], [3_000, 3_000], [0, 3_000]] }));
  assert.equal(roomsOverlap(t1, t2), false);
  assert.equal(roomsOverlap(t1, prep(room("t3", { outer: [[2_999, 0], [3_000, 3_000], [0, 3_000]] }))), true);
});

test("외곽 이탈: 경계 위 변은 허용, 넘거나 두 매스에 걸치거나 중정을 덮으면 위반", () => {
  const o = outline(rect(0, 0, 10_000, 6_000));
  const check = (rs: Room[], oo = o) => checkRooms(rs, oo).issues.map((i) => `${i.kind}:${i.room_ids.join(",")}`);
  assert.deepEqual(check([room("a", rect(0, 0, 10_000, 6_000))]), []);
  assert.deepEqual(check([room("a", rect(5_000, 0, 5_001, 3_000))]), ["outside:a"]);
  assert.deepEqual(check([room("a", rect(-1, 0, 100, 100))]), ["outside:a"]);
  const two = outline(rect(0, 0, 4_000, 4_000), rect(6_000, 0, 4_000, 4_000));
  assert.deepEqual(check([room("a", rect(1_000, 1_000, 8_000, 2_000))], two), ["outside:a"]);
  assert.deepEqual(check([room("a", rect(6_000, 0, 4_000, 4_000))], two), []);
  // 중정(구멍) 외곽
  const court = prepareOutline([{ outer: [[0, 0], [9_000, 0], [9_000, 9_000], [0, 9_000]], holes: [[[3_000, 3_000], [3_000, 6_000], [6_000, 6_000], [6_000, 3_000]]] }]);
  assert.deepEqual(check([room("a", rect(1_000, 1_000, 7_000, 7_000))], court), ["outside:a"], "중정을 덮는 실");
  assert.deepEqual(check([room("a", rect(0, 0, 3_000, 9_000))], court), [], "중정 옆 실(경계 접촉)");
  assert.deepEqual(check([room("a", rect(3_000, 3_000, 3_000, 3_000))], court), ["outside:a"], "중정 안 실");
});

test("실 다각형 불량·id 중복은 invalid, 결과 순서는 고정", () => {
  const o = outline(rect(0, 0, 10_000, 6_000));
  const bow: Polygon = { outer: [[0, 0], [2_000, 2_000], [2_000, 0], [0, 2_000]] };
  const rc = checkRooms([room("b", rect(0, 0, 3_000, 3_000)), room("a", rect(2_000, 0, 3_000, 3_000)), room("x", bow), room("b", rect(5_000, 0, 1_000, 1_000))], o);
  assert.deepEqual(
    rc.issues.map((i) => `${i.kind}:${i.room_ids.join(",")}`),
    ["invalid:b", "invalid:x", "overlap:a,b"],
  );
  assert.ok(rc.issues.every((i) => i.code === "AR051"));
});

test("문·창: 변 위 위치·폭, 범위 밖·없는 실/변·같은 벽 겹침은 opening 위반", () => {
  // 시계 방향 고리(안쪽이 오른쪽) → 국소 x는 변 반대 방향.
  const cw: Polygon = { outer: [[0, 0], [0, 3_000], [4_000, 3_000], [4_000, 0]] };
  const rooms = [room("a", rect(0, 0, 4_000, 3_000)), room("b", rect(4_000, 0, 3_000, 3_000)), room("c", cw)];
  const ops: FloorLayout["openings"] = [
    { id: "d1", kind: "door", host: { room_id: "a", edge_index: 1 }, offset_mm: 1_000, width_mm: 900, swing: "right" },
    { id: "w1", kind: "window", host: { room_id: "a", edge_index: 0 }, offset_mm: 500, width_mm: 1_200 },
    { id: "d2", kind: "door", host: { room_id: "b", edge_index: 3 }, offset_mm: 1_000, width_mm: 900 }, // b의 왼쪽 변 = a의 오른쪽 변(위→아래)
    { id: "x1", kind: "window", host: { room_id: "a", edge_index: 2 }, offset_mm: 3_500, width_mm: 600 },
    { id: "x2", kind: "window", host: { room_id: "zz", edge_index: 0 }, offset_mm: 0, width_mm: 600 },
    { id: "x3", kind: "window", host: { room_id: "a", edge_index: 9 }, offset_mm: 0, width_mm: 600 },
    { id: "c1", kind: "window", host: { room_id: "c", edge_index: 0 }, offset_mm: 1_000, width_mm: 1_000 },
  ];
  const o = union([rect(0, 0, 7_000, 3_000)]);
  const pieces = wallPieces(rooms.map((r) => r.polygon), o);
  const { placements, issues } = placeOpenings({ rooms, openings: ops }, pieces, { exterior_mm: 200, interior_mm: 100 });
  assert.deepEqual(
    issues.map((i) => `${i.room_ids.join(",")}/${(i.opening_ids ?? []).join(",")}`),
    ["a/x1", "/x2", "a/x3", "a,b/d1,d2"],
  );
  assert.deepEqual(placements.map((p) => p.opening_id), ["c1", "w1"]);
  const w1 = placements.find((p) => p.opening_id === "w1");
  assert.deepEqual([w1?.a, w1?.b, w1?.origin, w1?.rot_deg, w1?.wall, w1?.thickness_mm], [[500, 0], [1_700, 0], [500, 0], 0, "exterior", 200]);
  const c1 = placements.find((p) => p.opening_id === "c1");
  // c의 0번 변 (0,0)→(0,3000), 안쪽은 +x(오른쪽) → 국소 x = -y 방향, 원점 = 개구부 끝(0,2000), 회전 270°.
  assert.deepEqual([c1?.a, c1?.b, c1?.origin, c1?.dir, c1?.rot_deg], [[0, 1_000], [0, 2_000], [0, 2_000], [0, -1], 270]);
});

test("벽: 외벽 = 외곽 경계, 공유 내벽은 1번, 띠 다각형은 개구부에서 끊긴다", () => {
  const rooms = [room("a", rect(0, 0, 4_000, 6_000)), room("b", rect(4_000, 0, 6_000, 6_000))];
  const segs = wallSegments(rooms.map((r) => r.polygon), union([rect(0, 0, 10_000, 6_000)]), { exterior_mm: 200, interior_mm: 100 });
  assert.equal(segs.filter((s) => s.kind === "exterior").length, 4);
  assert.deepEqual(
    segs.filter((s) => s.kind === "interior").map((s) => [s.a, s.b, s.thickness_mm]),
    [[[4_000, 0], [4_000, 6_000], 100]],
  );
  const g0 = floorPlanGeometry(model(rooms), "f1");
  assert.deepEqual(g0.issues, []);
  // 바깥 띠 1개 + 내벽이 안쪽을 둘로 나눔 → 외곽 1, 구멍 2.
  assert.equal(g0.wall_bands.length, 1);
  assert.equal(g0.wall_bands[0]?.holes?.length, 2);
  const A = (p: Polygon[]) => p.reduce((s, q) => s + area2(q), 0) / 2;
  // 외벽 띠 면적 = (10200×6200 − 9800×5800), 내벽 = 100 × 5800.
  assert.equal(A(g0.wall_bands), 10_200 * 6_200 - 9_800 * 5_800 + 100 * 5_800);
  const g1 = floorPlanGeometry(model(rooms, [{ id: "w", kind: "window", host: { room_id: "b", edge_index: 0 }, offset_mm: 1_000, width_mm: 2_000 }]), "f1");
  assert.equal(A(g1.wall_bands), A(g0.wall_bands) - 200 * 2_000, "창 자리만큼 외벽이 빠진다");
  assert.equal(g1.openings.length, 1);
  // 위반 모델은 벽·문창을 만들지 않는다.
  const bad = floorPlanGeometry(model([room("a", rect(0, 0, 4_000, 6_000)), room("b", rect(3_000, 0, 6_000, 6_000))]), "f1");
  assert.deepEqual([bad.issues.length, bad.walls.length, bad.wall_bands.length], [1, 0, 0]);
});

test("validate_layout 결과(04_API.md 4.7.5): 면적·목표 차이 ㎡, 이름으로 목표 대응", () => {
  const m = model([room("r1", rect(0, 0, 3_333, 3_000), "침실1"), room("r2", rect(3_333, 0, 6_667, 6_000), "거실")], [], [
    { name: "침실1", use: "주거", target_area_m2: 10.5 },
    { name: "침실1", use: "주거", target_area_m2: 99 },
  ]);
  const r = validateLayout(m, "f1");
  assert.deepEqual(r, {
    rooms: [
      { room_id: "r1", area_m2: 10, target_diff_m2: -0.5 },
      { room_id: "r2", area_m2: 40, target_diff_m2: null },
    ],
    errors: [],
  });
  const s = createLayoutState(m, "f1");
  assert.equal(s.rows[0]?.area_h100, 1_000); // 9,999,000mm² → 9.999㎡ → 10.00
});

test("경계 이동: 면적·목표 차이 갱신, 위반 발생·해소, 잘못된 인자는 LayoutError", () => {
  const m = model([room("a", rect(0, 0, 4_000, 6_000), "거실"), room("b", rect(4_000, 0, 6_000, 6_000), "침실")], [], [{ name: "거실", use: "주거", target_area_m2: 25 }]);
  const s0 = createLayoutState(m, "f1");
  assert.equal(s0.rows[0]?.diff_h100, 2_400 - 2_500);
  // a의 오른쪽 변(1번)을 +500 → b와 겹침.
  const s1 = moveBoundary(s0, { room_id: "a", edge_index: 1, dx_mm: 500, dy_mm: 0 });
  assert.equal(s1.rows[0]?.area_h100, 2_700);
  assert.equal(s1.rows[0]?.diff_h100, 200);
  assert.deepEqual(kinds(s1), ["overlap:a,b"]);
  // 공유 경계를 함께 옮기면(b의 3번 변) 해소.
  const s2 = moveBoundary(s1, { room_id: "b", edge_index: 3, dx_mm: 500, dy_mm: 0 });
  assert.deepEqual(kinds(s2), []);
  assert.equal(s2.rows[1]?.area_h100, 3_300);
  // 바깥으로 밀면 outside.
  assert.deepEqual(kinds(moveBoundary(s2, { room_id: "b", edge_index: 1, dx_mm: 1, dy_mm: 0 })), ["outside:b"]);
  assert.throws(() => moveBoundary(s0, { room_id: "zz", edge_index: 0, dx_mm: 1, dy_mm: 0 }), LayoutError);
  assert.throws(() => moveBoundary(s0, { room_id: "a", edge_index: 4, dx_mm: 1, dy_mm: 0 }), LayoutError);
  assert.throws(() => moveBoundary(s0, { room_id: "a", edge_index: 0, dx_mm: 0.5, dy_mm: 0 }), LayoutError);
  // 원래 상태는 바뀌지 않는다(불변).
  assert.equal(s0.rows[0]?.area_h100, 2_400);
  assert.equal(m.floor_layouts[0]?.rooms[0]?.polygon.outer[1]?.[0], 4_000);
});

// ---------------- 속성 테스트(시드 고정) ----------------

test("속성: 임의 사각형 배치 — 쌍 겹침 판정 = 교집합 넓이 > 0, 겹침 없음 ⇔ 합집합 면적 = 면적 합", () => {
  const r = rng(20261029);
  for (let run = 0; run < 300; run++) {
    const n = int(r, 2, 7);
    const rooms: Room[] = [];
    for (let i = 0; i < n; i++) {
      // 100mm 격자 위(경계 접촉이 자주 생기게) + 가끔 1mm 어긋남.
      const jitter = r() < 0.2 ? int(r, -1, 1) : 0;
      const x = int(r, 0, 60) * 100 + jitter;
      const y = int(r, 0, 40) * 100;
      rooms.push(room(`r${i}`, rect(x, y, int(r, 1, 40) * 100, int(r, 1, 20) * 100)));
    }
    const o = outline(rect(-1_000, -1_000, 12_000, 8_000));
    const rc = checkRooms(rooms, o);
    const overlapPairs = new Set(rc.issues.filter((i) => i.kind === "overlap").map((i) => i.room_ids.join(",")));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = (rooms[i] as Room).polygon.outer;
        const b = (rooms[j] as Room).polygon.outer;
        const ix = Math.min(a[2]![0], b[2]![0]) - Math.max(a[0]![0], b[0]![0]);
        const iy = Math.min(a[2]![1], b[2]![1]) - Math.max(a[0]![1], b[0]![1]);
        const expect = ix > 0 && iy > 0;
        const key = [`r${i}`, `r${j}`].sort().join(",");
        assert.equal(overlapPairs.has(key), expect, `run ${run} ${key}`);
      }
    }
    const sum = rooms.reduce((s, x) => s + area2(x.polygon), 0);
    const uni = union(rooms.map((x) => x.polygon)).reduce((s, p) => s + area2(p), 0);
    assert.equal(overlapPairs.size === 0, uni === sum, `run ${run}: 면적 합 불변식`);
  }
});

test("속성: 경계 이동 — 증분 갱신 = 전체 재검사, 면적·목표 차이가 정수로 정확", () => {
  const r = rng(7);
  for (let run = 0; run < 200; run++) {
    // 3×2 격자 실(3000×3000) + 무작위 목표.
    const rooms: Room[] = [];
    const targets: DesignModelV1["program"]["targets"] = [];
    for (let i = 0; i < 6; i++) {
      rooms.push(room(`r${i}`, rect((i % 3) * 3_000, Math.floor(i / 3) * 3_000, 3_000, 3_000), `실${i}`));
      if (r() < 0.7) targets.push({ name: `실${i}`, use: "주거", target_area_m2: int(r, 500, 1_500) / 100 + (r() < 0.3 ? 0.005 : 0) });
    }
    const o = union([rect(0, 0, 9_000, 6_000)]);
    let s = createLayoutStateFrom("f1", o, { rooms, openings: [] }, targets);
    for (let step = 0; step < 4; step++) {
      const id = `r${int(r, 0, 5)}`;
      const e = int(r, 0, 3);
      const d = int(r, -15, 15) * 100 + (r() < 0.3 ? int(r, -49, 49) : 0);
      const horiz = e === 1 || e === 3; // 0·2번 변은 수평 → y 방향으로, 1·3번은 x 방향으로 민다
      const before = s.rooms.find((x) => x.id === id) as Room;
      s = moveBoundary(s, { room_id: id, edge_index: e, dx_mm: horiz ? d : 0, dy_mm: horiz ? 0 : d });
      const full = createLayoutStateFrom("f1", o, { rooms: [...s.rooms], openings: [] }, targets);
      assert.deepEqual(s.issues, full.issues, `run ${run} step ${step}`);
      assert.deepEqual(s.rows, full.rows);
      // 면적 독립 기대식: 직사각형이 아닐 수 있어(뒤집힘 포함) 신발끈 bigint로 직접.
      const after = s.rooms.find((x) => x.id === id) as Room;
      const shoe = (p: Polygon) => {
        let a = 0n;
        const pts = p.outer;
        for (let k = 0; k < pts.length; k++) {
          const [x0, y0] = pts[k] as [number, number];
          const [x1, y1] = pts[(k + 1) % pts.length] as [number, number];
          a += BigInt(x0) * BigInt(y1) - BigInt(x1) * BigInt(y0);
        }
        return a < 0n ? -a : a;
      };
      const a2 = shoe(after.polygon);
      const expectH100 = Number((a2 + 10_000n) / 20_000n); // 양수 half-away
      const row = s.rows.find((x) => x.room_id === id);
      assert.equal(row?.area_h100, expectH100);
      assert.ok(Number.isSafeInteger(row?.area_h100));
      if (row?.target_h100 !== null && row?.target_h100 !== undefined) {
        assert.equal(row.diff_h100, expectH100 - row.target_h100);
        assert.ok(Number.isSafeInteger(row.diff_h100));
      }
      void before;
    }
  }
});

test("결정성: 실·문창 입력 순서와 무관하게 같은 issues", () => {
  const rooms = [room("c", rect(0, 0, 5_000, 3_000)), room("a", rect(4_000, 0, 6_000, 3_000)), room("b", rect(8_000, 2_000, 4_000, 3_000))];
  const s1 = createLayoutStateFrom("f", union([rect(0, 0, 10_000, 6_000)]), { rooms, openings: [] }, []);
  const s2 = createLayoutStateFrom("f", union([rect(0, 0, 10_000, 6_000)]), { rooms: [...rooms].reverse(), openings: [] }, []);
  assert.deepEqual(s1.issues, s2.issues);
  assert.deepEqual(kinds(s1), ["outside:b", "overlap:a,b", "overlap:a,c"]);
});
