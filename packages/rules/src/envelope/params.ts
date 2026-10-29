// 엔벨로프가 읽는 일조사선 팩 수치 형식(AR-06-016). pack.ts는 sunlight params를 형식 없이 받으므로 여기서 검사한다.
// 수치는 팩에만 있다 — 이 파일에는 법규 수치가 없다.
import { z } from "zod";

const mmPositive = z.number().int().positive();

/**
 * 높이 구간 하나: 건축물 부분의 높이 z가 (앞 구간 up_to_mm, up_to_mm] 이면
 * 정북 방향 인접 대지경계선까지 거리 ≥ max(min_distance_mm, z × num / den).
 */
const bandSchema = z
  .object({
    /** 구간 상한(포함). null = 그 위 전부(마지막 구간만). */
    up_to_mm: mmPositive.nullable(),
    min_distance_mm: mmPositive.optional(),
    distance_ratio: z.object({ num: mmPositive, den: mmPositive }).strict().optional(),
  })
  .strict()
  .refine((b) => b.min_distance_mm !== undefined || b.distance_ratio !== undefined, "거리 기준이 하나 이상 있어야 합니다");

const bandsSchema = z
  .array(bandSchema)
  .min(1)
  .superRefine((bands, ctx) => {
    bands.forEach((b, i) => {
      const last = i === bands.length - 1;
      if (last !== (b.up_to_mm === null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "up_to_mm"], message: "마지막 구간만 up_to_mm가 null입니다" });
      }
      const prev = i > 0 ? bands[i - 1]?.up_to_mm : 0;
      if (b.up_to_mm !== null && typeof prev === "number" && b.up_to_mm <= prev) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "up_to_mm"], message: "구간 상한은 커져야 합니다" });
      }
    });
  });

export const sunlightParamsSchema = z
  .object({
    /** 용도지역별 높이 구간. 없는 용도지역은 "기준 없음(확인 필요)"으로 적용하지 않는다. */
    bands_by_district: z.record(z.string().min(1), bandsSchema),
    /** 도로 변을 일조사선 기준선에서 뺄지(exempt) 넣을지(apply). 팩이 정한다. */
    road_edges: z.enum(["exempt", "apply"]),
  })
  .strict();

export type SunlightParams = z.infer<typeof sunlightParamsSchema>;
export type SunlightBand = z.infer<typeof bandSchema>;
