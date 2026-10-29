// features 자체 타입 검사용 최소 선언(데스크톱 앱은 vite/client 선언을 쓴다). Vite가 빌드 때 아래 값을 글자 그대로 치환한다.
// 이 파일은 features tsconfig에서만 포함된다(앱은 import하지 않으므로 vite/client와 겹치지 않는다).
interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
