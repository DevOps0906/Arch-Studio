// 폼 검증·응답 해석·권한별 상태·로컬 캐시 변조·로고 정리(계획 공격 P1·P4·P5·P6·P9).
import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectPng } from "../../../../../apps/web/src/server/drafting-profile/png.ts";
import { chunk, pngBytes } from "../../../../../apps/web/src/server/drafting-profile/test-helpers.ts";
import { errorMessageFor } from "../../api-client/index.ts";
import { ACCESS_TEXT, screenAccess, syncedLabel } from "./access.ts";
import { CACHE_KEY, clearDraftingProfileCache, parseCache, readDraftingProfileCache, writeDraftingProfileCache, type StorageLike } from "./cache.ts";
import { parseTicket, sha256Hex, stripPng } from "./logo.ts";
import { canEditProfile, checkForm, DEFAULT_PROFILE, parseProfileResponse, toForm, validProfile } from "./profile.ts";
import { saveErrorText } from "./texts.ts";

const ORG = "00000000-0000-4000-8000-00000000d3e1";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LOGO = `${ORG}/arch/drafting-logo/99999999-9999-4999-8999-999999999999.png`;
const profile = { ...DEFAULT_PROFILE, office_name: "나무건축", layer_map: { "A-WALL": "WALL" } };

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

test("권한별 화면 상태: member·viewer 읽기 전용(AR042 문구), 오프라인·캐시는 읽기 전용, owner·admin 온라인만 편집", () => {
  for (const r of ["member", "viewer", null, undefined]) {
    const a = screenAccess(r, true, "server");
    assert.equal(a.editable, false);
    assert.equal(a.lock, "role");
    assert.ok(a.message?.includes("owner·admin만 저장"));
  }
  assert.deepEqual(screenAccess("owner", true, "server"), { editable: true, lock: null, message: null });
  assert.deepEqual(screenAccess("admin", true, "none"), { editable: true, lock: null, message: null });
  assert.equal(screenAccess("admin", false, "server").lock, "offline");
  assert.equal(screenAccess("owner", true, "cache").message, ACCESS_TEXT.cache);
  assert.equal(canEditProfile("member"), false);
  assert.equal(saveErrorText("AR042", null), errorMessageFor("AR042"));
  assert.equal(errorMessageFor("AR042"), "표제란 설정은 조직 owner·admin만 저장합니다.");
  assert.equal(syncedLabel("bad"), "기록 없음");
});

test("checkForm: 제어문자·DXF 그룹 코드 주입·길이·글자 높이·글꼴 거부, 정상은 서버와 같은 본문", () => {
  const base = toForm(profile);
  for (const bad of [
    { office_name: "A\n0\nSECTION" },
    { office_name: " " },
    { office_name: "가".repeat(101) },
    { architect_name: "x\u202e" },
    { contact: "a\tb" },
    { default_text_height_mm: "1.9" },
    { default_text_height_mm: "2.55" },
    { default_text_height_mm: "abc" },
    { font_family: "<script>" },
    { layer_inputs: { "A-WALL": "a\nb" } },
  ]) {
    assert.equal(checkForm({ ...base, ...bad }).ok, false, JSON.stringify(bad));
  }
  const ok = checkForm({ ...base, architect_name: " 홍길동 ", layer_inputs: { "A-WALL": "WALL", "A-DOOR": "문", "A-GLAZ": "" } });
  assert.ok(ok.ok);
  assert.deepEqual(ok.profile, { office_name: "나무건축", architect_name: "홍길동", layer_map: { "A-WALL": "WALL" }, default_paper: "A3", default_text_height_mm: 2.5, font_family: "Noto Sans KR" });
  assert.deepEqual(ok.warnings.map((w) => w.kind), ["unsupported_name"]);
});

test("응답 해석: 깨진 프로필 거부, 모르는 키 버림, can_edit은 true일 때만", () => {
  const r = parseProfileResponse({ profile, updated_at: "2026-10-29T03:00:00Z", logo_url: null, can_edit: "yes", layer_warnings: [{ kind: "x" }], org_id: OTHER });
  assert.equal(r.can_edit, false);
  assert.deepEqual(r.layer_warnings, []);
  assert.equal("org_id" in r, false);
  assert.throws(() => parseProfileResponse({ profile: { ...profile, office_name: "a\nb" } }));
  assert.throws(() => parseProfileResponse({ profile: { ...profile, extra: 1 } }));
  assert.equal(parseProfileResponse({ profile: null }).profile, null);
});

test("P9 캐시 변조: 깨진 JSON·다른 조직·추가 키·제어문자·금지 레이어 이름·표준 밖 키·큰 값 → 버림", () => {
  const s = memory();
  const entry = { org_id: ORG, profile, synced_at: "2026-10-29T03:00:00.000Z", updated_at: null };
  assert.equal(writeDraftingProfileCache(entry, s), true);
  assert.deepEqual(readDraftingProfileCache(ORG, s)?.profile, profile);
  assert.equal(readDraftingProfileCache(OTHER, s), null);
  const raw = s.data.get(CACHE_KEY) as string;
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const tampered: unknown[] = [
    "{broken",
    { ...obj, role: "owner" },
    { ...obj, org_id: OTHER },
    { ...obj, profile: { ...profile, office_name: "X\n0\nSECTION" } },
    { ...obj, profile: { ...profile, layer_map: { "A-WALL": "a/b" } } },
    { ...obj, profile: { ...profile, layer_map: { __proto__: "x", "X-NEW": "y" } } },
    { ...obj, profile: { ...profile, logo_storage_path: "../../etc/passwd" } },
    { ...obj, synced_at: "yesterday" },
    { ...obj, profile: { ...profile, office_name: "가".repeat(40_000) } },
  ];
  for (const t of tampered) assert.equal(parseCache(typeof t === "string" ? t : JSON.stringify(t), ORG), null, JSON.stringify(t).slice(0, 80));
  // 검증 안 된 값은 쓰지 않는다
  assert.equal(writeDraftingProfileCache({ ...entry, profile: { ...profile, office_name: "a\nb" } }, s), false);
  clearDraftingProfileCache(s);
  assert.equal(s.data.has(CACHE_KEY), false);
  // 저장소 예외는 삼킨다
  const throwing: StorageLike = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
  assert.equal(readDraftingProfileCache(ORG, throwing), null);
  assert.equal(writeDraftingProfileCache(entry, throwing), false);
  assert.equal(validProfile({ ...profile, logo_storage_path: LOGO })?.logo_storage_path, LOGO);
});

test("P5 로고: 메타데이터 청크를 지운 결과는 서버 검사를 통과, SVG·큰 파일·깨진 PNG는 화면에서 거부", async () => {
  const withMeta = pngBytes([chunk("tEXt", [65, 0, 66]), chunk("eXIf", [1, 2]), chunk("tIME", [0, 0, 0, 0, 0, 0, 0])]);
  assert.equal(inspectPng(withMeta).ok, false);
  const s = stripPng(withMeta);
  assert.ok(s.ok);
  assert.deepEqual(s.removed, ["tEXt", "eXIf", "tIME"]);
  assert.equal(inspectPng(s.bytes).ok, true);
  assert.deepEqual(stripPng(new TextEncoder().encode("<svg></svg>")), { ok: false, reason: "not_png" });
  assert.deepEqual(stripPng(new Uint8Array(1024 * 1024 + 1)), { ok: false, reason: "too_large" });
  assert.deepEqual(stripPng(withMeta.slice(0, 20)), { ok: false, reason: "broken" });
  assert.match(await sha256Hex(new Uint8Array([1])), /^[0-9a-f]{64}$/);
  // 서명 응답: 다른 조직·다른 폴더·http 원격 URL 거부
  assert.equal(parseTicket({ path: LOGO, signed_upload_url: "https://x.supabase.co/a" }, ORG).path, LOGO);
  assert.throws(() => parseTicket({ path: LOGO.replace(ORG, OTHER), signed_upload_url: "https://x/a" }, ORG));
  assert.throws(() => parseTicket({ path: LOGO.replace("drafting-logo", "render_input"), signed_upload_url: "https://x/a" }, ORG));
  assert.throws(() => parseTicket({ path: LOGO, signed_upload_url: "http://evil.example/a" }, ORG));
  assert.throws(() => parseTicket({ path: LOGO, signed_upload_url: "javascript:alert(1)" }, ORG));
});
