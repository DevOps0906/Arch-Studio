// job_type → 핸들러. 실제 핸들러(render·review·intake·proposal_pdf·stt)는 각 기능 작업에서 추가한다.
// 여기 없는 큐는 claim하지 않는다(집었다가 no_handler로 실패·환불시키지 않기 위해).
import type { JobHandler } from "./core/runner.ts";

export const HANDLERS: Readonly<Record<string, JobHandler>> = {};
