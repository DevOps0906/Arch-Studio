// 테스트 공용: 영속 웹 스토리지 감시와 console 수집. 테스트 파일에서만 import한다(루트 index 미포함).
import { inspect } from "node:util";

export const TOKEN = "eyJhbGciOiJIUzI1NiJ9.SECRET-TOKEN-VALUE.sig";

export interface StorageSpy {
  writes: string[];
  restore(): void;
}

const STORAGE_GLOBALS = ["local" + "Storage", "session" + "Storage", "indexed" + "DB"] as const;

/** 영속 저장소 전역 3종을 기록용 가짜로 바꾼다. 쓰기·열기 시도는 `writes`에 남는다. */
export function spyWebStorage(): StorageSpy {
  const writes: string[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = STORAGE_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(g, name)] as const);
  for (const name of STORAGE_GLOBALS) {
    const fake = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "getItem") return () => null;
          if (prop === "length") return 0;
          return (...args: unknown[]) => {
            writes.push(`${name}.${String(prop)}(${args.map(String).join(",")})`);
            return null;
          };
        },
      },
    );
    Object.defineProperty(g, name, { value: fake, configurable: true, writable: true });
  }
  return {
    writes,
    restore() {
      for (const [name, desc] of saved) {
        if (desc) Object.defineProperty(g, name, desc);
        else delete g[name];
      }
    },
  };
}

export interface ConsoleSpy {
  text(): string;
  restore(): void;
}

/** console.* 출력 전부를 모은다(토큰 누출 검사). */
export function spyConsole(): ConsoleSpy {
  const lines: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  const saved = methods.map((m) => [m, console[m]] as const);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 5 }))).join(" "));
    };
  }
  return {
    text: () => lines.join("\n"),
    restore() {
      for (const [m, fn] of saved) console[m] = fn;
    },
  };
}

/** 오류 객체의 모든 표면(message·stack·JSON·inspect). */
export function errorSurface(err: unknown): string {
  const e = err as Error;
  return [String(e), e?.message, e?.stack, JSON.stringify(e), inspect(e, { depth: 5 })].join("\n");
}
