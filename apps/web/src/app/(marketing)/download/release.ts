export type Release = {
  version: string;
  /** ISO 8601 날짜 */
  publishedAt: string;
  platform: "windows-x64";
  sizeBytes: number;
  sha256: string;
  /** 서명된 다운로드 URL */
  downloadUrl: string;
};

/**
 * 최신 stable 릴리스. 서명 릴리스가 아직 없어서 항상 null 이다.
 * 릴리스 연동(서명 URL 발급)이 생기면 이 함수 본문만 바꾼다. 호출하는 쪽은 그대로다.
 */
export async function getLatestRelease(): Promise<Release | null> {
  return null;
}
