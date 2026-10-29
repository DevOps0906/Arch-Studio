// 개발용 로그인 패널 props(로더와 패널이 공유, 런타임 코드 없음).
export interface DevMockPanelProps {
  /** Mock이 켜졌는지 로그인 화면에 알린다(켜지면 실제 제공자 버튼을 렌더하지 않는다, 03장 3.1절 A). */
  onAvailable(available: boolean): void;
}
