// 스파이크(버리는 코드): 지오메트리 워커 클라이언트. new URL(…, import.meta.url) 모듈 워커 — Vite가 별도 파일로 내보낸다(blob: 없음).
export type Msg = { op: string; [k: string]: unknown };

export class GeomWorker {
  readonly w: Worker;
  private waiters = new Map<string, ((m: Msg) => void)[]>();
  onDrag: ((m: Msg) => void) | null = null;
  errors: string[] = [];

  constructor() {
    this.w = new Worker(new URL("./geom/geom.worker.ts", import.meta.url), { type: "module" });
    this.w.onmessage = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      if (m.op === "error") {
        this.errors.push(String(m.detail));
        console.error("worker", m.detail, m.stack);
        // 대기 중인 요청을 모두 깨운다(실패를 성공처럼 두지 않는다)
        for (const [, list] of this.waiters) for (const f of list) f(m);
        this.waiters.clear();
        return;
      }
      if (m.op === "drag" && this.onDrag) {
        this.onDrag(m);
        return;
      }
      const list = this.waiters.get(m.op);
      const f = list?.shift();
      if (f) f(m);
    };
    this.w.onerror = (e) => this.errors.push(`worker onerror: ${e.message}`);
  }

  request<T extends Msg>(msg: Msg, transfer: Transferable[] = []): Promise<T> {
    return new Promise((resolve) => {
      const list = this.waiters.get(msg.op) ?? [];
      list.push(resolve as (m: Msg) => void);
      this.waiters.set(msg.op, list);
      this.w.postMessage(msg, transfer);
    });
  }

  post(msg: Msg, transfer: Transferable[] = []) {
    this.w.postMessage(msg, transfer);
  }
}
