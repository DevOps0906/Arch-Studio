import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// features/·rr-adapter/ 가 next-shell 밖(모노레포의 packages/features 와 같은 위치 관계)이라 루트를 스파이크 폴더로 둔다.
const spikeRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: spikeRoot },
  outputFileTracingRoot: spikeRoot,
};

export default nextConfig;
