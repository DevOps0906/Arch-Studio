// 라이선스 API 입력 zod(04_API.md 2.1절). 조직·사용자·시각·금액 필드는 받지 않는다(strict: 모르는 키 거부).
import { z } from "zod";

const deviceHash = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/)
  .transform((v) => v.toLowerCase());
// 기기 이름: 받되 지금은 저장하지 않는다(activate RPC에 인자 없음, tasks/logs/AR-06-040.md 미해결).
const deviceLabel = z.string().trim().max(60).optional();

export const activateSchema = z.union([
  z.object({ serial: z.string().min(1).max(64), device_hash: deviceHash, device_label: deviceLabel }).strict(),
  z.object({ mode: z.literal("plan"), device_hash: deviceHash, device_label: deviceLabel }).strict(),
]);
export type ActivateInput = z.infer<typeof activateSchema>;

export const deactivateSchema = z.object({ activation_id: z.string().uuid() }).strict();
export const refreshSchema = z.object({ activation_id: z.string().uuid(), device_hash: deviceHash }).strict();

export const MAX_BODY_BYTES = 2048;
