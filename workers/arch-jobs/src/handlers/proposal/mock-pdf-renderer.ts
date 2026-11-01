// 개발·테스트 전용 모의 PDF 렌더러: 외부 호출 없이 빈 A4 1쪽짜리 유효한 PDF를 만든다(결정적: 같은 HTML → 같은 바이트).
// 문서 정보 /Subject에 HTML의 sha256을 넣어 어떤 HTML로 만들었는지 추적만 한다(본문 렌더는 하지 않음). 선택은 src/config.ts가 development·test에서만.
import { createHash } from "node:crypto";
import type { PdfRenderer } from "./pdf-renderer.ts";

export function mockPdfBytes(html: string): Uint8Array {
  const digest = createHash("sha256").update(html, "utf8").digest("hex");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    `<< /Producer (arch-jobs mock-pdf-v1) /Subject (sha256:${digest}) >>`,
  ];
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out); // 모두 ASCII → 문자 수 = 바이트 수(오프셋 정확)
}

export function mockPdfRenderer(): PdfRenderer {
  return {
    name: "mock",
    async render(req) {
      if (req.signal.aborted) throw req.signal.reason;
      return { pdf: mockPdfBytes(req.html), pages: 1 };
    },
  };
}
