import type { ReactNode } from "react";
import { Shell } from "../(marketing)/_components/Shell.tsx";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
