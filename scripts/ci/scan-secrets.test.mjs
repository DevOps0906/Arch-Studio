// 대조군: 심은 가짜 키는 잡히고, 허용 목록·무해한 문자열은 오탐 0. 가짜 키는 실행 중 조립한다(이 파일이 스스로 걸리지 않게).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanDirs, scanRepo, scanText } from "./scan-secrets.mjs";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => `${b64u({ alg: "HS256" })}.${b64u({ role })}.c2lnbmF0dXJl`;
const SK = "s" + "k-" + "A1b2C3d4E5f6G7h8I9j0K1l2";
const SB = "sb_sec" + "ret_" + "A1b2C3d4E5f6G7h8I9j0K1l2";
const PEM = "-----BEGIN " + "PRIVATE KEY-----";
const none = { useAllowlist: false };

test("대조군: 심은 가짜 키 4종이 잡힌다", () => {
  for (const [name, text, id] of [
    ["jwt", `k="${jwt("service_role")}"`, "jwt-service-role"],
    ["sb", `k=${SB}`, "sb-secret"],
    ["sk", `k=${SK}`, "sk-key"],
    ["pem", `${PEM}\nabc`, "pem-private-key"],
  ]) {
    const hits = scanText(text, `${name}.js`, none);
    assert.equal(hits.length, 1, name);
    assert.match(hits[0], new RegExp(id));
    assert.ok(!hits[0].includes(SK) && !hits[0].includes(SB), "출력에 비밀 전체가 없다");
  }
});

test("오탐 0: anon JWT·짧은 sk-·단어 중간 sk-·공개키 헤더", () => {
  for (const text of [
    jwt("anon"),
    jwt("authenticated"),
    "sk-short",
    "task-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3",
    "disk-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3",
    "-----BEGIN PUBLIC KEY-----",
    "eyJhbGciOiJub25lIn0.not-json.sig",
  ]) assert.equal(scanText(text, "x.txt", none).length, 0, text);
});

test("허용 목록: 지정 파일만 면제, 다른 경로는 잡힌다", () => {
  const t = jwt("service_role");
  assert.equal(scanText(t, "workers/arch-jobs/src/core/mask.test.ts", { useAllowlist: true }).length, 0);
  assert.equal(scanText(t, "apps/web/src/a.ts", { useAllowlist: true }).length, 1);
  assert.equal(scanText(t, "workers/arch-jobs/src/core/mask.test.ts", none).length, 1, "dir 모드는 허용 목록 없음");
});

test("dir 모드: 산출물 폴더의 심은 키를 잡고 바이너리는 건너뛴다", () => {
  const d = mkdtempSync(path.join(tmpdir(), "scan-"));
  mkdirSync(path.join(d, "assets"));
  writeFileSync(path.join(d, "assets", "a.js"), `x=${SK}`);
  writeFileSync(path.join(d, "ok.js"), "console.log(1)");
  writeFileSync(path.join(d, "b.bin"), Buffer.concat([Buffer.from([0]), Buffer.from(SK)]));
  assert.equal(scanDirs([d]).length, 1);
});

test("현재 저장소 추적 파일 0건", () => {
  assert.deepEqual(scanRepo(), []);
});

test("CLI: 발견 시 종료 코드 1", () => {
  const d = mkdtempSync(path.join(tmpdir(), "scan-"));
  writeFileSync(path.join(d, "a.js"), SB);
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "scan-secrets.mjs");
  assert.throws(() => execFileSync("node", [cli, "dir", d], { stdio: "pipe" }), (e) => e.status === 1);
});
