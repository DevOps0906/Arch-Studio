// `/projects/:id/model` 모델러 + 판정 패널(03장 3.5절, 2.2절). 소유: AR-06-036(modeler/**, suggest/ 제외).
// 함께 쓰는 폴더: 판정 패널 features/src/judgment/**(AR-06-037), 매스 자동 제안 modeler/suggest/**(AR-06-028).
// three.js·R3F import는 이 폴더에서만 허용(eslint `three` 묶음). 판정은 useEngine()(017 judge 레인, 최신만 유효)으로만 요청한다.
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="모델·판정"
      spec="03장 3.5절"
      owner="AR-06-036 (판정 패널 AR-06-037)"
      empty={{ title: "매스가 없습니다", description: "엔벨로프 안에 매스를 그리면 판정이 시작됩니다. [매스 그리기 M] [자동 제안]" }}
    />
  );
}
