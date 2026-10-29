// 로고 PNG 검사·경로 규칙(계획 공격 P5).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLogoPath, inspectPng, isOwnLogoPath, LOGO_MAX_BYTES } from "./png.ts";
import { chunk, ihdr, pngBytes, SIG } from "./test-helpers.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OBJ = "99999999-9999-4999-8999-999999999999";

test("정상 PNG 통과(+ 색 보조 청크 허용)", () => {
  assert.deepEqual(inspectPng(pngBytes()), { ok: true, width: 16, height: 16 });
  assert.equal(inspectPng(pngBytes([chunk("sRGB", [0]), chunk("pHYs", [0, 0, 0, 1, 0, 0, 0, 1, 1])])).ok, true);
});

test("위장 거부: SVG·HTML·JPEG·빈 파일", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.deepEqual(inspectPng(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), { ok: false, reason: "signature" });
  assert.deepEqual(inspectPng(enc("<!doctype html><script>x</script>")), { ok: false, reason: "signature" });
  assert.deepEqual(inspectPng(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), { ok: false, reason: "signature" });
  assert.deepEqual(inspectPng(new Uint8Array(0)), { ok: false, reason: "empty" });
});

test("PNG 시그니처 뒤에 HTML을 붙인 폴리글롯·잘린 파일·IEND 뒤 꼬리·IHDR 중복 거부", () => {
  const html = [...new TextEncoder().encode("<html><script>x</script>")];
  assert.equal(inspectPng(Uint8Array.from([...SIG, ...html])).ok, false);
  const ok = pngBytes();
  assert.equal(inspectPng(ok.slice(0, ok.length - 3)).ok, false);
  assert.deepEqual(inspectPng(Uint8Array.from([...ok, ...html])), { ok: false, reason: "structure" });
  assert.equal(inspectPng(pngBytes([ihdr()])).ok, false);
  assert.equal(inspectPng(Uint8Array.from([...SIG, ...chunk("IDAT", [1]), ...chunk("IEND")])).ok, false);
});

test("메타데이터 청크(EXIF·텍스트·시각) 거부", () => {
  for (const t of ["eXIf", "tEXt", "zTXt", "iTXt", "tIME", "caNv"]) {
    assert.deepEqual(inspectPng(pngBytes([chunk(t, [65, 0, 66])])), { ok: false, reason: "chunk" }, t);
  }
});

test("크기: 1MB 초과 거부, 캔버스 4096 초과(압축 폭탄) 거부", () => {
  assert.deepEqual(inspectPng(new Uint8Array(LOGO_MAX_BYTES + 1)), { ok: false, reason: "too_large" });
  assert.deepEqual(inspectPng(pngBytes([], 5000, 10)), { ok: false, reason: "dimensions" });
  assert.deepEqual(inspectPng(pngBytes([], 0, 10)), { ok: false, reason: "dimensions" });
});

test("경로: 자기 조직 drafting-logo/<uuid>.png만", () => {
  const path = buildLogoPath(ORG, OBJ);
  assert.equal(path, `${ORG}/arch/drafting-logo/${OBJ}.png`);
  assert.equal(isOwnLogoPath(ORG, path as string), true);
  for (const p of [
    `${OTHER}/arch/drafting-logo/${OBJ}.png`,
    `${ORG}/arch/drafting-logo/${OBJ}.svg`,
    `${ORG}/arch/drafting-logo/${OBJ}.PNG`,
    `${ORG}/arch/drafting-logo/../render_input/${OBJ}.png`,
    `${ORG}/arch/render_input/${OBJ}.png`,
    `${ORG}/arch/drafting-logo/${OBJ}.png?x=1`,
    `/${ORG}/arch/drafting-logo/${OBJ}.png`,
    `${ORG}/arch/drafting-logo/x/${OBJ}.png`,
  ]) {
    assert.equal(isOwnLogoPath(ORG, p), false, p);
  }
  assert.equal(buildLogoPath(ORG, "../../x"), null);
  assert.equal(buildLogoPath("not-a-uuid", OBJ), null);
});
