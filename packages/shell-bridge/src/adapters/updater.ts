// Updater: 설치형 앱 업데이트(ADR-001 2.1, Tauri updater 서명 검증). 웹은 없음(배포 즉시 반영) → `PlatformAdapters.updater = null`.
// `updater !== null` ⇔ `capabilities.autoUpdate`. 구현(updater 플러그인·명령)은 updater 작업 몫이며 그 전까지 설치형도 null이다.
// 실패는 BridgeError(UpdaterErrorCode). 서명 불일치(UPDATE_SIGNATURE)면 설치하지 않는다.

export interface UpdateInfo {
  /** 새 버전(semver). */
  readonly version: string;
  /** 배포일(ISO 8601). 없으면 null. */
  readonly date: string | null;
  /** 릴리스 노트(평문). 없으면 null. */
  readonly notes: string | null;
}

export interface Updater {
  /** 새 버전이 있으면 정보, 없으면 null. */
  check(): Promise<UpdateInfo | null>;
  /** `check`로 찾은 버전을 내려받아 서명 검증 후 설치한다. 재시작은 화면이 사용자에게 묻는다. */
  downloadAndInstall(): Promise<void>;
}
