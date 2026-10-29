// `/credits` 잔액·사용 내역·팩 구매(03장 3.17절). 소유: AR-06-044. 구매는 시스템 브라우저(/pricing#credits). 금액·크레딧은 정수.
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="크레딧"
      spec="03장 3.17절"
      owner="AR-06-044"
      empty={{ title: "아직 사용 내역이 없습니다", description: "도면 출력은 크레딧을 쓰지 않습니다." }}
    />
  );
}
