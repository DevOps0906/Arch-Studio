// 채팅 원장 조회 Supabase 구현: 일일 상한은 차감 행만 센다(환불로 빼지 않음), find는 actor·환불 여부를 돌려준다. 클라이언트는 가짜.
import assert from "node:assert/strict";
import { test } from "node:test";
import { supabaseChatLedger } from "./supabase-repo.ts";

type Filters = [string, unknown][];

function fakeClient(rows: { select?: unknown; count?: number }) {
  const calls: { select: string; filters: Filters }[] = [];
  const builder = (select: string) => {
    const filters: Filters = [];
    calls.push({ select, filters });
    const b = {
      eq(col: string, v: unknown) {
        filters.push([col, v]);
        return b;
      },
      gte(col: string, v: unknown) {
        filters.push([`${col}>=`, v]);
        return b;
      },
      async maybeSingle() {
        return { data: rows.select ?? null, error: null };
      },
      then(resolve: (v: { count: number; error: null }) => void) {
        resolve({ count: rows.count ?? 0, error: null });
      },
    };
    return b;
  };
  const client = { schema: () => ({ from: () => ({ select: (cols: string) => builder(cols) }) }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 최소 가짜
  return { client: client as any, calls };
}

const SCHEMAS = { core: "core", arch: "arch" };

test("countSince: 차감(consume) 행만 센다 — 환불 행으로 빼지 않음", async () => {
  const f = fakeClient({ count: 7 });
  const n = await supabaseChatLedger(f.client, SCHEMAS).countSince("org", "2026-11-01T15:00:00.000Z");
  assert.equal(n, 7);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(
    f.calls[0]!.filters.find(([c]) => c === "entry_type"),
    ["entry_type", "consume"],
  );
});

test("find: actor_id와 refund_of 환불 행 존재 여부", async () => {
  const f = fakeClient({ select: { id: 100, actor_id: "u1" }, count: 1 });
  const got = await supabaseChatLedger(f.client, SCHEMAS).find("chat:org:rid");
  assert.deepEqual(got, { ledgerId: "100", actorId: "u1", refunded: true });
  assert.deepEqual(f.calls[1]!.filters, [["refund_of", 100]]);
});
