// `/settings/drafting` 표제란·레이어 매핑·기본 용지(03장 3.14절). 소유: AR-06-031. 저장은 owner·admin(AR042), 보기는 조직 멤버.
import { PlaceholderScreen } from "../../shell/index.ts";
import { SettingsNav } from "../SettingsNav.tsx";

export function Screen() {
  return (
    <div className="flex flex-col gap-gap">
      <SettingsNav />
      <PlaceholderScreen
        title="도면 설정"
        spec="03장 3.14절"
        owner="AR-06-031"
        empty={{ title: "표제란이 비어 있습니다", description: "사무소 이름·로고·담당자를 넣으면 모든 시트 표제란에 들어갑니다." }}
      />
    </div>
  );
}
