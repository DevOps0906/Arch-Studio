// `/license` 라이선스 상태·활성화·이 PC 해제·업데이트(03장 3.16절, 2.6·2.7절). 소유: AR-06-044. GNB 아래 고정 메뉴(D-32 a).
// 시리얼 활성화는 useCapabilities().has("licenseActivation")일 때만(설치형 전용, 웹은 /account/licenses 링크).
// 주의: 설치형 EntitlementClient는 041·074 연결 전까지 실패 닫힘(view_export만 Allow, license=null)이다 — 044가 연결한다.
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="라이선스"
      spec="03장 3.16절"
      owner="AR-06-044"
      empty={{ title: "활성화한 라이선스가 없습니다", description: "앱의 라이선스 화면에서 시리얼을 입력하세요. 체험·구독은 로그인만으로 1대를 씁니다." }}
    />
  );
}
