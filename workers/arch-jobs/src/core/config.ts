// 환경 변수 → 설정. 비밀(service_role·워커 키)은 env로만 받고 값은 로그에 쓰지 않는다(마스킹 목록에 넣는다).
export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  webUrl: string;
  workerKey: string;
  workerId: string;
  concurrency: number;
  retryDelaySeconds: number;
  heartbeatMs: number;
  idleMinMs: number;
  idleMaxMs: number;
}

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ARCH_WEB_URL", "ARCH_WORKER_INTERNAL_KEY"] as const;

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>, defaultWorkerId: string): WorkerConfig {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`missing env: ${missing.join(", ")}`);
  return {
    supabaseUrl: env["SUPABASE_URL"] as string,
    serviceRoleKey: env["SUPABASE_SERVICE_ROLE_KEY"] as string,
    webUrl: env["ARCH_WEB_URL"] as string,
    workerKey: env["ARCH_WORKER_INTERNAL_KEY"] as string,
    workerId: env["WORKER_ID"] || defaultWorkerId,
    concurrency: positiveInt(env["WORKER_CONCURRENCY"], 4, "WORKER_CONCURRENCY"), // 02장 배포 표: 동시 4(제안)
    retryDelaySeconds: 60, // fail_job 기본값과 같다(지수 백오프 기준)
    heartbeatMs: 30_000, // reap 기준 600초보다 충분히 짧게
    idleMinMs: 1_000,
    idleMaxMs: 15_000,
  };
}

export function secretsOf(config: WorkerConfig): string[] {
  return [config.serviceRoleKey, config.workerKey];
}
