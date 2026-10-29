// `/projects/:id/site` 대지(03장 3.4절, 2.2·2.4절). 소유: AR-06-035. 열린 프로젝트는 useProject(), 대지 조회는 useApi()(`POST /api/site/lookup`),
// DXF 가져오기는 useAdapters().files.openImport("dxf")(20MB 상한은 어댑터가 읽기 전에 강제).
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="대지"
      spec="03장 3.4절"
      owner="AR-06-035"
      empty={{ title: "대지가 없습니다", description: "주소나 지번을 넣으면 대지 경계와 용도지역을 불러옵니다. [직접 그리기] [DXF에서 가져오기]" }}
    />
  );
}
