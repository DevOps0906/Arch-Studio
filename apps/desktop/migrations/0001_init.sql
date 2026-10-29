-- 0001 로컬 SQLite 초기 스키마(05_DATA_MODEL.md 2.16, B 분류 11테이블).
-- 적용된 파일은 고치지 않는다. 변경은 새 번호 파일로 추가만(CREATE TABLE·CREATE INDEX·ADD COLUMN).
-- 버전은 PRAGMA user_version으로 Rust(local_db.rs)가 관리한다.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  site_label TEXT,
  client_name TEXT,
  client_contact TEXT,
  cloud_project_id TEXT,
  cloud_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS model_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  rev INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  design_model TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT,
  UNIQUE (project_id, rev)
);

CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  sheet_spec TEXT NOT NULL,
  annotation_overrides TEXT NOT NULL DEFAULT '[]',
  based_on_rev INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS judgment_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  rev INTEGER NOT NULL,
  rule_pack_version TEXT NOT NULL,
  application_date TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  sheet_ids TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('dxf', 'svg', 'pdf', 'png', 'ifc', 'gltf', '3dm')),
  engine_version TEXT NOT NULL,
  rule_pack_version TEXT,
  sha256 TEXT NOT NULL,
  path_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS render_items (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  cloud_render_id TEXT,
  local_path_hash TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  ai_label INTEGER NOT NULL DEFAULT 1,
  saved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS license_store (
  activation_id TEXT PRIMARY KEY NOT NULL,
  file TEXT NOT NULL,
  kid TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  max_issued_at_seen TEXT NOT NULL,
  stored_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_pack_cache (
  version TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL,
  signature TEXT NOT NULL,
  kid TEXT NOT NULL,
  published_at TEXT NOT NULL,
  basis_date TEXT NOT NULL,
  pack BLOB NOT NULL,
  changes_checked_at TEXT,
  pending_changes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cost_catalog_cache (
  version TEXT PRIMARY KEY NOT NULL,
  basis_date TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  items TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafting_profile_cache (
  org_id TEXT PRIMARY KEY NOT NULL,
  profile TEXT NOT NULL,
  logo BLOB,
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS model_revisions_project_rev ON model_revisions (project_id, rev DESC);
CREATE INDEX IF NOT EXISTS sheets_project ON sheets (project_id);
CREATE INDEX IF NOT EXISTS judgment_snapshots_project ON judgment_snapshots (project_id, rev);
CREATE INDEX IF NOT EXISTS exports_project ON exports (project_id);
CREATE INDEX IF NOT EXISTS render_items_project ON render_items (project_id);
