// PDF 렌더러 인터페이스. 실제 구현 = 공용 WeasyPrint `POST /render/pdf`(private, SHARED_MODULES.md:264) —
// 소비자 app_id에 'arch' 추가(R-A5, 소유 flora-publishing) 반영 전이라 붙이지 않는다(06_AGENT_PLAN.md AR-06-032 "R-A5 반영 전 머지 보류").
// 렌더러에 넘기는 것은 워커가 조립한 HTML 한 덩어리뿐이다(외부 fetch 없음: 시트 SVG 인라인, 글꼴은 렌더러 쪽 설치 글꼴 이름만).
export interface PdfRenderRequest {
  html: string;
  signal: AbortSignal;
}

export interface PdfRenderOutput {
  pdf: Uint8Array;
  pages: number;
}

export interface PdfRenderer {
  readonly name: string;
  render(req: PdfRenderRequest): Promise<PdfRenderOutput>;
}
