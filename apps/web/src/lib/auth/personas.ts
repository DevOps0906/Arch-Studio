// Mock 페르소나(Stage A). 정본 데이터는 scripts/dev/personas.arch.json이고 personas.test.ts가 키·라벨 일치를 검사한다.
// 화면에는 키·라벨만 내려 보내고, 이메일은 서버(dev-login)에서만 만든다. 비밀번호는 env(DEV_SEED_PASSWORD)뿐.

export const MOCK_PERSONAS = [
  { key: "owner", label: "소유자(체험 중)" },
  { key: "admin", label: "관리자(owner 조직)" },
  { key: "member", label: "구성원(owner 조직)" },
  { key: "viewer", label: "열람자(owner 조직)" },
  { key: "outsider", label: "다른 조직 사용자" },
  { key: "no_app", label: "앱 메타데이터 없이 가입" },
  { key: "suspended", label: "정지된 계정" },
  { key: "ops", label: "운영자" },
  { key: "trial_expired", label: "체험 만료(라이선스 없음)" },
  { key: "perpetual", label: "영구 + 업데이트 유효" },
  { key: "perpetual_fallback", label: "영구 + 업데이트 만료(폴백)" },
  { key: "sub_active", label: "월 구독 활성" },
  { key: "sub_expired", label: "월 구독 만료(라이선스 없음)" },
] as const;

export type MockPersonaKey = (typeof MOCK_PERSONAS)[number]["key"];

const KEYS: ReadonlySet<string> = new Set(MOCK_PERSONAS.map((p) => p.key));

export function isMockPersonaKey(value: unknown): value is MockPersonaKey {
  return typeof value === "string" && KEYS.has(value);
}

/** 시드 계정 이메일(예약 TLD .test). 서버 전용 경로에서만 부른다. */
export function mockPersonaEmail(key: MockPersonaKey): string {
  return `${key}@dev.test`;
}
