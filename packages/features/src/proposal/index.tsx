// `/projects/:id/proposal` 제안서 PDF(03장 3.10절, 2.5절). 소유: AR-06-032. 로그인 필수. 권리 키는 ADR-001 4.7 표에 없어 032가 확정한다.
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="제안서"
      spec="03장 3.10절"
      owner="AR-06-032"
      empty={{ title: "제안서에 넣을 시트가 없습니다", description: "도면 화면에서 시트를 먼저 만드세요." }}
    />
  );
}
