// 단면 도구 S(03장 3.5절, AR-06-084, 순수·결정적): 평면 위 수직 단면선(두 점, mm 정수) → 클리핑 평면.
// 화면 표시 전용: DesignModel에 저장하지 않고 실행 취소 대상도 아니다. 시트 단면선(3.8절, AR-F-031 정북 고정)과 상태를 나누지 않는다.
// 규약: 단면선 a→b의 왼쪽 반공간을 남기고(보이는 쪽), 오른쪽은 잘라 낸다. 단면 보기 카메라는 오른쪽에서 왼쪽을 본다.
import type { Point } from "@arch-studio/domain";
import { snapMm, type Model } from "../state/commands.ts";
import { sceneBounds } from "../viewport/geometry.ts";

export interface SectionLine {
  readonly a: Point;
  readonly b: Point;
}

/** 정수 평면 nx·x + ny·y + c ≥ 0 이 남는 쪽(모델 mm, 수직 평면이라 z 성분 0). n = a→b를 반시계 90° 돌린 벡터(정규화 안 함). */
export interface SectionPlane {
  readonly nx: number;
  readonly ny: number;
  readonly c: number;
}

/** 단면선 → 정수 평면. 두 점이 같으면 null. */
export function sectionPlane(line: SectionLine): SectionPlane | null {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  if (dx === 0 && dy === 0) return null;
  // `|| 0`: −0을 0으로(같은 입력 → 같은 값, 비교·직렬화 안정)
  const nx = -dy || 0;
  const ny = dx;
  return { nx, ny, c: -(nx * line.a[0] + ny * line.a[1]) || 0 };
}

/** 점이 남는 쪽인가(평면 위 포함, 정수 계산). */
export function keepsPoint(p: SectionPlane, x: number, y: number): boolean {
  return p.nx * x + p.ny * y + p.c >= 0;
}

/**
 * three 월드(m, Y 위) 클리핑 평면 [nx, ny, nz, constant](정규화). 모델 (x, y, z) → 월드 (x/1000, z/1000, −y/1000)이므로
 * 법선 (nx, ny, 0) → (nx, 0, −ny), 상수 c(mm) → c/1000(m). three는 거리가 음수인 쪽을 잘라 낸다.
 */
export function worldClipPlane(p: SectionPlane): readonly [number, number, number, number] {
  const len = Math.sqrt(p.nx * p.nx + p.ny * p.ny);
  return [p.nx / len || 0, 0, -p.ny / len || 0, p.c / len / 1000 || 0];
}

/**
 * 정북 단면 기본 프리셋: 장면 중심(100mm 격자)을 지나 정북 방향으로 장면 크기만큼 뻗은 선(남 → 북).
 * 남는 쪽(왼쪽)이 서쪽이라 정북 단면 보기(동쪽에서 봄, cameraPose "section")와 같은 방향에서 단면을 본다.
 * northDeg는 모델 +Y에서 정북까지 시계 방향(DesignModel site.north_angle_deg). 끝점은 grid mm로 반올림.
 */
export function northSection(model: Model, grid = 100): SectionLine {
  const b = sceneBounds(model);
  const cx = snapMm((b.minX + b.maxX) / 2, grid);
  const cy = snapMm((b.minY + b.maxY) / 2, grid);
  const half = Math.max(b.maxX - b.minX, b.maxY - b.minY, 10_000);
  const r = (model.site.north_angle_deg * Math.PI) / 180;
  const ux = Math.sin(r);
  const uy = Math.cos(r);
  return {
    a: [snapMm(cx - ux * half, grid), snapMm(cy - uy * half, grid)],
    b: [snapMm(cx + ux * half, grid), snapMm(cy + uy * half, grid)],
  };
}

/** 단면선 표시 문구(mm 정수). */
export function sectionText(line: SectionLine): string {
  const f = (v: number) => v.toLocaleString("ko-KR");
  return `(${f(line.a[0])}, ${f(line.a[1])}) → (${f(line.b[0])}, ${f(line.b[1])}) mm`;
}
