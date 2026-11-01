// 모델러 도구 막대(03장 3.5절): [선택 V][매스 M][압출 E][측정 D][단면 S][엔벨로프 H] + 실행 취소·다시 실행 + 보기 전환.
// 열람 상태에서는 편집 도구를 숨기고(3.5절 "도구 막대 숨김") 보기 동작(측정·단면·엔벨로프·보기 전환·맞춤)만 남긴다.
// 측정 D·단면 S(AR-06-084)는 표시 전용 도구(모델 저장·실행 취소와 무관).
import { Button, Kbd, ViewCube } from "@arch-studio/ui";
import type { CameraMode, Tool } from "../state/store.ts";

export interface ToolbarProps {
  readonly editable: boolean;
  readonly tool: Tool;
  readonly hasSelection: boolean;
  readonly envelopeVisible: boolean;
  readonly camera: CameraMode;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly onTool: (t: Tool) => void;
  readonly onExtrude: () => void;
  readonly onToggleEnvelope: () => void;
  readonly onCamera: (m: CameraMode) => void;
  readonly onFit: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export function Toolbar(p: ToolbarProps) {
  return (
    <div role="toolbar" aria-label="모델러 도구" className="flex flex-wrap items-center gap-2">
      {p.editable ? (
        <>
          <div role="group" aria-label="편집 도구" className="flex flex-wrap items-center gap-1">
            <Button size="sm" icon="pointer" variant={p.tool === "select" ? "primary" : "secondary"} aria-pressed={p.tool === "select"} onClick={() => p.onTool("select")} aria-keyshortcuts="V">
              선택 <Kbd>V</Kbd>
            </Button>
            <Button size="sm" icon="pentagon" variant={p.tool === "draw" ? "primary" : "secondary"} aria-pressed={p.tool === "draw"} onClick={() => p.onTool("draw")} aria-keyshortcuts="M">
              매스 <Kbd>M</Kbd>
            </Button>
            <Button size="sm" icon="box" onClick={p.onExtrude} disabled={!p.hasSelection} aria-keyshortcuts="E" title={p.hasSelection ? "층고 칸으로 이동해 높이를 넣습니다" : "매스를 먼저 선택하세요"}>
              압출 <Kbd>E</Kbd>
            </Button>
          </div>
          <div role="group" aria-label="실행 취소" className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={p.onUndo} disabled={!p.undoLabel} aria-keyshortcuts="Control+Z" title={p.undoLabel ? `실행 취소: ${p.undoLabel}` : "되돌릴 작업이 없습니다"}>
              실행 취소
            </Button>
            <Button size="sm" variant="ghost" onClick={p.onRedo} disabled={!p.redoLabel} aria-keyshortcuts="Control+Shift+Z" title={p.redoLabel ? `다시 실행: ${p.redoLabel}` : "다시 실행할 작업이 없습니다"}>
              다시 실행
            </Button>
          </div>
        </>
      ) : null}
      {/* 측정·단면은 표시 전용이라 열람 모드에서도 보인다(모델을 바꾸지 않음). */}
      <div role="group" aria-label="측정·단면" className="flex flex-wrap items-center gap-1">
        <Button size="sm" icon="ruler" variant={p.tool === "measure" ? "primary" : "secondary"} aria-pressed={p.tool === "measure"} onClick={() => p.onTool(p.tool === "measure" ? "select" : "measure")} aria-keyshortcuts="D" title="두 점 거리·수평·높이차(화면 표시만, 저장 안 함)">
          측정 <Kbd>D</Kbd>
        </Button>
        <Button size="sm" icon="section" variant={p.tool === "section" ? "primary" : "secondary"} aria-pressed={p.tool === "section"} onClick={() => p.onTool(p.tool === "section" ? "select" : "section")} aria-keyshortcuts="S" title="수직 단면선으로 잘라 보기(화면 표시만, 저장 안 함)">
          단면 <Kbd>S</Kbd>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" icon={p.envelopeVisible ? "eye" : "eye-off"} aria-pressed={p.envelopeVisible} onClick={p.onToggleEnvelope} aria-keyshortcuts="H">
          엔벨로프 <Kbd>H</Kbd>
        </Button>
        <Button size="sm" variant="ghost" onClick={p.onFit} aria-keyshortcuts="F" title="보기를 장면에 맞춥니다">
          맞춤 <Kbd>F</Kbd>
        </Button>
        <ViewCube value={p.camera} onChange={p.onCamera} />
      </div>
    </div>
  );
}
