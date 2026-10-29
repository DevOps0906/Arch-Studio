// 자리 표시 화면 15개와 Next 방식 C(경로별 page.tsx 코드 생성)를 라우트 메타에서 만든다.
// node scripts/gen.ts  (Node 24 TS 직접 실행)
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const titles: Record<string, string> = {
  login: "로그인", onboarding: "시작하기", model: "모델", program: "프로그램", sheets: "시트", render: "렌더",
  proposal: "제안서", review: "검토", chat: "채팅", wiki: "위키", "settings-drafting": "작도 설정",
  "settings-general": "일반 설정", license: "라이선스", credits: "크레딧", "not-found": "찾을 수 없음",
};
for (const [id, title] of Object.entries(titles)) {
  writeFileSync(
    join(root, "features/screens", `${id}.tsx`),
    `import { Placeholder } from "../Placeholder.tsx";\n\nexport default function Screen() {\n  return <Placeholder title="${title}" />;\n}\n`,
  );
}

// 라우트 메타를 정규식으로 읽는다(코드 생성기는 런타임 import 대신 소스 파싱 — TSX 동적 import 회피).
const { readFileSync } = await import("node:fs");
const src = readFileSync(join(root, "features/routes.ts"), "utf8");
const routes = [...src.matchAll(/\{ id: "([^"]+)", path: "([^"]+)", load: \(\) => import\("\.\/screens\/([^"]+)"\) \}/g)].map((m) => ({
  id: m[1]!, path: m[2]!, file: m[3]!,
}));
if (routes.length !== 18) throw new Error(`라우트 18개 기대, ${routes.length}개`);

const cDir = join(root, "next-shell/app/(studio)/c");
if (existsSync(cDir)) rmSync(cDir, { recursive: true });
for (const r of routes) {
  const seg = r.path === "*" ? "[...rest]" : r.path.split("/").map((s) => (s.startsWith(":") ? `[${s.slice(1)}]` : s)).join("/");
  const dir = join(cDir, seg);
  mkdirSync(dir, { recursive: true });
  const rel = (p: string) => relative(dir, join(root, p)).replaceAll("\\", "/");
  writeFileSync(
    join(dir, "page.tsx"),
    `// 생성 파일(scripts/gen.ts). 라우트 "${r.path}"\n"use client";\nimport { Suspense } from "react";\nimport * as mod from "${rel(`features/screens/${r.file}`)}";\nimport { NativeRoute } from "${rel("next-shell/app/_studio/adapter-native.tsx")}";\n\nexport default function Page() {\n  return (\n    <Suspense fallback={null}>\n      <NativeRoute mod={mod} base="/c" />\n    </Suspense>\n  );\n}\n`,
  );
}
writeFileSync(
  join(cDir, "page.tsx"),
  `// 생성 파일. 인덱스 → 기본 경로\nimport { redirect } from "next/navigation";\n\nexport default function Page() {\n  redirect("/c/projects");\n}\n`,
);
console.log(`screens ${Object.keys(titles).length}개, Next C 페이지 ${routes.length + 1}개 생성`);
