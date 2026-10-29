// 업로드 목적별 정책과 서버 경로 생성(04_API.md 1장 "업로드", 2.1절 `POST /api/uploads/sign`, 05장 storage_path CHECK).
// 경로는 서버만 만든다: <org_id>/arch/<purpose>/[<project_ref>/]<uuid>.<ext>. 클라이언트는 경로·파일명을 보내지 않는다.
// project_ref 폴더는 project_snapshot에만 둔다(arch.cloud_projects.storage_path CHECK가 <local_id>/ 폴더를 요구, 2400_arch.sql:231).
// 상한 값의 근거: render_input 10MB·녹음 200MB(01_PRD.md 5장 "업로드 상한", 제안), proposal_sheet 2MB(04_API.md 6.2절, 제안),
// project_snapshot 100MB(버킷 arch-user file_size_limit, 2400_arch.sql:1839). 확장자 목록은 제안(consult_audio 형식은 미확인).
// server-only를 import하지 않는다(node --test 대상).
import { UUID_RE } from "../ai/gateway/http.ts";

export const UPLOAD_PURPOSES = ["project_snapshot", "render_input", "proposal_sheet", "consult_audio"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** 목적별로 필요한 기능 키(arch.org_features). null = 엔타이틀먼트만. 권리 합성(rights.*, AR-06-074) 전 임시 판정. */
export type UploadFeature = "ai_render" | "ai_intake" | null;

export interface PurposePolicy {
  bucket: "arch-user" | "voice-audio";
  exts: readonly string[];
  maxBytes: number;
  requiresProjectRef: boolean;
  feature: UploadFeature;
}

const MB = 1024 * 1024;

export const PURPOSE_POLICIES: Readonly<Record<UploadPurpose, PurposePolicy>> = {
  project_snapshot: { bucket: "arch-user", exts: ["arch"], maxBytes: 100 * MB, requiresProjectRef: true, feature: null },
  render_input: { bucket: "arch-user", exts: ["png"], maxBytes: 10 * MB, requiresProjectRef: false, feature: "ai_render" },
  proposal_sheet: { bucket: "arch-user", exts: ["svg"], maxBytes: 2 * MB, requiresProjectRef: false, feature: "ai_render" },
  consult_audio: { bucket: "voice-audio", exts: ["m4a", "webm", "ogg", "wav"], maxBytes: 200 * MB, requiresProjectRef: false, feature: "ai_intake" },
};

export function isUploadPurpose(value: unknown): value is UploadPurpose {
  return typeof value === "string" && (UPLOAD_PURPOSES as readonly string[]).includes(value);
}

/** 정책 조회(own property만: "__proto__"·"constructor" 같은 키로 프로토타입을 읽지 않는다). */
export function policyFor(purpose: string): PurposePolicy | undefined {
  return isUploadPurpose(purpose) ? PURPOSE_POLICIES[purpose] : undefined;
}

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** DB arch.valid_user_path와 같은 모양 검사(+ 목적 허용 목록, 확장자 허용 목록, project_ref 규칙). */
export function isServerUploadPath(orgId: string, purpose: UploadPurpose, path: string): boolean {
  const policy = PURPOSE_POLICIES[purpose];
  if (!UUID_RE.test(orgId) || path.length > 300) return false;
  const folder = policy.requiresProjectRef ? `${UUID_PART}/` : "";
  const re = new RegExp(`^${orgId}/arch/${purpose}/${folder}${UUID_PART}\\.([a-z0-9]{1,8})$`);
  const m = re.exec(path);
  return m !== null && policy.exts.includes(m[1] as string);
}

export type PathFailure = "purpose" | "ext" | "project_ref" | "org" | "object_id";

/** 서버 경로 생성. objectId는 호출자가 crypto.randomUUID()로 만든 값. 실패 이유는 코드만. */
export function buildUploadPath(input: {
  orgId: string;
  purpose: string;
  ext: string;
  projectRef?: string | undefined;
  objectId: string;
}): { ok: true; path: string; policy: PurposePolicy } | { ok: false; reason: PathFailure } {
  const policy = policyFor(input.purpose);
  if (!policy) return { ok: false, reason: "purpose" };
  if (!UUID_RE.test(input.orgId)) return { ok: false, reason: "org" };
  if (!UUID_RE.test(input.objectId)) return { ok: false, reason: "object_id" };
  if (!policy.exts.includes(input.ext)) return { ok: false, reason: "ext" };
  let folder = "";
  if (policy.requiresProjectRef) {
    if (!input.projectRef || !UUID_RE.test(input.projectRef)) return { ok: false, reason: "project_ref" };
    folder = `${input.projectRef}/`;
  } else if (input.projectRef !== undefined && !UUID_RE.test(input.projectRef)) {
    return { ok: false, reason: "project_ref" };
  }
  const path = `${input.orgId}/arch/${input.purpose}/${folder}${input.objectId}.${input.ext}`;
  // 조립 결과를 한 번 더 검사한다(허용 목록이 바뀌어도 DB 정규식 밖 경로가 나가지 않게).
  if (!isServerUploadPath(input.orgId, input.purpose as UploadPurpose, path)) return { ok: false, reason: "ext" };
  return { ok: true, path, policy };
}
