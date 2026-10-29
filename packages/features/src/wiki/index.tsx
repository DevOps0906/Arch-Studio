// `/wiki` 법규 해설 위키(03장 3.13절). 소유: AR-06-055. 전 상태 열람(폴백 포함), 로그인 필수.
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="법규 위키"
      spec="03장 3.13절"
      owner="AR-06-055"
      empty={{ title: "위키 문서가 없습니다", description: "법규 해설은 판단 근거가 아니라 학습 자료입니다." }}
    />
  );
}
