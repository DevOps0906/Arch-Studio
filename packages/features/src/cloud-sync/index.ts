// 설치형 로컬 ↔ 클라우드 수동 업로드·내려받기(AR-06-077). 화면은 이 모듈의 CloudSync 결과(kind)로 분기한다.
export {
  CloudSync,
  CONFLICT_CHOICES,
  CONFLICT_MESSAGE,
  OFFLINE_COPY_LABEL,
  OFFLINE_NOTICE,
  type CloudOpenResult,
  type CloudSyncDeps,
  type ConflictChoice,
  type SyncOutcome,
} from "./sync.ts";
