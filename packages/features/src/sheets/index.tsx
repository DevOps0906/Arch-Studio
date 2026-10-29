// `/projects/:id/sheets` 도면 시트·내보내기(03장 3.8절). 소유: AR-06-030. 시트는 useEngine()(017 sheet·export 레인),
// 저장은 useAdapters().files.save(format, bytes)(경로는 받지 않는다). 0 크레딧·오프라인 출력. 권리 view_export는 모든 상태에서 허용.
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="도면"
      spec="03장 3.8절"
      owner="AR-06-030"
      empty={{ title: "아직 시트가 없습니다", description: "배치도부터 만들어 보세요. [배치도 만들기]" }}
      loadingLabel="도면 생성 중"
    />
  );
}
