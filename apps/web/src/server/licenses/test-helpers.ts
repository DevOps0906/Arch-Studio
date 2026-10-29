// 테스트 전용 도우미(제품 코드에서 import하지 않는다). 키는 테스트마다 새로 만든다(저장소에 키 0).
import { generateKeyPairSync } from "node:crypto";

export function newEd25519Pem(): { pem: string; der64: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return {
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    der64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

/** 결정적 의사 난수(mulberry32). fast-check가 web 의존성에 없어 속성 테스트용으로 둔다. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
