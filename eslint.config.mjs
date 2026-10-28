// ESLint flat config (모노레포 공용). 경로별 import 제한은 02_ARCHITECTURE.md 2장 모듈 경계를 따른다.
// no-restricted-imports·no-restricted-syntax는 뒤 설정이 앞 설정을 덮어쓰므로(옵션 병합 없음) 영역마다 허용 묶음을 계산해 한 번에 건다.
import path from "node:path";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

const ROOT = import.meta.dirname;
const WEB_SRC = path.join(ROOT, "apps/web/src");
const SERVICE_MODULE = path.join(WEB_SRC, "server/supabase/service");

// 정적 import(no-restricted-imports)와 동적 import()(no-restricted-syntax)를 같은 묶음으로 막는다.
const RESTRICTIONS = {
  tauri: {
    group: ["@tauri-apps/*"],
    source: "/^@tauri-apps\\u002F/",
    message: "Tauri API는 packages/shell-bridge 안에서만 import한다.",
  },
  three: {
    group: ["three", "three/*", "@react-three/*"],
    source: "/^(three($|\\u002F)|@react-three\\u002F)/",
    message: "three.js는 apps/web/src/components/hero3d/**와 packages/features/src/modeler/**에서만 import한다.",
  },
  spikes: {
    regex: "(^|/)spikes/",
    source: "/(^|\\u002F)spikes\\u002F/",
    message: "spikes/*는 버리는 코드라 import하지 않는다.",
  },
  node: {
    group: ["node:*", "fs", "fs/*", "child_process"],
    source: "/^(node:|fs($|\\u002F)|child_process$)/",
    message: "엔진은 Node 내장 모듈(I/O·프로세스)을 쓰지 않는다.",
  },
};

/** 영역별 금지 묶음 → no-restricted-imports + 동적 import()용 no-restricted-syntax. */
function restrict(names, extraSyntax = []) {
  const picked = names.map((name) => RESTRICTIONS[name]);
  return {
    "no-restricted-imports": [
      "error",
      { patterns: picked.map(({ group, regex, message }) => (regex ? { regex, message } : { group, message })) },
    ],
    "no-restricted-syntax": [
      "error",
      ...picked.map(({ source, message }) => ({ selector: `ImportExpression[source.value=${source}]`, message })),
      ...extraSyntax,
    ],
  };
}

/** import 경로를 실제 파일 위치로 정규화해 service_role 모듈을 가리키면 보고한다(`..` 섞기 우회 차단). */
const serviceClientRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const filename = context.filename;
    function check(node, source) {
      if (!source || source.type !== "Literal" || typeof source.value !== "string") return;
      const spec = source.value;
      let resolved;
      if (spec.startsWith("@/")) resolved = path.join(WEB_SRC, spec.slice(2));
      else if (spec.startsWith(".")) resolved = path.resolve(path.dirname(filename), spec);
      else return;
      resolved = resolved.replace(/\.(ts|tsx|js|mjs)$/, "").replace(/[\\/]index$/, "");
      if (path.normalize(resolved) === SERVICE_MODULE) {
        context.report({ node, message: "service_role 클라이언트는 apps/web/src/server/** 안에서만 import한다." });
      }
    }
    return {
      ImportDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
    };
  },
};

const NO_REEXPORT = [
  { selector: "ExportAllDeclaration", message: "src/server/**는 barrel 재수출을 하지 않는다(service 클라이언트 우회 방지)." },
  { selector: "ExportNamedDeclaration[source]", message: "src/server/**는 barrel 재수출을 하지 않는다(service 클라이언트 우회 방지)." },
];

const WEB_SERVER = ["apps/web/src/server/**"];
const SHELL_BRIDGE = ["packages/shell-bridge/**"];
const THREE_ALLOWED = ["apps/web/src/components/hero3d/**", "packages/features/src/modeler/**"];
const ENGINE = ["domain", "geometry", "rules", "program", "massing", "layout", "drafting", "io"].map(
  (name) => `packages/${name}/**`,
);

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "spikes/**", "**/next-env.d.ts"],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { arch: { rules: { "no-service-client": serviceClientRule } } },
    rules: { "arch/no-service-client": "error", ...restrict(["tauri", "three", "spikes"]) },
  },
  {
    files: WEB_SERVER,
    rules: { "arch/no-service-client": "off", ...restrict(["tauri", "three", "spikes"], NO_REEXPORT) },
  },
  { files: SHELL_BRIDGE, rules: restrict(["three", "spikes"]) },
  { files: THREE_ALLOWED, rules: restrict(["tauri", "spikes"]) },
  {
    // 엔진은 결정적 순수 함수만: 시간·난수·네트워크·환경 변수·타이머·Node I/O 금지(.claude/rules/engine.md).
    files: ENGINE,
    rules: {
      ...restrict(["tauri", "three", "spikes", "node"]),
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "엔진은 시간을 읽지 않는다. 필요한 값은 입력으로 받는다." },
        { name: "fetch", message: "엔진은 I/O를 하지 않는다." },
        { name: "setTimeout", message: "엔진은 타이머를 쓰지 않는다." },
        { name: "setInterval", message: "엔진은 타이머를 쓰지 않는다." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "엔진은 난수를 쓰지 않는다(결정성)." },
        { object: "crypto", property: "randomUUID", message: "엔진은 난수를 쓰지 않는다(결정성)." },
        { object: "crypto", property: "getRandomValues", message: "엔진은 난수를 쓰지 않는다(결정성)." },
        { object: "performance", property: "now", message: "엔진은 시간을 읽지 않는다." },
        { object: "process", property: "env", message: "엔진은 환경 변수를 읽지 않는다." },
        { object: "globalThis", property: "fetch", message: "엔진은 I/O를 하지 않는다." },
        { object: "globalThis", property: "Date", message: "엔진은 시간을 읽지 않는다." },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // App Router만 쓴다(pages/ 없음).
      "@next/next/no-html-link-for-pages": "off",
    },
  },
);
