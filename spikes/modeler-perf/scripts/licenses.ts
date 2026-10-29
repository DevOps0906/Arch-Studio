// 스파이크(버리는 코드): 전이 의존성 포함 라이선스 표(prod). secscan 대신 pnpm licenses list. GPL·AGPL은 거부, LGPL은 경로 표시.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const cwd = new URL("..", import.meta.url).pathname;
const raw = JSON.parse(execSync("pnpm licenses list --prod --json --ignore-workspace", { cwd }).toString()) as Record<string, { name: string; versions: string[] }[]>;
const rows: { license: string; count: number; packages: string[] }[] = [];
for (const [license, pk] of Object.entries(raw).sort()) rows.push({ license, count: pk.length, packages: pk.map((p) => `${p.name}@${p.versions.join(",")}`) });
const bad = rows.filter((r) => /\bA?GPL\b|GPL-/.test(r.license) && !/LGPL/.test(r.license));
const lgpl = rows.filter((r) => /LGPL/.test(r.license));
const why: Record<string, string> = {};
for (const r of lgpl) for (const p of r.packages) {
  const name = p.slice(0, p.lastIndexOf("@"));
  why[name] = execSync(`pnpm why ${name} --prod --ignore-workspace`, { cwd }).toString().split("\n").filter((l) => l.trim()).slice(-8).join("\n");
}
for (const r of rows) console.log(`${r.license} (${r.count}): ${r.packages.join(", ")}`);
console.log(bad.length ? `거부 대상(GPL·AGPL): ${bad.map((b) => b.license).join(", ")}` : "GPL·AGPL 0건");
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/licenses.json", import.meta.url), JSON.stringify({ rows, gpl_agpl: bad, lgpl_paths: why }, null, 2));
