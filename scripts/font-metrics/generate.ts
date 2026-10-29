// 글꼴 폭 표 생성(AR-06-022, 빌드 시 실행). TTF → packages/drafting/fonts/<이름>.metrics.json(결정적: 같은 글꼴 → 같은 바이트).
// 파서·표 형식은 packages/drafting/src/writers/pdf/{ttf,metrics}.ts(외부 의존성 없음, hmtx·cmap 직접 해석).
// 글꼴 파일 자체는 저장소에 넣지 않는다(packages/drafting/fonts/README.md). 표만 커밋하고, CI는 --check로 표가 글꼴과 맞는지 본다.
//
// 사용(저장소 루트에서, Node 22.18+ TS 직접 실행):
//   node scripts/font-metrics/generate.ts <글꼴.ttf> [--out <경로>] [--name <표 이름>]
//   node scripts/font-metrics/generate.ts <글꼴.ttf> --check [--out <경로>]   — 표가 없거나 다르면 종료 코드 1
// 기본 출력: packages/drafting/fonts/<표 이름>.metrics.json, 표 이름 기본값 = 글꼴 파일 이름(확장자 뺀 것).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFontMetrics, fontMetricsJson } from "../../packages/drafting/src/writers/pdf/metrics.ts";
import { parseTtf } from "../../packages/drafting/src/writers/pdf/ttf.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function usage(msg: string): never {
  console.error(`${msg}\n사용: node scripts/font-metrics/generate.ts <글꼴.ttf> [--out <경로>] [--name <표 이름>] [--check]`);
  process.exit(2);
}

const args = process.argv.slice(2);
let input: string | undefined;
let out: string | undefined;
let name: string | undefined;
let check = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i] as string;
  if (a === "--check") check = true;
  else if (a === "--out") out = args[++i] ?? usage("--out 값이 없습니다");
  else if (a === "--name") name = args[++i] ?? usage("--name 값이 없습니다");
  else if (a.startsWith("--")) usage(`알 수 없는 옵션: ${a}`);
  else if (input === undefined) input = a;
  else usage(`입력 글꼴은 하나만: ${a}`);
}
if (input === undefined) usage("글꼴 파일을 지정하세요");
if (name !== undefined && !/^[A-Za-z0-9._-]+$/.test(name)) usage(`표 이름은 영숫자·. _ - 만: ${name}`);

const bytes = new Uint8Array(readFileSync(input));
const parsed = parseTtf(bytes);
if (!parsed.ok) {
  console.error(`${input}: ${parsed.reason}`);
  process.exit(1);
}
const file = basename(input);
const table = buildFontMetrics(parsed.font, {
  file,
  bytes: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});
const json = fontMetricsJson(table);
const target = resolve(out ?? `${ROOT}/packages/drafting/fonts/${name ?? basename(file, extname(file))}.metrics.json`);
const glyphs = table.runs.reduce((s, r) => s + (r[1] - r[0] + 1), 0);

if (check) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== json) {
    console.error(`${target}: 글꼴 폭 표가 ${file}과 다릅니다. node scripts/font-metrics/generate.ts ${input}로 다시 만드세요.`);
    process.exit(1);
  }
  console.log(`${target}: 일치(${table.family}, 글자 ${glyphs}, 구간 ${table.runs.length})`);
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, json);
  console.log(`${target}: ${table.family}, unitsPerEm ${table.units_per_em}, 글자 ${glyphs}, 구간 ${table.runs.length}, ${json.length}B`);
}
