// ESLint flat config (모노레포 공용). 경로별 import 제한은 02_ARCHITECTURE.md 2장 모듈 경계를 따른다.
// no-restricted-imports·no-restricted-syntax는 뒤 설정이 앞 설정을 덮어쓰므로(옵션 병합 없음) 영역마다 허용 묶음을 계산해 한 번에 건다.
// 묶음은 import 금지(group/regex + 동적 import()용 source)나 구문 금지(syntax 선택자 목록) 중 하나 또는 둘 다를 가진다.
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
  // 테스트 더블(@arch-studio/shell-bridge/testing, src/testing, src/test-helpers)은 *.test.ts(x)에서만 허용한다.
  // 이름이 testing인 다른 폴더도 같이 막힌다(과잉 차단은 의도: 새 폴더는 이름을 바꾸거나 여기를 고친다).
  testDouble: {
    group: ["**/testing", "**/testing/**", "**/test-helpers", "**/test-helpers.*"],
    source: "/(^|\\u002F)(testing|test-helpers)($|\\u002F|\\.)/",
    message: "테스트 더블(testing·test-helpers)은 *.test.ts(x)에서만 import한다. 프로덕션 코드에서 쓰면 릴리스에 Mock이 남는다.",
  },
  // 화면·기능 코드는 플랫폼 이름을 직접 검사하지 않고 capabilities로만 분기한다(ADR-001 2.1, AR-06-070).
  // 플랫폼 판정은 shell-bridge 팩토리(createPlatformAdapters·createNativeBridge) 한 곳이라 shell-bridge 영역만 이 묶음을 뺀다.
  // 잡는 모양: `platform|runtime|shell`(변수·속성) ==/!=/===/!== 'web|browser|tauri|desktop|native|installed'(양쪽 순서),
  // 같은 값을 case로 가진 switch, Tauri 전역(`__TAURI__`·`__TAURI_INTERNALS__`·`isTauri`) 직접 참조.
  platform: {
    syntax: (() => {
      const name = "/^(platform|runtime|shell)$/i";
      const value = "/^(web|browser|tauri|desktop|native|installed)$/i";
      const eq = "BinaryExpression[operator=/^[!=]==?$/]";
      return [
        `${eq}[left.name=${name}][right.value=${value}]`,
        `${eq}[left.property.name=${name}][right.value=${value}]`,
        `${eq}[right.name=${name}][left.value=${value}]`,
        `${eq}[right.property.name=${name}][left.value=${value}]`,
        `SwitchStatement[discriminant.name=${name}]:has(SwitchCase[test.value=${value}])`,
        `SwitchStatement[discriminant.property.name=${name}]:has(SwitchCase[test.value=${value}])`,
        "Identifier[name=/^__TAURI(_INTERNALS|_METADATA)?__$/]",
        "Literal[value=/^__TAURI(_INTERNALS|_METADATA)?__$/]",
        "MemberExpression[property.name='isTauri']",
      ];
    })(),
    message: "플랫폼 이름을 직접 검사하지 않는다. @arch-studio/shell-bridge의 capabilities(hasCapability 등)로 분기한다(ADR-001 2.1).",
  },
};

const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx"];

/**
 * 영역 하나 = 프로덕션 설정 + 테스트 파일 설정. 테스트 파일은 같은 영역의 금지에서 testDouble만 빠진다.
 * 뒤 설정이 앞 설정을 덮어쓰므로 테스트 설정은 영역 설정 바로 뒤에 둔다(flat config의 중첩 배열 = AND).
 */
function area(files, names, extraSyntax = [], extraRules = {}) {
  const testFiles = files ? files.flatMap((f) => TEST_FILES.map((t) => [f, t])) : TEST_FILES;
  return [
    { ...(files ? { files } : {}), rules: { ...extraRules, ...restrict([...names, "testDouble"], extraSyntax) } },
    { files: testFiles, rules: restrict(names, extraSyntax) },
  ];
}

/** 영역별 금지 묶음 → no-restricted-imports + no-restricted-syntax(동적 import()·구문 금지). */
function restrict(names, extraSyntax = []) {
  const picked = names.map((name) => RESTRICTIONS[name]);
  const imports = picked.filter(({ group, regex }) => group || regex);
  return {
    "no-restricted-imports": [
      "error",
      { patterns: imports.map(({ group, regex, message }) => (regex ? { regex, message } : { group, message })) },
    ],
    "no-restricted-syntax": [
      "error",
      ...imports.map(({ source, message }) => ({ selector: `ImportExpression[source.value=${source}]`, message })),
      ...picked.flatMap(({ syntax = [], message }) => syntax.map((selector) => ({ selector, message }))),
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
  { plugins: { arch: { rules: { "no-service-client": serviceClientRule } } } },
  ...area(undefined, ["tauri", "three", "spikes", "platform"], [], { "arch/no-service-client": "error" }),
  ...area(WEB_SERVER, ["tauri", "three", "spikes", "platform"], NO_REEXPORT, { "arch/no-service-client": "off" }),
  // shell-bridge는 플랫폼 판정을 하는 유일한 곳이라 platform 묶음을 뺀다.
  ...area(SHELL_BRIDGE, ["three", "spikes"]),
  ...area(THREE_ALLOWED, ["tauri", "spikes", "platform"]),
  // 엔진은 결정적 순수 함수만: 시간·난수·네트워크·환경 변수·타이머·Node I/O 금지(.claude/rules/engine.md).
  ...area(ENGINE, ["tauri", "three", "spikes", "node", "platform"]),
  {
    files: ENGINE,
    rules: {
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
