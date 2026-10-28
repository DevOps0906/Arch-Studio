import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arch Studio",
  description: "건축 기획 설계 스튜디오",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
