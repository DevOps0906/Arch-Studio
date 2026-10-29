// `/projects/:id/review` 클라우드 법규 검토(03장 3.11절). 소유: AR-06-055. 권리 cloud_review(폴백은 잠금, AR012).
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="검토"
      spec="03장 3.11절"
      owner="AR-06-055"
      feature="cloud_review"
      lockTitle="클라우드 법규 검토를 쓸 수 없습니다"
      empty={{ title: "검토 결과가 없습니다", description: "현재 모델로 클라우드 법규 검토를 요청하면 근거 조항과 함께 결과를 보여 줍니다." }}
    />
  );
}
