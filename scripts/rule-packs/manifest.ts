// 규칙 팩 매니페스트 생성(AR-06-015). 서명 키를 다루지 않는다: kid·signature는 null, signed=false.
// 서명은 배포 단계에서 web 서버 전용 키(02_ARCHITECTURE.md LICENSE_SIGNING_PRIVATE_KEY)로 따로 한다.
// 사용: node scripts/rule-packs/manifest.ts <팩 폴더…> [--fix] [--check]
//   --fix   pack.json을 정규 JSON(키 사전순·2칸·끝 줄바꿈)으로 다시 쓴다
//   --check 파일을 쓰지 않고 manifest.json이 최신인지 확인(다르면 exit 1)
// 출력은 결정적이다(시각·경로 절대값 없음): 같은 pack.json → 같은 manifest.json 바이트.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { canonicalJson, loadRulePack } from "../../packages/rules/src/index.ts";

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const check = args.includes("--check");
const dirs = args.filter((a) => !a.startsWith("--"));
if (dirs.length === 0) {
  console.error("사용: node scripts/rule-packs/manifest.ts <팩 폴더…> [--fix] [--check]");
  process.exit(2);
}

let failed = false;
for (const dir of dirs.map((d) => resolve(d))) {
  const packPath = join(dir, "pack.json");
  const manifestPath = join(dir, "manifest.json");
  const text = readFileSync(packPath, "utf8");
  const pack = loadRulePack(JSON.parse(text)); // 근거 누락·미확인 규칙의 수치 등은 여기서 거부
  if (basename(dir) !== pack.version) {
    console.error(`✗ ${packPath}: 폴더 이름(${basename(dir)})과 version(${pack.version})이 다릅니다`);
    failed = true;
    continue;
  }
  const canonical = canonicalJson(JSON.parse(text));
  if (text !== canonical) {
    if (!fix) {
      console.error(`✗ ${packPath}: 정규 JSON이 아닙니다(--fix로 정리)`);
      failed = true;
      continue;
    }
    if (!check) writeFileSync(packPath, canonical);
  }
  const bytes = Buffer.from(canonical, "utf8");
  const rules = pack.rules;
  const manifest = {
    format: 1,
    version: pack.version,
    basis_date: pack.basis_date,
    storage_path: `rule-packs/${pack.version}/pack.json`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    rule_count: rules.length,
    unverified_rule_ids: rules.filter((r) => r.status === "unverified").map((r) => r.id).sort(),
    municipality_count: pack.municipalities.length,
    kid: null,
    signature: null,
    signed: false,
  };
  const out = canonicalJson(manifest);
  let current = "";
  try {
    current = readFileSync(manifestPath, "utf8");
  } catch {
    current = "";
  }
  if (check) {
    if (current !== out) {
      console.error(`✗ ${manifestPath}: 최신이 아닙니다(node scripts/rule-packs/manifest.ts ${dir})`);
      failed = true;
    } else console.log(`✓ ${pack.version} sha256 ${manifest.sha256} (${manifest.bytes} B)`);
    continue;
  }
  writeFileSync(manifestPath, out);
  console.log(`✓ ${pack.version} sha256 ${manifest.sha256} (${manifest.bytes} B, 미확인 ${manifest.unverified_rule_ids.length}/${rules.length})`);
}
process.exit(failed ? 1 : 0);
