// DXF 작성기 골든 케이스(AR-06-021). 뷰 생성기(023~026)가 아직 없어 SheetModel을 buildSheet + 직접 만든 ViewModel로 구성한다.
// 케이스 정의만 바꾸고 골든을 다시 만들려면 DXF_WRITER_VERSION을 올린 뒤 golden:update(update.ts가 강제).
import type { DesignModelV1, SheetAnnotation } from "@arch-studio/domain";
import { buildSheet, label, validateDraftingInput, type DraftingInput, type Prim, type SheetModel, type ViewModel } from "../../src/index.ts";
import { sampleInput, sampleModel, sampleView } from "../../src/sheet/test-fixtures.ts";
import type { DxfOptions } from "../../src/writers/dxf/index.ts";

export interface GoldenCase {
  id: string;
  note: string;
  build(): { sheet: SheetModel; options: DxfOptions };
}

type InputOver = Partial<Omit<DraftingInput, "sheet" | "profile" | "license">> & {
  sheet?: Partial<DraftingInput["sheet"]>;
  profile?: Partial<DraftingInput["profile"]>;
  license?: DraftingInput["license"];
};

function sheetOf(model: DesignModelV1, over: InputOver, view: (m: DesignModelV1) => ViewModel = sampleView): SheetModel {
  const base = sampleInput(model);
  const raw: DraftingInput = {
    ...base,
    ...over,
    sheet: { ...base.sheet, ...over.sheet },
    profile: { ...base.profile, ...over.profile },
    license: over.license ?? base.license,
  };
  const v = validateDraftingInput(raw);
  if (!v.ok) throw new Error(`${v.code}: ${v.issues.join("; ")}`);
  return buildSheet(v.input, view(v.input.model)).sheet;
}

/** 기본 뷰에 형상·용지 요소·블록을 덧붙인다. */
function withExtras(extra: { prims?: Prim<number>[]; paper?: Prim<number>[]; blocks?: ViewModel["blocks"]; views?: ViewModel["views"] }) {
  return (m: DesignModelV1): ViewModel => {
    const base = sampleView(m);
    const main = base.views[0] as ViewModel["views"][number];
    return {
      ...base,
      views: [{ view_id: main.view_id, prims: [...main.prims, ...(extra.prims ?? [])] }, ...(extra.views ?? [])],
      ...(extra.paper ? { paper_prims: extra.paper } : {}),
      ...(extra.blocks ? { blocks: extra.blocks } : {}),
    };
  };
}

const USER_ANNOTATIONS: SheetAnnotation[] = [
  { id: "text-1", kind: "text", anchor: { ref: "site", part: "center" }, dx_mm: 5, dy_mm: 5, text: "대지 메모" },
  { id: "note-1", kind: "text", dx_mm: 20, dy_mm: 20, text: "일반 메모\n두 줄" },
  { id: "dim-1", kind: "dim", a: { ref: "m000", part: "vertex", index: 0 }, b: { ref: "m000", part: "vertex", index: 1 }, offset_mm: -5, text: "폭 {값}" },
  { id: "leader-1", kind: "leader", anchors: [{ ref: "m000", part: "vertex", index: 2 }], dx_mm: 10, dy_mm: 8, text: "철거" },
  { id: "cloud-1", kind: "cloud", anchors: [0, 1, 2, 3].map((index) => ({ ref: "m000", part: "vertex" as const, index })), text: "검토" },
  { id: "ov-label:room:r000", kind: "override", target: "label:room:r000", dx_mm: 2, dy_mm: -1 },
];
const ORPHAN_ANNOTATIONS: SheetAnnotation[] = [
  { id: "a-ok", kind: "text", anchor: { ref: "site", part: "center" }, dx_mm: 1, dy_mm: 1, text: "정상" },
  { id: "b-no-ref", kind: "text", anchor: { ref: "m999", part: "center" }, dx_mm: 1, dy_mm: 1, text: "ref 없음" },
  { id: "c-range", kind: "dim", a: { ref: "m000", part: "vertex", index: 0 }, b: { ref: "m000", part: "vertex", index: 9 }, offset_mm: 3 },
  { id: "d-multi", kind: "leader", anchors: [{ ref: "m000", part: "vertex", index: 0 }, { ref: "m999", part: "vertex", index: 0 }], dx_mm: 2, dy_mm: 2, text: "하나만 고아" },
];

const LONG_OFFICE = "가나다라마바사아자차카타파하 종합건축사사무소 부설 도시건축연구소";
const LONG_PROJECT = "서울특별시 종로구 세종대로 일원 근린생활시설 및 다세대주택 신축 기획설계 검토";

const DOOR = "DOOR-900";
const WIN = "WIN-1200";
const blocks: NonNullable<ViewModel["blocks"]> = [
  {
    name: DOOR,
    entities: [
      { layer: "A-DOOR", key: "leaf", t: "line", a: [0, 0], b: [0, 900] },
      { layer: "A-DOOR", key: "swing", t: "arc", c: [0, 0], r: 900, a0: 0, a1: 90 },
    ],
  },
  {
    name: WIN,
    entities: [
      { layer: "A-GLAZ", key: "frame", t: "pline", closed: true, pts: [[0, 0], [1200, 0], [1200, 150], [0, 150]] },
      { layer: "A-GLAZ", key: "glass", t: "line", a: [0, 75], b: [1200, 75] },
    ],
  },
];

const ok = (sheet: SheetModel, options: DxfOptions = {}) => ({ sheet, options });

export const CASES: GoldenCase[] = [
  { id: "writer-site-a3-basic", note: "배치도 A3 가로 자동 축척, 대지·매스·실·치수·라벨", build: () => ok(sheetOf(sampleModel(), {})) },
  {
    id: "writer-site-a3-watermark",
    note: "체험판 표제란(drafting_watermark)",
    build: () => ok(sheetOf(sampleModel(), { license: { drafting_watermark: true } })),
  },
  {
    id: "writer-site-a3-fallback",
    note: "폴백 표제란 \"이후 개정 3건\"",
    build: () => ok(sheetOf(sampleModel(), { license: { drafting_watermark: false, fallback_revisions: 3 } })),
  },
  {
    id: "writer-site-a3-watermark-fallback",
    note: "체험판 + 폴백 동시",
    build: () => ok(sheetOf(sampleModel(), { license: { drafting_watermark: true, fallback_revisions: 12 } })),
  },
  {
    id: "writer-area-a2-landscape",
    note: "면적 산정도 A2 가로, 실 6개",
    build: () => ok(sheetOf(sampleModel({ w: 30_000, h: 22_000, rooms: 6 }), { sheet: { kind: "area_plan", paper: "A2" } })),
  },
  {
    id: "writer-floor-a1-portrait",
    note: "평면 개략도 A1 세로, 실 12개",
    build: () =>
      ok(sheetOf(sampleModel({ w: 24_000, h: 36_000, rooms: 12 }), { sheet: { kind: "floor_plan", paper: "A1", orientation: "portrait", floor_id: "m000-f1" } })),
  },
  {
    id: "writer-elevation-a3-portrait",
    note: "입면 개략도 A3 세로",
    build: () => ok(sheetOf(sampleModel({ w: 12_000, h: 18_000 }), { sheet: { kind: "elevation", orientation: "portrait" } })),
  },
  {
    id: "writer-sunlight-a3",
    note: "일조사선 단면 개략도 A3",
    build: () => ok(sheetOf(sampleModel({ w: 16_000, h: 9_000 }), { sheet: { kind: "sunlight_section" } })),
  },
  {
    id: "writer-scale-600-large-site",
    note: "1/600 큰 대지(자동 축척 최대)",
    build: () => ok(sheetOf(sampleModel({ w: 140_000, h: 90_000, masses: 4, rooms: 4 }), {})),
  },
  {
    id: "writer-ar058-overflow",
    note: "AR058: 1/600으로도 A3에 안 맞음(경고만, 작성은 한다)",
    build: () => ok(sheetOf(sampleModel({ w: 400_000, h: 300_000 }), {})),
  },
  {
    id: "writer-fixed-scale-100",
    note: "고정 축척 1/100, 문자 높이 3.5mm",
    build: () => ok(sheetOf(sampleModel({ w: 18_000, h: 12_000 }), { sheet: { scale: 100 }, profile: { default_text_height_mm: 3.5 } })),
  },
  {
    id: "writer-korean-long-names",
    note: "한글 긴 사무소·프로젝트·실명, 특수문자 ㎡ × ° % 와 제어 문자",
    build: () => {
      const m = sampleModel({ rooms: 4 });
      const names = ["가족실 겸 거실 및 주방 식당 통합 공간", "안방(부부 침실)·드레스룸", "자녀방 1 × 2 — 남향 ㎡", "다용도실\t세탁 50%"];
      m.floor_layouts[0]?.rooms.forEach((r, i) => (r.name = names[i] as string));
      return ok(sheetOf(m, { project_name: LONG_PROJECT, profile: { office_name: LONG_OFFICE } }));
    },
  },
  {
    id: "writer-layer-map-rename",
    note: "layer_map: 한글 사무소 레이어 이름으로 바꿈",
    build: () => ok(sheetOf(sampleModel(), {}), { layer_map: { "A-SITE-BNDY": "대지경계", "A-MASS": "건물외곽", "A-ANNO-DIMS": "치수", "A-TTLB": "도곽" } }),
  },
  {
    id: "writer-layer-map-merge-invalid",
    note: "layer_map: 두 레이어 합침(앞 레이어 색), 금지 문자·빈 이름은 표준 유지, 표준 밖 키 무시",
    build: () =>
      ok(sheetOf(sampleModel(), {}), {
        layer_map: { "A-MASS": "BLDG", "A-WALL": "BLDG", "A-AREA": "a/b", "A-AREA-IDEN": " ", "X-UNKNOWN": "무시" },
      }),
  },
  {
    id: "writer-layer-map-control-chars",
    note: "layer_map: 제어 문자(줄바꿈·탭·NUL) 이름은 표준 유지, 대소문자만 다른 이름·\"0\"은 충돌 경고 후 표준 이름",
    build: () =>
      ok(sheetOf(sampleModel(), {}), {
        layer_map: { "A-SITE-BNDY": "대지\r\n  0\r\nEOF", "A-ANNO-DIMS": "치수\t", "A-TTLB": "도곽\u0000", "A-MASS": "Bldg", "A-AREA": "BLDG", "A-AREA-IDEN": "0" },
      }),
  },
  {
    id: "writer-arcs-circles",
    note: "ARC(소수 각도)·CIRCLE",
    build: () =>
      ok(
        sheetOf(
          sampleModel(),
          {},
          withExtras({
            prims: [
              { layer: "A-ENVL", key: "arc:a", t: "arc", c: [10_000, 7_500], r: 3_000, a0: 33.3333333, a1: 210.5 },
              { layer: "A-ENVL", key: "arc:b", t: "arc", c: [5_000, 5_000], r: 1_500, a0: 300, a1: 45 },
              { layer: "A-SITE-SETB", key: "circle:a", t: "circle", c: [15_000, 10_000], r: 750 },
            ],
          }),
        ),
      ),
  },
  {
    id: "writer-hatch-solid-holes",
    note: "HATCH SOLID 바깥 경계 + 구멍 2개",
    build: () =>
      ok(
        sheetOf(
          sampleModel(),
          {},
          withExtras({
            prims: [
              {
                layer: "A-AREA",
                key: "hatch:solid",
                t: "hatch",
                pattern: "SOLID",
                loops: [
                  [[2_000, 2_000], [12_000, 2_000], [12_000, 9_000], [2_000, 9_000]],
                  [[3_000, 3_000], [5_000, 3_000], [5_000, 5_000], [3_000, 5_000]],
                  [[8_000, 6_000], [10_000, 6_000], [9_000, 8_000]],
                ],
              },
            ],
          }),
        ),
      ),
  },
  {
    id: "writer-hatch-ansi31",
    note: "HATCH ANSI31(패턴 배율 = 축척 분모)",
    build: () =>
      ok(
        sheetOf(
          sampleModel(),
          {},
          withExtras({
            prims: [{ layer: "A-AREA", key: "hatch:ansi", t: "hatch", pattern: "ANSI31", loops: [[[1_000, 1_000], [9_000, 1_000], [9_000, 6_000], [1_000, 6_000]]] }],
          }),
        ),
      ),
  },
  {
    id: "writer-blocks-inserts",
    note: "BLOCK DOOR-900·WIN-1200, INSERT 회전 0·90·180·270",
    build: () =>
      ok(
        sheetOf(
          sampleModel(),
          {},
          withExtras({
            blocks,
            prims: [
              { layer: "A-DOOR", key: "door:1", t: "insert", block: DOOR, at: [3_000, 2_000], rot_deg: 0 },
              { layer: "A-DOOR", key: "door:2", t: "insert", block: DOOR, at: [6_000, 2_000], rot_deg: 90 },
              { layer: "A-DOOR", key: "door:3", t: "insert", block: DOOR, at: [9_000, 2_000], rot_deg: 180 },
              { layer: "A-GLAZ", key: "win:1", t: "insert", block: WIN, at: [4_000, 12_000], rot_deg: 270 },
            ],
          }),
        ),
      ),
  },
  {
    id: "writer-mtext-escapes",
    note: "MTEXT 메모: 줄바꿈·\\ { } 이스케이프·제어 문자, 250자 넘는 문자열 분할",
    build: () =>
      ok(
        sheetOf(
          sampleModel(),
          {},
          withExtras({
            paper: [
              {
                layer: "A-ANNO-TEXT",
                key: "note:mtext",
                t: "mtext",
                at: [3_000, 27_000],
                h: 250,
                width: 12_000,
                s: "메모 {중괄호} 와 역슬래시 \\P 그대로\n둘째 줄\u0007벨\r\n셋째 줄 " + "가나다라마바사아자차카타파하 ".repeat(25) + "\\끝",
              },
            ],
          }),
        ),
      ),
  },
  {
    id: "writer-multi-view",
    note: "뷰 2개(main + detail), 뷰 순서 정렬",
    build: () =>
      ok(
        sheetOf(
          sampleModel(),
          {},
          withExtras({
            views: [
              {
                view_id: "detail",
                prims: [
                  { layer: "A-WALL", key: "wall:a", t: "line", a: [0, 0], b: [4_000, 0] },
                  { layer: "A-WALL", key: "wall:b", t: "line", a: [4_000, 0], b: [4_000, 3_000] },
                ],
              },
            ],
          }),
        ),
      ),
  },
  {
    id: "writer-text-align",
    note: "TEXT 정렬 l·c·r(용지·뷰), 값 TEXT source_ref",
    build: () =>
      ok(
        sheetOf(sampleModel(), {}, (m) => {
          const base = withExtras({
            prims: [
              { layer: "A-ANNO-TEXT", key: "t:c", t: "text", at: [10_000, 14_000], h: 300, s: "가운데 정렬", align: "c" },
              { layer: "A-ANNO-TEXT", key: "t:r", t: "text", at: [19_000, 14_000], h: 300, s: "오른쪽 정렬", align: "r" },
            ],
            paper: [{ layer: "A-ANNO-TEXT", key: "paper:c", t: "text", at: [21_000, 25_000], h: 400, s: "용지 가운데 제목", align: "c" }],
          })(m);
          const annotate = base.annotate;
          return {
            ...base,
            annotate: (ctx) => [
              ...(annotate ? annotate(ctx) : []),
              label({ anno_id: "label:paper:far", kind: "warning", at: [30_000, 6_000], align: "r", lines: [{ s: "검토 필요" }, { kind: "value", s: "1,200mm", source_ref: "judgment.setback" }] }, ctx),
            ],
          };
        }),
      ),
  },
  {
    id: "writer-many-masses",
    note: "매스 9·실 20",
    build: () => ok(sheetOf(sampleModel({ w: 40_000, h: 30_000, masses: 9, rooms: 20 }), {})),
  },
  {
    id: "writer-negative-coords",
    note: "음수 모델 좌표(대지가 원점 왼쪽 아래)",
    build: () => {
      const m = sampleModel();
      const shift = (pts: [number, number][]) => pts.forEach((p) => ((p[0] -= 50_000), (p[1] -= 30_000)));
      shift(m.site.boundary.outer as [number, number][]);
      m.masses.forEach((x) => shift(x.footprint.outer as [number, number][]));
      m.floor_layouts.forEach((l) => l.rooms.forEach((r) => shift(r.polygon.outer as [number, number][])));
      return ok(sheetOf(m, {}));
    },
  },
  {
    id: "writer-user-annotations",
    note: "사람 주석(AR-06-086): dim·text·메모·leader·cloud·override가 A-ANNO-USER 레이어에 id 순으로(DXF 표에 레이어가 추가됨)",
    build: () => ok(sheetOf(sampleModel(), { sheet: { annotations: USER_ANNOTATIONS } }), {}),
  },
  {
    id: "writer-user-annotations-orphan",
    note: "고아 주석(없는 ref·범위 밖 index·다중 앵커 중 하나 고아)은 출력에서 빠지고 정상 주석 하나만 남는다",
    build: () => ok(sheetOf(sampleModel(), { sheet: { annotations: ORPHAN_ANNOTATIONS } }), {}),
  },
  {
    id: "writer-font-timestamps",
    note: "글꼴 옵션(파일·패밀리)과 시각 주입($TDCREATE·$TDUPDATE, 골든 비교에서 가림)",
    build: () =>
      ok(sheetOf(sampleModel(), {}), {
        font: { file: "NanumGothic.ttf", family: "NanumGothic" },
        timestamps: { created: 2461342.25, updated: 2461343.5 },
      }),
  },
];
