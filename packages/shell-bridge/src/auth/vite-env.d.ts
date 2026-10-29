// shell-bridge 자체 타입 검사용 최소 선언(데스크톱 앱은 vite/client 선언을 쓴다). Vite가 빌드 때 아래 두 값을 글자 그대로 치환한다.
interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly VITE_AUTH_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
