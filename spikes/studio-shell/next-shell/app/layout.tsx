import { connection } from "next/server";
import type { ReactNode } from "react";

export default async function RootLayout({ children }: { children: ReactNode }) {
  // SPIKE_NONCE=1 빌드: nonce CSP를 쓰려면 모든 페이지가 요청 시 렌더여야 한다(정적 HTML에는 nonce를 넣을 수 없음).
  if (process.env.SPIKE_NONCE === "1") await connection();
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
