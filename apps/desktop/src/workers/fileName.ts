// 내보내기 파일 이름 규칙(04_API.md 4.7.6절): <프로젝트명>_<도면코드>_<시트번호 2자리>_1-<축척>_<YYYYMMDD>.<ext>
const CODE = { site_plan: "SP", area_plan: "AP", sunlight_section: "SS", floor_plan: "FP", elevation: "EL" } as const;
export type NamedKind = keyof typeof CODE;

/** NFC, Windows 금지 문자·제어 문자는 `_`로, 앞뒤 공백·마침표 제거. */
export function sanitize(s: string): string {
  return s.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "");
}

export function exportFileName(project: string, kind: NamedKind, index: number, scale: number, date: string, ext: string): string {
  const ymd = date.replace(/-/g, "");
  const tail = `_${CODE[kind]}_${String(index + 1).padStart(2, "0")}_1-${scale}_${ymd}.${ext}`;
  const room = Math.max(1, 120 - [...tail].length);
  const name = [...sanitize(project)].slice(0, room).join("");
  return sanitize(`${name}${tail}`);
}
