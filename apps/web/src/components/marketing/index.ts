// 마케팅 컴포넌트 8종(AR-06-069, 03장 7.7절). packages/ui(데스크톱 공용)에 넣지 않는다. 모두 서버 컴포넌트.
export { AlternativesTable } from "./AlternativesTable.tsx";
export type { AlternativesRow, AlternativesTableProps, AlternativeCell, Mark, OurCell, UnfitCase } from "./AlternativesTable.tsx";
export { AssumptionTable } from "./AssumptionTable.tsx";
export type { Assumption, AssumptionTableProps } from "./AssumptionTable.tsx";
export { Callout } from "./Callout.tsx";
export type { CalloutProps } from "./Callout.tsx";
export { ContrastPair } from "./ContrastPair.tsx";
export type { ContrastPairProps, ContrastRow } from "./ContrastPair.tsx";
export { DualTimeline } from "./DualTimeline.tsx";
export type { DualTimelineProps, DualTimelineStep } from "./DualTimeline.tsx";
export { ProofLink } from "./ProofLink.tsx";
export type { ProofLinkProps } from "./ProofLink.tsx";
export { SampleTag } from "./SampleTag.tsx";
export type { SampleTagProps } from "./SampleTag.tsx";
export { SourceNote } from "./SourceNote.tsx";
export type { SourceNoteProps } from "./SourceNote.tsx";
export { MarketingRuleError } from "./rules.ts";
export type { EvidenceGrade, EvidenceId } from "./rules.ts";
