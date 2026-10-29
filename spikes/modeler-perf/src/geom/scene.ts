// 스파이크(버리는 코드): 결정적 장면 생성기. Node 벤치와 브라우저 하니스가 같은 입력을 쓴다.
// 매스 = 정수 mm 요철 k각형 바닥 × 층(3,000mm) 압출. DesignModel의 mass 모양(footprint·floors)을 흉내 낸다.

export type Pt = [number, number];

export interface MassSpec {
  id: string;
  /** 바닥 외곽(반시계, 정수 mm). */
  footprint: Pt[];
  base_level_mm: number;
  floors: { id: string; level: number; height_mm: number; use: string }[];
  roof: { type: "flat" };
}

export interface ScenePreset {
  name: string;
  masses: number;
  floors: number;
  /** 바닥 다각형 꼭짓점 수(짝수, 요철). */
  verts: number;
}

/** 표준 프리셋. S200k는 매스 50개·삼각형 약 20만 개(036 권장 사양 기준). */
export const PRESETS: ScenePreset[] = [
  { name: "S1", masses: 1, floors: 5, verts: 12 },
  { name: "S10", masses: 10, floors: 5, verts: 12 },
  { name: "S50", masses: 50, floors: 5, verts: 12 },
  { name: "S50-k64", masses: 50, floors: 5, verts: 64 },
  { name: "S200k", masses: 50, floors: 5, verts: 340 },
];

export function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

/** 요철 k각형(반지름 r·0.78r 교대). 꼭짓점은 유리 매개화 원으로 만들어 Math.sin/cos 플랫폼 차이를 피한다. */
export function starFootprint(cx: number, cy: number, r: number, k: number): Pt[] {
  const pts: Pt[] = [];
  const q = k / 4;
  for (let quad = 0; quad < 4; quad++) {
    for (let i = 0; i < q; i++) {
      const t = i / q;
      const c = (1 - t * t) / (1 + t * t);
      const s = (2 * t) / (1 + t * t);
      const idx = quad * q + i;
      const rr = idx % 2 === 0 ? r : r * 0.78;
      const dirs: Pt[] = [
        [c, s],
        [-s, c],
        [-c, -s],
        [s, -c],
      ];
      const [x, y] = dirs[quad] as Pt;
      pts.push([Math.round(cx + rr * x), Math.round(cy + rr * y)]);
    }
  }
  return pts;
}

/** 매스 N개를 10열 격자(간격 9m)로 배치. 대지 100m × 60m 안. */
export function makeMasses(p: ScenePreset, seed = 20261029): MassSpec[] {
  const rnd = lcg(seed);
  const out: MassSpec[] = [];
  const k = Math.max(4, Math.round(p.verts / 4) * 4);
  for (let i = 0; i < p.masses; i++) {
    const col = i % 10;
    const row = Math.floor(i / 10);
    const cx = 8000 + col * 9000 + Math.round(rnd() * 600);
    const cy = 8000 + row * 9000 + Math.round(rnd() * 600);
    const floors = Array.from({ length: p.floors }, (_, f) => ({ id: `m${i}-f${f + 1}`, level: f + 1, height_mm: 3000, use: "가짜용도A" }));
    out.push({ id: `m${i}`, footprint: starFootprint(cx, cy, 3500, k), base_level_mm: 0, floors, roof: { type: "flat" } });
  }
  return out;
}

/** 대지(100m × 60m, 남쪽 변 도로). 엔벨로프 입력용. */
export const SITE: Pt[] = [
  [0, 0],
  [100000, 0],
  [100000, 60000],
  [0, 60000],
];

export function stats(xs: number[]): { n: number; median: number; p95: number; min: number; max: number; mean: number } {
  const s = [...xs].sort((a, b) => a - b);
  const pick = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { n: s.length, median: r(pick(0.5)), p95: r(pick(0.95)), min: r(s[0] ?? 0), max: r(s[s.length - 1] ?? 0), mean: r(mean) };
}
