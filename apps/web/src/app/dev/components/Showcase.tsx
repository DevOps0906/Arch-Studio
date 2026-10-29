"use client";
// /dev/components 본문: 03_SCREENS_UX 3.19 배리언트 전부를 테마(라이트·다크) × 밀도(기본·컴팩트)로 띄운다.
import { useState, type ReactNode } from "react";
import {
  Badge,
  Banner,
  Button,
  ChatThread,
  Checkbox,
  CreditCost,
  Dialog,
  EmptyState,
  ExportDialog,
  FallbackBanner,
  Field,
  IconButton,
  Input,
  IntakeCandidateList,
  JudgmentBadge,
  JudgmentPanel,
  Kbd,
  LayerMapTable,
  LayerPanel,
  LicenseStatusBadge,
  MeasureReadout,
  NumberInput,
  OfflineIndicator,
  Progress,
  PropertyInspector,
  RoomPolygonEditor,
  RuleCitation,
  Select,
  Sheet,
  SheetPreview,
  Skeleton,
  Switch,
  Table,
  Tabs,
  TitleBlockEditor,
  Toast,
  ToastRegion,
  ToolBar,
  Tooltip,
  ViewCube,
  VoiceButton,
  type Citation,
  type ViewMode,
} from "@arch-studio/ui";

export type Theme = "light" | "dark";
export type Density = "default" | "compact";

const CITE: Citation = { article: "건축법 시행령 제86조", effectiveDate: "2025-01-01", packVersion: "kr-2026.10" };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
      <h2 id={`${id}-h`} className="text-h2 font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function Showcase({ initialTheme, initialDensity }: { initialTheme: Theme; initialDensity: Density }) {
  const [theme, setTheme] = useState(initialTheme);
  const [density, setDensity] = useState(initialDensity);
  const [num, setNum] = useState(12000);
  const [sw, setSw] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toasts, setToasts] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("perspective");

  return (
    <div className={theme === "dark" ? "dark" : undefined} data-density={density}>
      <div className="min-h-dvh bg-bg text-fg">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-gap border-b border-line bg-nav px-pad py-2">
          <h1 className="text-display font-semibold">컴포넌트 미리보기</h1>
          <div className="flex flex-wrap items-center gap-gap">
            <Switch label="다크" checked={theme === "dark"} onChange={(v) => setTheme(v ? "dark" : "light")} />
            <Switch label="컴팩트" checked={density === "compact"} onChange={(v) => setDensity(v ? "compact" : "default")} />
            <Badge>개발 전용</Badge>
          </div>
        </header>

        <main className="mx-auto grid max-w-(--layout-max) grid-cols-1 gap-gap p-pad xl:grid-cols-2">
          <Section id="type" title="글자 크기 (3구간 토큰)">
            <p className="text-display">display 화면 제목</p>
            <p className="text-h1">h1 제목</p>
            <p className="text-h2">h2 소제목</p>
            <p className="text-body">body 본문 — 대지를 넣으면 법규 볼륨과 판정이 나옵니다.</p>
            <p className="text-caption text-fg-2">caption 보조 글자</p>
            <p className="text-num tabular-nums">num 12,345.00 m²</p>
          </Section>

          <Section id="button" title="Button · IconButton">
            {(["sm", "md"] as const).map((size) => (
              <Row key={size}>
                <Button size={size} variant="primary">주 버튼</Button>
                <Button size={size} variant="secondary">보조</Button>
                <Button size={size} variant="ghost">고스트</Button>
                <Button size={size} variant="danger">삭제</Button>
                <Button size={size} variant="primary" loading>저장 중</Button>
                <Button size={size} disabled>비활성</Button>
              </Row>
            ))}
            <Row>
              <IconButton icon="plus" label="추가" />
              <IconButton icon="plus" label="추가(보조)" variant="secondary" />
              <IconButton icon="eye" label="표시" pressed />
              <IconButton icon="lock" label="잠금" size="sm" />
              <IconButton icon="x" label="닫기(비활성)" disabled />
            </Row>
          </Section>

          <Section id="input" title="Input · NumberInput · Select">
            <div className="grid grid-cols-1 gap-gap md:grid-cols-2">
              <Field label="프로젝트 이름" htmlFor="f-name" hint="사무소 안에서 구분할 이름">
                <Input id="f-name" placeholder="예: 판교 단독주택" aria-describedby="f-name-hint" />
              </Field>
              <Field label="대지 지번" htmlFor="f-err" error="지번 형식이 아닙니다">
                <Input id="f-err" defaultValue="판교동 abc" invalid aria-describedby="f-err-error" />
              </Field>
              <Field label="건물 높이" htmlFor="f-num" hint="화살표 키 ±100, Shift ±1,000">
                <NumberInput id="f-num" value={num} onChange={setNum} min={0} />
              </Field>
              <Field label="여러 객체 선택 시" htmlFor="f-mixed">
                <NumberInput id="f-mixed" value={null} onChange={setNum} />
              </Field>
              <Field label="용도지역" htmlFor="f-sel">
                <Select id="f-sel" defaultValue="r1">
                  <option value="r1">제1종 일반주거지역</option>
                  <option value="r2">제2종 일반주거지역</option>
                </Select>
              </Field>
              <Field label="비활성" htmlFor="f-dis">
                <Input id="f-dis" disabled value="수정 불가" readOnly suffix="mm" />
              </Field>
            </div>
          </Section>

          <Section id="toggle" title="Checkbox · Switch · Kbd · Tooltip">
            <Row>
              <Checkbox label="정북 일조 적용" defaultChecked />
              <Checkbox label="미선택" />
              <Checkbox label="비활성" disabled />
            </Row>
            <Row>
              <Switch label="스냅" checked={sw} onChange={setSw} />
              <Switch label="비활성" checked={false} onChange={() => undefined} disabled />
            </Row>
            <Row>
              <span className="text-body">실행 취소 <Kbd>Ctrl</Kbd> <Kbd>Z</Kbd></span>
              <Tooltip content={<>도움말 <Kbd>F1</Kbd></>}>
                <Button size="sm">툴팁 (호버·포커스)</Button>
              </Tooltip>
            </Row>
          </Section>

          <Section id="badge" title="Badge · Banner">
            <Row>
              <Badge>중립</Badge>
              <Badge tone="info" icon="info">안내</Badge>
              <Badge tone="ok" icon="circle-check">완료</Badge>
              <Badge tone="warn" icon="triangle-alert">주의</Badge>
              <Badge tone="danger" icon="circle-x">오류</Badge>
              <Badge tone="envelope">엔벨로프</Badge>
            </Row>
            <Banner tone="info" title="안내">새 규칙 팩을 받을 수 있습니다.</Banner>
            <Banner tone="ok" title="저장했습니다" />
            <Banner tone="warn" title="확인이 필요한 항목 2개" action={<Button size="sm">보기</Button>} />
            <Banner tone="danger" title="도면을 만들지 못했습니다">AR052: 대지 경계가 닫혀 있지 않습니다.</Banner>
          </Section>

          <Section id="tabs" title="Tabs · Table (컴팩트)">
            <Tabs
              label="프로젝트 화면"
              items={[
                {
                  id: "list",
                  label: "목록",
                  content: (
                    <Table
                      caption="프로젝트 목록"
                      columns={[
                        { key: "name", header: "프로젝트" },
                        { key: "area", header: "대지 면적(m²)", numeric: true },
                        { key: "far", header: "용적률(%)", numeric: true },
                        { key: "state", header: "판정" },
                      ]}
                      rows={[
                        { id: "1", name: "판교 단독주택", area: "330.50", far: "98.2", state: <JudgmentBadge status="pass" /> },
                        { id: "2", name: "양평 전원주택", area: "1,204.00", far: "61.0", state: <JudgmentBadge status="warn" /> },
                        { id: "3", name: "성수 근린생활", area: "212.30", far: "251.7", state: <JudgmentBadge status="fail" /> },
                      ]}
                    />
                  ),
                },
                { id: "empty", label: "빈 상태", content: <EmptyState title="아직 프로젝트가 없습니다" description="대지 주소나 DXF로 첫 프로젝트를 만드세요." action={<Button variant="primary" icon="plus">새 프로젝트</Button>} /> },
                {
                  id: "loading",
                  label: "로딩",
                  content: (
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-row w-full" />
                      <Skeleton className="h-row w-5/6" />
                      <Skeleton className="h-row w-2/3" />
                    </div>
                  ),
                },
              ]}
            />
          </Section>

          <Section id="progress" title="Progress · Skeleton">
            <Progress label="도면 생성" value={64} />
            <Progress label="규칙 팩 확인 중" />
            <Skeleton className="h-24 w-full" />
          </Section>

          <Section id="overlay" title="Dialog · Sheet · Toast">
            <Row>
              <Button onClick={() => setDialog(true)}>Dialog 열기</Button>
              <Button onClick={() => setSheet(true)}>Sheet 열기</Button>
              <Button onClick={() => setToasts((t) => [...t, `저장했습니다 ${t.length + 1}`])}>Toast 띄우기</Button>
            </Row>
            <Toast tone="ok" title="정적 예시: 저장 완료">프로젝트를 저장했습니다.</Toast>
            <Toast tone="danger" title="정적 예시: 오류">네트워크를 확인하세요.</Toast>
            <Dialog
              open={dialog}
              onClose={() => setDialog(false)}
              title="프로젝트 삭제"
              description="삭제하면 되돌릴 수 없습니다."
              footer={
                <>
                  <Button variant="ghost" onClick={() => setDialog(false)}>취소</Button>
                  <Button variant="danger" onClick={() => setDialog(false)}>삭제</Button>
                </>
              }
            />
            <Sheet open={sheet} onClose={() => setSheet(false)} title="필터">
              <Checkbox label="판정 실패만" />
            </Sheet>
          </Section>

          <Section id="judgment" title="JudgmentBadge · RuleCitation · JudgmentPanel">
            <Row>
              <JudgmentBadge status="pass" />
              <JudgmentBadge status="warn" />
              <JudgmentBadge status="fail" />
            </Row>
            <RuleCitation {...CITE} />
            <JudgmentPanel
              items={[
                { id: "bcr", label: "건폐율", status: "pass", actual: 58, limit: 60, unit: "%", citation: { ...CITE, article: "국토계획법 시행령 제84조" } },
                { id: "far", label: "용적률", status: "warn", actual: 199, limit: 200, unit: "%", citation: { ...CITE, article: "국토계획법 시행령 제85조" } },
                { id: "sun", label: "정북 일조 이격", status: "fail", actual: 1200, limit: 1500, unit: "mm", citation: CITE },
              ]}
            />
          </Section>

          <Section id="status" title="FallbackBanner · OfflineIndicator · LicenseStatusBadge · CreditCost">
            <FallbackBanner packVersion="kr-2026.04" action={<Button size="sm">업데이트 연장</Button>} />
            <Row>
              <OfflineIndicator online />
              <OfflineIndicator online={false} />
            </Row>
            <Row>
              <LicenseStatusBadge status="active" />
              <LicenseStatusBadge status="trial" />
              <LicenseStatusBadge status="update-expired" />
              <LicenseStatusBadge status="expired" />
              <LicenseStatusBadge status="device-limit" />
            </Row>
            <CreditCost cost={120} balance={3000} />
            <CreditCost cost={120} balance={80} />
          </Section>

          <Section id="viewport" title="ToolBar · ViewCube · MeasureReadout (뷰포트 위)">
            <div className="relative aspect-video overflow-hidden rounded-panel border border-line bg-viewport">
              <div className="absolute top-2 left-2">
                <ToolBar
                  tools={[
                    { id: "select", label: "선택", icon: "pointer", shortcut: "V" },
                    { id: "measure", label: "치수", icon: "ruler", shortcut: "M" },
                    { id: "rect", label: "사각 매스", icon: "square", shortcut: "R" },
                    { id: "poly", label: "다각 매스", icon: "pentagon", shortcut: "P" },
                  ]}
                />
              </div>
              <div className="absolute top-2 right-2">
                <ViewCube value={view} onChange={setView} />
              </div>
              <MeasureReadout x={50} y={55} value={12500} />
              <MeasureReadout x={25} y={80} value={8400} label="이격" />
            </div>
          </Section>

          <Section id="panels" title="LayerPanel · PropertyInspector">
            <div className="grid grid-cols-1 gap-gap md:grid-cols-2">
              <LayerPanel
                defaultLayers={[
                  { id: "site", name: "대지", visible: true, locked: true, children: [
                    { id: "boundary", name: "대지 경계", visible: true, locked: true },
                    { id: "setback", name: "이격선", visible: true, locked: false },
                  ] },
                  { id: "mass", name: "매스", visible: true, locked: false, children: [{ id: "m1", name: "매스 1", visible: false, locked: false }] },
                  { id: "env", name: "엔벨로프", visible: true, locked: false },
                ]}
              />
              <PropertyInspector
                selectionCount={2}
                defaultGroups={[
                  { title: "크기", fields: [
                    { id: "p-w", label: "너비", value: 12000, unit: "mm" },
                    { id: "p-d", label: "깊이", value: null, unit: "mm" },
                  ] },
                  { title: "높이", fields: [
                    { id: "p-h", label: "층고", value: 3000, unit: "mm" },
                    { id: "p-f", label: "층수", value: 3, unit: "층", step: 1 },
                  ] },
                ]}
              />
            </div>
          </Section>

          <Section id="drawing" title="RoomPolygonEditor · SheetPreview">
            <RoomPolygonEditor
              name="거실"
              width={12000}
              height={8000}
              defaultPoints={[{ x: 2000, y: 1500 }, { x: 9000, y: 1500 }, { x: 9000, y: 6000 }, { x: 2000, y: 6000 }]}
            />
            <SheetPreview title="배치도" scale="1/200" sheetNo="A-101" />
          </Section>

          <Section id="export" title="ExportDialog · TitleBlockEditor · LayerMapTable">
            <Row>
              <Button variant="primary" icon="download" onClick={() => setExportOpen(true)}>내보내기 대화상자</Button>
            </Row>
            <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} cost={50} balance={3000} />
            <TitleBlockEditor
              defaultValue={{ office: "예시 건축사사무소", project: "판교 단독주택", drawing: "배치도", scale: "1/200", author: "홍길동", date: "2026-10-29" }}
            />
            <LayerMapTable
              defaultRows={[
                { id: "1", source: "대지 경계", dxfName: "A-SITE-BNDY", aci: 7, linetype: "DASHDOT" },
                { id: "2", source: "이격선", dxfName: "A-SITE-SETB", aci: 5, linetype: "DASHED" },
                { id: "3", source: "매스 외곽", dxfName: "A-MASS", aci: 8, linetype: "CONTINUOUS" },
              ]}
            />
          </Section>

          <Section id="ai" title="IntakeCandidateList · ChatThread · VoiceButton">
            <IntakeCandidateList
              items={[
                { id: "a", field: "대지 면적", value: "330.50 m²", source: "토지이용계획확인서 1쪽" },
                { id: "b", field: "용도지역", value: "제1종 일반주거지역", source: "토지이용계획확인서 1쪽" },
              ]}
            />
            <Row>
              <VoiceButton state="idle" onToggle={() => undefined} />
              <VoiceButton state="listening" onToggle={() => undefined} />
              <VoiceButton state="unavailable" onToggle={() => undefined} />
            </Row>
            <ChatThread
              messages={[
                { id: "1", role: "user", text: "정북 일조 이격 기준이 뭐예요?" },
                { id: "2", role: "assistant", text: "높이 10m 이하 부분은 정북 경계에서 1.5m 이상 띄웁니다.", citations: [CITE] },
                { id: "3", role: "assistant", text: "지구단위계획 별도 기준은 확인되지 않았습니다.", noSource: true },
              ]}
            />
          </Section>
        </main>

        <ToastRegion>
          {toasts.map((t, i) => (
            <Toast key={t} tone="ok" title={t} onClose={() => setToasts((ts) => ts.filter((_, j) => j !== i))} />
          ))}
        </ToastRegion>
      </div>
    </div>
  );
}
