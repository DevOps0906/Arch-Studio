// 대조군: 위반 워크플로는 잡히고, 현재 저장소 워크플로는 0건.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkDir, checkWorkflow } from "./check-workflows.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const good = `name: x\non: push\npermissions: {}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${SHA} # v7\n        with:\n          persist-credentials: false\n`;

test("정상 워크플로 0건", () => assert.deepEqual(checkWorkflow("a.yml", good), []));

test("위반 5종이 잡힌다", () => {
  const bad = good
    .replace("on: push", "on: pull_request_target")
    .replace(`@${SHA}`, "@v4")
    .replace("persist-credentials: false", "fetch-depth: 0")
    .replace("permissions: {}\n", "") + "      - run: echo ${{ secrets.TOKEN }}\n";
  const e = checkWorkflow("a.yml", bad).join("\n");
  for (const k of ["pull_request_target", "SHA 고정", "persist-credentials", "최상위 permissions", "secrets 참조"]) assert.match(e, new RegExp(k));
});

test("주석 안의 secrets.·tag 는 오탐 아님", () => {
  assert.deepEqual(checkWorkflow("a.yml", good + "      # secrets.X 는 쓰지 않는다\n"), []);
});

test("현재 저장소 워크플로 0건", () => assert.deepEqual(checkDir(fileURLToPath(new URL("../../.github/workflows", import.meta.url))), []));
