// 렌더 제공자 인터페이스. 실제 fal 구현은 [DECISION](고품질 제공자 경로·fal 클라이언트 의존성) 뒤에 이 뒤에 붙인다.
// 제공자에게 넘기는 것은 깊이·윤곽 PNG와 preset뿐이다(도면·3D 원본 없음, 01_PRD.md:265). 출력은 PNG 고정.
// 제공자 원가는 ai_usage에 기록하지 않는다(정산 경로 미정, AR-06-056 로그).
export interface RenderRequest {
  depth: Uint8Array;
  edge: Uint8Array;
  preset: Record<string, unknown>;
  /** 출력 폭·높이 상한(payload.max_px). */
  maxPx: number;
  signal: AbortSignal;
}

export interface RenderOutput {
  /** PNG 바이트. 핸들러가 서명·IHDR·크기를 다시 검사한다. */
  png: Uint8Array;
  seed: number | null;
}

export interface RenderProvider {
  /** renders.provider(40자 이내). */
  readonly name: string;
  /** renders.model(120자 이내). */
  readonly model: string;
  render(req: RenderRequest): Promise<RenderOutput>;
}
