// `/projects/:id/render` AI 렌더(03장 3.9절, 2.5절). 소유: AR-06-056. 로그인 필수, 권리 ai_render. 호출은 useApi()(멱등 키 필수).
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="렌더"
      spec="03장 3.9절"
      owner="AR-06-056"
      feature="ai_render"
      lockTitle="AI 렌더를 쓸 수 없습니다"
      empty={{ title: "렌더가 없습니다", description: "모델러 시점으로 첫 렌더를 만들어 보세요. 표준 3 크레딧입니다." }}
    />
  );
}
