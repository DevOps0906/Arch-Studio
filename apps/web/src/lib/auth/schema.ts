// 코어·제품 스키마 이름(모놀리스 public, 모듈러 core·arch). SUPABASE_DB_SCHEMA 값은 env 스키마가 검증한다.
export function coreSchema(): "core" | "public" {
  return process.env.SUPABASE_DB_SCHEMA === "core" ? "core" : "public";
}

export function archSchema(): "arch" | "public" {
  return coreSchema() === "core" ? "arch" : "public";
}
