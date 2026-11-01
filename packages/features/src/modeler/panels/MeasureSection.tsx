// 측정 목록·단면 조작 줄(03장 3.5절, AR-06-084). 3D 캔버스는 aria-hidden이라 이 글자 목록이 측정값·단면의 키보드·스크린리더 경로다.
// 둘 다 화면 표시 상태: 저장·실행 취소와 무관하다.
import { Button, IconButton, Kbd } from "@arch-studio/ui";
import { measureDistance, measureText, type Measurement, type Point3 } from "../tools/measure.ts";
import { sectionText, type SectionLine } from "../tools/section.ts";

export interface MeasureListProps {
  readonly measures: readonly Measurement[];
  readonly start: Point3 | null;
  readonly active: boolean;
  readonly onDelete: (id: number) => void;
  readonly onClear: () => void;
}

export function MeasureList(p: MeasureListProps) {
  if (!p.active && p.measures.length === 0) return null;
  return (
    <div role="group" aria-label="측정" className="flex flex-col gap-1">
      {p.active ? (
        <p className="text-caption text-fg-2">
          {p.start ? "두 번째 점을 찍으세요." : "첫 점을 찍으세요."} 꼭짓점·변에 붙고, 그 밖은 바닥 100mm 격자입니다. <Kbd>Esc</Kbd> 취소·끝내기, <Kbd>Delete</Kbd> 마지막 측정 지우기. 화면 표시만 하며 저장하지 않습니다.
        </p>
      ) : null}
      {p.measures.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <ul aria-label="측정 결과" className="flex min-w-0 flex-wrap items-center gap-1">
            {p.measures.map((m) => (
              <li key={m.id} className="flex items-center gap-1 rounded-control border border-line bg-surface pl-2 text-caption text-fg">
                <span className="text-num">
                  {m.id}. {measureText(measureDistance(m.a, m.b))}
                </span>
                <IconButton size="sm" icon="x" label={`측정 ${m.id} 지우기`} onClick={() => p.onDelete(m.id)} />
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" onClick={p.onClear}>
            측정 모두 지우기
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface SectionControlsProps {
  readonly section: SectionLine | null;
  readonly draft: boolean;
  readonly active: boolean;
  readonly view: boolean;
  readonly onPreset: () => void;
  readonly onView: (on: boolean) => void;
  readonly onClear: () => void;
}

export function SectionControls(p: SectionControlsProps) {
  if (!p.active && !p.section) return null;
  return (
    <div role="group" aria-label="단면" className="flex flex-col gap-1">
      {p.active ? (
        <p className="text-caption text-fg-2">
          {p.draft ? "단면선 두 번째 점을 찍으세요." : "평면에서 두 점을 찍어 수직 단면선을 정합니다(100mm 격자)."} 선의 오른쪽을 잘라 냅니다. <Kbd>Esc</Kbd> 취소·끝내기. 화면 표시만 하며 시트 단면선과 별개입니다.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" icon="section" onClick={p.onPreset}>
          정북 단면으로 자르기
        </Button>
        {p.section ? (
          <>
            <span className="text-caption text-fg-2 text-num">단면선 {sectionText(p.section)}</span>
            <Button size="sm" variant={p.view ? "primary" : "secondary"} aria-pressed={p.view} onClick={() => p.onView(!p.view)}>
              단면 보기
            </Button>
            <Button size="sm" variant="ghost" icon="x" onClick={p.onClear}>
              단면 해제
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
