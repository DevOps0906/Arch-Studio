"use client";

import { useState } from "react";

type Status = "idle" | "done";

/** DXF 내려받기 링크. 누르면 익명 이벤트(sample_id·format)만 보내고, 기록이 실패해도 내려받기는 그대로 진행한다. */
export function DownloadButton({ sampleId, href, label }: { sampleId: string; href: string; label: string }) {
  const [status, setStatus] = useState<Status>("idle");

  function report() {
    setStatus("done");
    try {
      void fetch("/api/samples/download-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sample_id: sampleId, format: "dxf" }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // 측정 실패는 사용자에게 보이지 않는다.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <a
        href={href}
        download
        onClick={report}
        className="focus-ring inline-flex h-control w-full items-center justify-center rounded-control bg-accent-strong px-4 text-body font-semibold text-accent-strong-fg md:w-auto"
      >
        {label}
      </a>
      <p role="status" aria-live="polite" className="min-h-5 text-caption text-fg-3">
        {status === "done" ? "내려받기를 시작했습니다. 받은 파일을 쓰시던 CAD에서 열어 보세요." : ""}
      </p>
    </div>
  );
}
