// sunlight_section 뷰 생성기(AR-06-025, 02_ARCHITECTURE.md 2.3절 뷰 생성기 표).
// 정북 방향 단면: 가로 = 정북 방향 좌표 u(오른쪽이 정북), 세로 = 높이 z(mm). 매스 무게중심을 지나는 정북 단면이 기본이고
// SheetSpec.section_line이 있으면 그 선으로 자른다(가로는 그래도 정북 투영 거리 — 사선 기준이 정북 거리라서).
// 사선 함수(구간·거리·비율)는 rules 엔벨로프 출력의 applied_params를 그대로 읽는다: 이 파일에 법규 수치는 없다.
// 사선을 넘는 부분은 매스 단면 ∩ "정북 거리 < 기준" 영역으로, 사선 함수를 그 높이에서 평가해 자른 도형이다(새 기준 없음).
import { roundHalfAway } from "@arch-studio/geometry";
import { dimension, label } from "../../annotate/index.ts";
import { DraftingError } from "../../sheet/errors.ts";
import { usableRect } from "../../sheet/paper.ts";
import { cosSinDeg, type ViewModel } from "../../sheet/build.ts";
import type { Annotation, DraftingInput, Mm, PaperUm, Prim, Vec } from "../../sheet/types.ts";
import { textHeightUm } from "../../titleblock/index.ts";
import { clipHalfPlane, insideIntervals, lineCrossings, polygonMoments, type Pt } from "./section.ts";
import type { SunlightBandInput, SunlightEnvelopeInput, SunlightSectionOptions } from "./types.ts";

export type { SunlightBandInput, SunlightBasisInput, SunlightConstraintInput, SunlightEnvelopeInput, SunlightSectionOptions } from "./types.ts";

export const SUNLIGHT_VIEW_ID = "section";

const r = roundHalfAway;

/** 구간 안에서 정북 거리 d(z)가 직선인 조각: z∈[za,zb]에서 d0 → d1. */
interface Piece {
  za: number;
  zb: number;
  d0: number;
  d1: number;
}

function parseBands(v: unknown): SunlightBandInput[] | null {
  if (v === null || typeof v !== "object") return null;
  const bands = (v as { bands?: unknown }).bands;
  if (!Array.isArray(bands) || bands.length === 0) return null;
  const pos = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x > 0;
  for (const b of bands as Array<Record<string, unknown> | null>) {
    if (b === null || typeof b !== "object") return null;
    if (!(b.up_to_mm === null || pos(b.up_to_mm))) return null;
    if (b.min_distance_mm !== undefined && !pos(b.min_distance_mm)) return null;
    const dr = b.distance_ratio as { num?: unknown; den?: unknown } | undefined;
    if (dr !== undefined && !(pos(dr?.num) && pos(dr?.den))) return null;
    if (b.min_distance_mm === undefined && dr === undefined) return null;
  }
  return bands as SunlightBandInput[];
}

function roadEdgesOf(v: unknown): "exempt" | "apply" {
  const e = (v as { road_edges?: unknown } | null)?.road_edges;
  return e === "apply" ? "apply" : "exempt";
}

/** 구간표 → 직선 조각. 구간 안 d(z) = max(최소 거리, z × 비율): 교차 높이에서 둘로 나눈다. */
function piecesOf(bands: readonly SunlightBandInput[], top: number): Piece[] {
  const out: Piece[] = [];
  let zl = 0;
  for (const b of bands) {
    if (zl >= top) break;
    const zu = Math.min(b.up_to_mm ?? top, top);
    if (zu <= zl) continue;
    const m = b.min_distance_mm ?? 0;
    const k = b.distance_ratio ? b.distance_ratio.num / b.distance_ratio.den : 0;
    const lin = (za: number, zb: number) => out.push({ za, zb, d0: za * k, d1: zb * k });
    const flat = (za: number, zb: number) => out.push({ za, zb, d0: m, d1: m });
    if (k > 0) {
      const zc = m > 0 ? m / k : 0;
      if (m > 0 && zc >= zu) flat(zl, zu);
      else if (m > 0 && zc > zl) {
        flat(zl, zc);
        lin(zc, zu);
      } else lin(zl, zu);
    } else flat(zl, zu);
    zl = zu;
  }
  return out;
}

const dAt = (p: Piece, z: number) => p.d0 + ((p.d1 - p.d0) * (z - p.za)) / (p.zb - p.za);

interface MassSection {
  id: string;
  /** 단면 구간(정북 좌표, 정수 mm). */
  spans: Array<[number, number]>;
  /** 아래→위 층 구간 [id, z0, z1]. 지상층만. */
  floors: Array<[string, number, number]>;
  zBase: number;
  zTop: number;
}

function dedupe(pts: Vec<number>[]): Vec<number>[] {
  return pts.filter((p, i) => i === 0 || p[0] !== (pts[i - 1] as Vec<number>)[0] || p[1] !== (pts[i - 1] as Vec<number>)[1]);
}

const SUBJECT = "일조사선";

export function buildSunlightSectionView(
  input: DraftingInput,
  envelope: SunlightEnvelopeInput,
  options: SunlightSectionOptions = {},
): ViewModel {
  const { model, sheet } = input;
  if (sheet.kind !== "sunlight_section") throw new DraftingError("INVALID_ARGUMENT", `sunlight_section 뷰는 sunlight_section 시트에만 씁니다: ${sheet.kind}`);
  if (!Number.isSafeInteger(envelope.top_mm) || envelope.top_mm <= 0) {
    throw new DraftingError("INVALID_ARGUMENT", `엔벨로프 top_mm은 양의 정수여야 합니다: ${envelope.top_mm}`);
  }

  // 정북 단위 벡터: north_angle_deg = +Y에서 정북까지 시계 방향(rules/envelope/north.ts와 같은 규약).
  const [cosT, sinT] = cosSinDeg(model.site.north_angle_deg);
  const north: Vec<number> = [sinT, cosT];

  // 단면선: 지정이 없으면 매스 무게중심(없으면 대지 무게중심)을 지나는 정북 방향.
  let P: Vec<number>;
  let D: Vec<number>;
  if (sheet.section_line) {
    const { a, b } = sheet.section_line;
    P = [a[0], a[1]];
    D = [b[0] - a[0], b[1] - a[1]];
    if (D[0] === 0 && D[1] === 0) throw new DraftingError("INVALID_ARGUMENT", "단면선의 두 점이 같습니다");
  } else {
    let area = 0;
    let mx = 0;
    let my = 0;
    for (const m of model.masses) {
      const s = polygonMoments(m.footprint);
      area += s.area;
      mx += s.mx;
      my += s.my;
    }
    if (!(area > 0)) {
      const s = polygonMoments(model.site.boundary);
      area = s.area;
      mx = s.mx;
      my = s.my;
    }
    if (!(area > 0)) throw new DraftingError("INVALID_ARGUMENT", "대지 면적이 0이라 단면선을 정할 수 없습니다");
    P = [r(mx / area), r(my / area)];
    D = north;
  }
  if (Math.abs(D[0] * north[0] + D[1] * north[1]) <= 1e-9 * Math.sqrt(D[0] * D[0] + D[1] * D[1])) {
    throw new DraftingError("INVALID_ARGUMENT", "단면선이 정북 방향과 직각이라 정북 단면을 만들 수 없습니다");
  }

  // 대지 교차: 가장 북쪽 교점 = 정북 경계선, 가장 남쪽 = 남쪽 경계.
  const siteX = lineCrossings(model.site.boundary, P, D, north);
  if (siteX.length < 2) throw new DraftingError("INVALID_ARGUMENT", "단면선이 대지와 만나지 않습니다");
  const first = siteX[0]!;
  const last = siteX[siteX.length - 1]!;
  const uS = r(first.u);
  const uN = r(last.u);

  // 매스 단면.
  const masses: MassSection[] = [];
  for (const m of model.masses) {
    const spans = insideIntervals(lineCrossings(m.footprint, P, D, north))
      .map(([a, b]) => [r(a), r(b)] as [number, number])
      .filter(([a, b]) => b > a);
    if (spans.length === 0) continue;
    const up = m.floors.filter((f) => f.level >= 1 && f.height_mm > 0).sort((a, b) => a.level - b.level);
    let z = m.base_level_mm;
    const floors: MassSection["floors"] = [];
    for (const f of up) {
      floors.push([f.id, z, z + f.height_mm]);
      z += f.height_mm;
    }
    if (floors.length === 0) continue;
    masses.push({ id: m.id, spans, floors, zBase: m.base_level_mm, zTop: z });
  }

  // 사선: 적용 여부와 구간표.
  const sun = envelope.constraints.find((c) => c.key === "sunlight");
  const bands = sun && sun.applied ? parseBands(sun.applied_params) : null;
  const roadEdges = roadEdgesOf(sun?.applied_params);
  const northOnRoad = first === last ? false : last.ring === 0 && model.site.roads.some((rd) => rd.edge_index === last.edge);
  let inactive: string | null = null;
  if (!sun) inactive = "엔벨로프에 일조사선 제약이 없음";
  else if (!sun.applied || bands === null) inactive = `일조사선 미적용(${sun.status})`;
  else if (northOnRoad && roadEdges === "exempt") inactive = "정북 쪽이 도로 변이라 기준선에서 제외(규칙 팩 도로 변 제외)";
  const pieces = inactive === null && bands !== null ? piecesOf(bands, envelope.top_mm) : [];

  const prims: Prim<Mm>[] = [];
  const maxTop = Math.max(1000, ...masses.map((m) => m.zTop), inactive === null ? envelope.top_mm : 0);
  prims.push({ layer: "A-SITE-BNDY", key: "ground", t: "line", a: [uS, 0], b: [uN, 0] });
  prims.push({ layer: "A-SITE-BNDY", key: "site:north", t: "line", a: [uN, 0], b: [uN, maxTop] });
  prims.push({ layer: "A-SITE-BNDY", key: "site:south", t: "line", a: [uS, 0], b: [uS, 500] });

  masses.forEach((m) => {
    m.spans.forEach(([a, b], k) => {
      const zb = m.zBase;
      prims.push({
        layer: "A-MASS",
        key: `mass:${m.id}:${k}`,
        t: "pline",
        closed: true,
        pts: [
          [a, zb],
          [b, zb],
          [b, m.zTop],
          [a, m.zTop],
        ],
      });
      m.floors.slice(0, -1).forEach(([fid, , z1]) => {
        prims.push({ layer: "A-MASS", key: `floor:${m.id}:${k}:${fid}`, t: "line", a: [a, z1], b: [b, z1] });
      });
    });
  });

  // 사선 폴리라인(정북 경계에서 거리만큼 남쪽). 구간 경계에서는 계단으로 꺾인다.
  if (pieces.length > 0) {
    const pts: Vec<number>[] = [];
    for (const p of pieces) {
      pts.push([r(uN - p.d0), r(p.za)], [r(uN - p.d1), r(p.zb)]);
    }
    prims.push({ layer: "A-ENVL", key: "envelope:line", t: "pline", closed: false, pts: dedupe(pts) });
  }

  // 사선 초과: 매스 단면 ∩ (u ≥ uN − d(z)).
  interface Excess {
    id: string;
    z0: number;
    z1: number;
    over: number;
    u1: number;
  }
  const excess: Excess[] = [];
  for (const m of masses) {
    let z0 = Infinity;
    let z1 = -Infinity;
    let over = 0;
    let u1 = -Infinity;
    let count = 0;
    m.spans.forEach(([a, b], k) => {
      pieces.forEach((p, pi) => {
        const lo = Math.max(p.za, m.zBase);
        const hi = Math.min(p.zb, m.zTop);
        if (!(hi > lo)) return;
        const rect: Pt[] = [
          [a, lo],
          [b, lo],
          [b, hi],
          [a, hi],
        ];
        const poly = clipHalfPlane(rect, ([u, z]) => u - (uN - dAt(p, z)));
        const loop = dedupe(poly.map(([u, z]) => [r(u), r(z)] as Vec<number>));
        if (loop.length < 3) return;
        const ar = loop.reduce((s, q, i) => {
          const w = loop[(i + 1) % loop.length] as Vec<number>;
          return s + (q[0] * w[1] - w[0] * q[1]);
        }, 0);
        if (ar === 0) return;
        count += 1;
        for (const [u, z] of poly) {
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
          over = Math.max(over, u - (uN - dAt(p, z)));
          u1 = Math.max(u1, u);
        }
        prims.push({ layer: "A-ANNO-TEXT", key: `excess:${m.id}:${k}:${pi}`, t: "hatch", loops: [loop], pattern: "ANSI31" });
      });
    });
    if (count > 0) excess.push({ id: m.id, z0: r(z0), z1: r(z1), over: r(over), u1: r(u1) });
  }

  prims.push({
    layer: "A-ANNO-NRTH",
    key: "north",
    t: "text",
    at: [uN, maxTop],
    h: textHeightUm(input.profile.default_text_height_mm),
    s: "정북 →",
    align: "r",
  });

  // 용지 라벨: 위쪽 주석 띠 안에 적용 기준·신청일·초과 여부.
  const textH = textHeightUm(input.profile.default_text_height_mm);
  const u = usableRect(sheet.paper, sheet.orientation, sheet.kind);
  const step = r(textH * 1.5);
  const basis = sun?.basis ?? [];
  const std = options.standard === "new" ? " · 신 기준" : options.standard === "old" ? " · 구 기준" : "";
  const basisText =
    basis.length > 0
      ? `${SUBJECT} 적용 기준: ${basis.map((b) => `${b.law} ${b.article}(시행 ${b.effective_from})`).join(" / ")}${std}`
      : `${SUBJECT} 적용 기준: 확인 필요`;
  const lines: Array<{ s: string; ref: string }> = [
    { s: basisText, ref: "envelope.constraints.sunlight.basis" },
    { s: `신청일 ${envelope.application_date} · 규칙 팩 ${envelope.rule_pack_version}`, ref: "envelope.application_date" },
    {
      s: inactive !== null ? inactive : excess.length > 0 ? `사선 초과 ${excess.length}개 매스` : "사선 초과 없음",
      ref: "sunlight_section.excess",
    },
  ];
  const paper_prims: Prim<PaperUm>[] = lines.map((l, i) => ({
    layer: "A-ANNO-TEXT",
    key: `legend:${i}`,
    t: "text",
    at: [u.x0 + 200, u.y1 - 150 - textH - i * step],
    h: textH,
    s: l.s,
    align: "l",
    source_ref: l.ref,
  }));

  const annotate = (ctx: { scale: 100 | 200 | 300 | 500 | 600; text_h: number }): Annotation[] => {
    const out: Annotation[] = [];
    masses.forEach((m, mi) => {
      const [a] = m.spans[0] as [number, number];
      m.floors.forEach(([fid, z0, z1]) => {
        out.push(
          dimension(
            {
              anno_id: `dim:floor:${m.id}:${fid}`,
              view_id: SUNLIGHT_VIEW_ID,
              a: [a, z0],
              b: [a, z1],
              offset: 1500 + mi * 3000,
              value_mm: z1 - z0,
              source_ref: `model.masses.${m.id}.floors.${fid}.height_mm`,
            },
            ctx,
          ),
        );
      });
      out.push(
        dimension(
          {
            anno_id: `dim:height:${m.id}`,
            view_id: SUNLIGHT_VIEW_ID,
            a: [a, 0],
            b: [a, m.zTop],
            offset: 3000 + mi * 3000,
            value_mm: m.zTop,
            source_ref: `geometry.mass_height.${m.id}`,
          },
          ctx,
        ),
      );
    });
    for (const e of excess) {
      out.push(
        label(
          {
            anno_id: `warn:sunlight_excess:${e.id}`,
            kind: "warning",
            view_id: SUNLIGHT_VIEW_ID,
            at: [e.u1 + 300, e.z1],
            align: "l",
            lines: [
              { s: "사선 초과" },
              { kind: "value", s: `${e.z0}~${e.z1}mm 구간 최대 ${e.over}mm`, source_ref: `sunlight_section.excess.${e.id}` },
            ],
          },
          ctx,
        ),
      );
    }
    return out;
  };

  return { views: [{ view_id: SUNLIGHT_VIEW_ID, prims }], paper_prims, annotate };
}
