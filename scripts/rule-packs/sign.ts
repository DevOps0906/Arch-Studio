// 규칙 팩 서명 매니페스트 만들기(AR-06-042, 운영 PC·릴리스 CI 전용). 결과 = 저장소 `rule-packs/<version>/manifest.json`에 올릴 문자열.
// 개인키는 환경 변수 RULEPACK_SIGNING_PRIVATE_KEY(Ed25519 PKCS#8 PEM)에서만 읽는다. 저장소·웹 서버·설치 파일에 두지 않는다(계획 공격 P3).
// 라이선스 서명 키(LICENSE_SIGNING_PRIVATE_KEY)와 다른 키를 쓴다(041 D1 고리 분리). 운영 키 규격은 사람 판정 C-3.
// 사용: RULEPACK_SIGNING_PRIVATE_KEY="$(cat key.pem)" node scripts/rule-packs/sign.ts <팩 폴더> --kid <kid> --published-at <RFC3339> [--out <파일>]
// DB arch.rule_packs 행에는 출력의 sig(→ signature)·kid·sha256·bytes, published_at(= --published-at)을 그대로 넣는다.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { signRulePackManifest } from "../../apps/web/src/server/rule-packs/manifest.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const kid = opt("--kid");
const publishedAt = opt("--published-at");
const key = process.env.RULEPACK_SIGNING_PRIVATE_KEY;
if (!dir || !kid || !publishedAt || !key) {
  console.error("사용: RULEPACK_SIGNING_PRIVATE_KEY=… node scripts/rule-packs/sign.ts <팩 폴더> --kid <kid> --published-at <RFC3339> [--out <파일>]");
  process.exit(2);
}
const pack = readFileSync(join(resolve(dir), "pack.json"));
const parsed = JSON.parse(pack.toString("utf8")) as { version: string; basis_date: string };
const text = signRulePackManifest({ privateKeyPem: key, kid, version: parsed.version, publishedAt, basisDate: parsed.basis_date, pack });
const out = opt("--out");
if (out) writeFileSync(out, text);
else process.stdout.write(`${text}\n`);
const { sig } = JSON.parse(text) as { sig: string };
console.error(`✓ ${parsed.version} kid ${kid} bytes ${pack.byteLength} sig ${sig.slice(0, 8)}…`);
