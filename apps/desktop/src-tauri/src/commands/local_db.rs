//! 로컬 SQLite(05_DATA_MODEL.md 2.16). 화면은 ProjectStore 계약 단위 명령
//! (list/get/save(expected_version)/delete)만 부른다. 임의 SQL·테이블 이름·경로 인자는 받지 않는다.
//! `license_store`·캐시 테이블 쓰기 명령은 두지 않는다(license.rs 등 Rust 내부 전용).
//!
//! 시작 순서: 열기(WAL·busy_timeout·quick_check) → user_version 비교 → 백업 API 스냅샷(임시→rename, 1개)
//! → 단계별 트랜잭션 마이그레이션. 스냅샷·마이그레이션이 실패하면 쓰지 않고 읽기 전용(AR061)으로 시작한다.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{code, sha256_hex, AppError};

/// 로컬 마이그레이션(apps/desktop/migrations). 순서대로, 추가만.
pub struct Migration {
    pub version: i64,
    pub file: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    file: "0001_init.sql",
    sql: include_str!("../../../migrations/0001_init.sql"),
}];

pub const DB_FILE: &str = "arch-studio.db";
pub const SNAPSHOT_DIR: &str = "backups";
pub const SNAPSHOT_FILE: &str = "pre-migrate.db";

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_NAME_CHARS: usize = 200;
const MAX_TEXT_CHARS: usize = 1000;
const MAX_DESIGN_MODEL_BYTES: usize = 64 * 1024 * 1024;
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// 시작 결과 모드.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DbMode {
    ReadWrite,
    /// 스냅샷·마이그레이션 실패 또는 앱보다 새 스키마. 쓰기는 AR061로 거부.
    ReadOnly,
}

pub struct LocalDb {
    conn: Mutex<Connection>,
    mode: DbMode,
}

/// 관리 상태. 열기 자체가 실패하면 모든 명령이 AR060을 돌려준다.
pub struct LocalDbState(pub Result<LocalDb, AppError>);

impl LocalDb {
    /// `dir`(app_data_dir)에 DB를 열고 마이그레이션한다.
    pub fn open(dir: &Path) -> Result<Self, AppError> {
        Self::open_with(dir, MIGRATIONS, |conn| snapshot(conn, dir))
    }

    pub fn open_with(
        dir: &Path,
        migrations: &[Migration],
        snapshot: impl FnOnce(&Connection) -> Result<(), AppError>,
    ) -> Result<Self, AppError> {
        std::fs::create_dir_all(dir).map_err(|e| AppError::io(code::DB_UNAVAILABLE, &e))?;
        let mut conn = open_connection(&dir.join(DB_FILE))?;
        let mode = migrate(&mut conn, migrations, snapshot);
        Ok(Self {
            conn: Mutex::new(conn),
            mode,
        })
    }

    pub fn mode(&self) -> DbMode {
        self.mode
    }

    fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T, AppError>) -> Result<T, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::new(code::DB_UNAVAILABLE, "lock"))?;
        f(&conn)
    }

    fn write<T>(
        &self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        if self.mode == DbMode::ReadOnly {
            return Err(AppError::new(code::DB_READ_ONLY, "read_only"));
        }
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::new(code::DB_UNAVAILABLE, "lock"))?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_err)?;
        let out = f(&tx)?;
        tx.commit().map_err(db_err)?;
        Ok(out)
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>, AppError> {
        self.read(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT p.id, p.name, p.site_label, p.updated_at,
                            (SELECT MAX(r.rev) FROM model_revisions r WHERE r.project_id = p.id)
                     FROM projects p WHERE p.deleted_at IS NULL
                     ORDER BY p.updated_at DESC, p.id",
                )
                .map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(ProjectSummary {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        site_label: r.get(2)?,
                        updated_at: r.get(3)?,
                        version: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    })
                })
                .map_err(db_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
        })
    }

    pub fn get_project(&self, id: &str) -> Result<Option<ProjectRecord>, AppError> {
        validate_id(id)?;
        self.read(|conn| {
            conn.query_row(
                "SELECT p.id, p.name, p.site_label, p.client_name, p.client_contact,
                        p.created_at, p.updated_at,
                        r.rev, r.schema_version, r.engine_version, r.design_model, r.sha256
                 FROM projects p
                 JOIN model_revisions r ON r.project_id = p.id
                 WHERE p.id = ?1 AND p.deleted_at IS NULL
                 ORDER BY r.rev DESC LIMIT 1",
                params![id],
                |r| {
                    Ok(ProjectRecord {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        site_label: r.get(2)?,
                        client_name: r.get(3)?,
                        client_contact: r.get(4)?,
                        created_at: r.get(5)?,
                        updated_at: r.get(6)?,
                        version: r.get(7)?,
                        schema_version: r.get(8)?,
                        engine_version: r.get(9)?,
                        design_model: r.get(10)?,
                        sha256: r.get(11)?,
                    })
                },
            )
            .optional()
            .map_err(db_err)
        })
    }

    /// 새 리비전을 덧붙인다. rev는 Rust가 올린다.
    /// `expected_version`: 새 프로젝트면 None, 기존이면 마지막으로 읽은 version.
    pub fn save_project(&self, input: &SaveProjectInput) -> Result<SaveResult, AppError> {
        input.validate()?;
        self.write(|tx| {
            let deleted: Option<Option<String>> = tx
                .query_row(
                    "SELECT deleted_at FROM projects WHERE id = ?1",
                    params![input.id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db_err)?;
            let current = current_version(tx, &input.id)?;
            let next = match (deleted, input.expected_version) {
                (None, None) => {
                    tx.execute(
                        &format!(
                            "INSERT INTO projects (id, name, site_label, client_name, client_contact, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, {NOW}, {NOW})"
                        ),
                        params![
                            input.id,
                            input.name,
                            input.site_label,
                            input.client_name,
                            input.client_contact
                        ],
                    )
                    .map_err(db_err)?;
                    1
                }
                (Some(Some(_)), _) => return Err(AppError::new(code::NOT_FOUND, "deleted")),
                (Some(None), Some(expected)) if expected == current => {
                    tx.execute(
                        &format!(
                            "UPDATE projects SET name = ?2, site_label = ?3, client_name = ?4,
                             client_contact = ?5, updated_at = {NOW} WHERE id = ?1"
                        ),
                        params![
                            input.id,
                            input.name,
                            input.site_label,
                            input.client_name,
                            input.client_contact
                        ],
                    )
                    .map_err(db_err)?;
                    current + 1
                }
                (None, Some(_)) => return Err(AppError::new(code::NOT_FOUND, "project")),
                _ => return Err(AppError::new(code::VERSION_CONFLICT, current.to_string())),
            };
            let sha256 = sha256_hex(input.design_model.as_bytes());
            tx.execute(
                &format!(
                    "INSERT INTO model_revisions
                     (id, project_id, rev, schema_version, engine_version, design_model, sha256, created_at, note)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, {NOW}, ?8)"
                ),
                params![
                    uuid::Uuid::now_v7().to_string(),
                    input.id,
                    next,
                    input.schema_version,
                    input.engine_version,
                    input.design_model,
                    sha256,
                    input.note
                ],
            )
            .map_err(db_err)?;
            Ok(SaveResult {
                version: next,
                sha256,
            })
        })
    }

    /// 소프트 삭제(`deleted_at`). version이 다르면 거부.
    pub fn delete_project(&self, id: &str, expected_version: i64) -> Result<(), AppError> {
        validate_id(id)?;
        self.write(|tx| {
            let deleted: Option<Option<String>> = tx
                .query_row(
                    "SELECT deleted_at FROM projects WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db_err)?;
            if !matches!(deleted, Some(None)) {
                return Err(AppError::new(code::NOT_FOUND, "project"));
            }
            let current = current_version(tx, id)?;
            if current != expected_version {
                return Err(AppError::new(code::VERSION_CONFLICT, current.to_string()));
            }
            tx.execute(
                &format!(
                    "UPDATE projects SET deleted_at = {NOW}, updated_at = {NOW} WHERE id = ?1"
                ),
                params![id],
            )
            .map_err(db_err)?;
            Ok(())
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub site_label: Option<String>,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub site_label: Option<String>,
    pub client_name: Option<String>,
    pub client_contact: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
    pub schema_version: i64,
    pub engine_version: String,
    /// DesignModel JSON 원문. 화면이 zod로 검증한다.
    pub design_model: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveProjectInput {
    pub id: String,
    pub name: String,
    pub site_label: Option<String>,
    pub client_name: Option<String>,
    pub client_contact: Option<String>,
    pub schema_version: i64,
    pub engine_version: String,
    pub design_model: String,
    pub note: Option<String>,
    pub expected_version: Option<i64>,
}

impl SaveProjectInput {
    fn validate(&self) -> Result<(), AppError> {
        validate_id(&self.id)?;
        let bad = |what: &str| Err(AppError::new(code::INVALID_INPUT, what));
        if self.name.trim().is_empty() || self.name.chars().count() > MAX_NAME_CHARS {
            return bad("name");
        }
        for (what, v) in [
            ("site_label", &self.site_label),
            ("client_name", &self.client_name),
            ("client_contact", &self.client_contact),
            ("note", &self.note),
        ] {
            if v.as_ref()
                .is_some_and(|s| s.chars().count() > MAX_TEXT_CHARS)
            {
                return bad(what);
            }
        }
        if self.schema_version < 1 {
            return bad("schema_version");
        }
        if self.engine_version.trim().is_empty() || self.engine_version.len() > 64 {
            return bad("engine_version");
        }
        if self.design_model.len() > MAX_DESIGN_MODEL_BYTES {
            return bad("design_model_size");
        }
        match serde_json::from_str::<serde_json::Value>(&self.design_model) {
            Ok(v) if v.is_object() => {}
            _ => return bad("design_model_json"),
        }
        if self.expected_version.is_some_and(|v| v < 1) {
            return bad("expected_version");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub version: i64,
    pub sha256: String,
}

/// 프로젝트 id는 UUIDv7 소문자 하이픈 형식만(대소문자 다른 같은 id가 두 행이 되지 않게).
fn validate_id(id: &str) -> Result<(), AppError> {
    match uuid::Uuid::try_parse(id) {
        Ok(u) if u.get_version_num() == 7 && id.len() == 36 && id == u.to_string() => Ok(()),
        _ => Err(AppError::new(code::INVALID_INPUT, "id")),
    }
}

fn current_version(conn: &Connection, id: &str) -> Result<i64, AppError> {
    conn.query_row(
        "SELECT COALESCE(MAX(rev), 0) FROM model_revisions WHERE project_id = ?1",
        params![id],
        |r| r.get(0),
    )
    .map_err(db_err)
}

/// SQLite 오류. 메시지에 값이 섞일 수 있어 코드 이름만 남긴다.
fn db_err(e: rusqlite::Error) -> AppError {
    let detail = match e.sqlite_error_code() {
        Some(c) => format!("{c:?}"),
        None => "sqlite".to_string(),
    };
    AppError::new(code::DB_UNAVAILABLE, detail)
}

fn open_connection(path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(path).map_err(db_err)?;
    conn.busy_timeout(BUSY_TIMEOUT).map_err(db_err)?;
    // WAL 전환은 다른 인스턴스가 같은 파일을 열고 있으면 busy 처리기 없이 SQLITE_BUSY를 낸다.
    // busy_timeout 안에서 다시 시도한다(동시 첫 실행).
    let deadline = std::time::Instant::now() + BUSY_TIMEOUT;
    let journal: String = loop {
        match conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0)) {
            Err(e)
                if e.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy)
                    && std::time::Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(20));
            }
            other => break other.map_err(db_err)?,
        }
    };
    if !journal.eq_ignore_ascii_case("wal") {
        return Err(AppError::new(code::DB_UNAVAILABLE, "journal_mode"));
    }
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(db_err)?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(db_err)?;
    if check != "ok" {
        return Err(AppError::new(code::DB_UNAVAILABLE, "corrupt"));
    }
    Ok(conn)
}

fn user_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.pragma_query_value(None, "user_version", |r| r.get(0))
}

/// 마이그레이션. 실패해도 연결은 살려 두고 읽기 전용으로 돌린다.
fn migrate(
    conn: &mut Connection,
    migrations: &[Migration],
    snapshot: impl FnOnce(&Connection) -> Result<(), AppError>,
) -> DbMode {
    let Ok(current) = user_version(conn) else {
        return DbMode::ReadOnly;
    };
    let latest = migrations.last().map_or(0, |m| m.version);
    if current > latest {
        return DbMode::ReadOnly;
    }
    if current == latest {
        return DbMode::ReadWrite;
    }
    // 빈 DB(0)는 지킬 데이터가 없어 스냅샷을 건너뛴다.
    if current > 0 && snapshot(conn).is_err() {
        return DbMode::ReadOnly;
    }
    for m in migrations.iter().filter(|m| m.version > current) {
        if apply_one(conn, m).is_err() {
            return DbMode::ReadOnly;
        }
    }
    DbMode::ReadWrite
}

fn apply_one(conn: &mut Connection, m: &Migration) -> rusqlite::Result<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // 다른 인스턴스가 먼저 적용했으면 건너뛴다(쓰기 잠금을 잡은 뒤 다시 읽는다).
    if user_version(&tx)? >= m.version {
        return tx.commit();
    }
    tx.execute_batch(m.sql)?;
    tx.pragma_update(None, "user_version", m.version)?;
    tx.commit()
}

/// 백업 API로 `dir/backups/pre-migrate.db`에 스냅샷 1개를 남긴다(임시 파일 → rename).
pub fn snapshot(conn: &Connection, dir: &Path) -> Result<(), AppError> {
    let backups = dir.join(SNAPSHOT_DIR);
    std::fs::create_dir_all(&backups).map_err(|e| AppError::io(code::DB_READ_ONLY, &e))?;
    // 인스턴스별 임시 파일(동시 실행 시 서로 덮지 않게).
    let tmp: PathBuf = backups.join(format!("{SNAPSHOT_FILE}.{}.tmp", uuid::Uuid::now_v7()));
    let result = conn
        .backup(
            rusqlite::MAIN_DB,
            &tmp,
            None::<fn(rusqlite::backup::Progress)>,
        )
        .map_err(|e| {
            let mut err = db_err(e);
            err.code = code::DB_READ_ONLY;
            err
        })
        .and_then(|()| {
            std::fs::rename(&tmp, backups.join(SNAPSHOT_FILE))
                .map_err(|e| AppError::io(code::DB_READ_ONLY, &e))
        });
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn state_db<'a>(state: &'a State<'_, LocalDbState>) -> Result<&'a LocalDb, AppError> {
    state.0.as_ref().map_err(Clone::clone)
}

#[tauri::command(async)]
pub fn local_db_list_projects(
    state: State<'_, LocalDbState>,
) -> Result<Vec<ProjectSummary>, AppError> {
    state_db(&state)?.list_projects()
}

#[tauri::command(async)]
pub fn local_db_get_project(
    state: State<'_, LocalDbState>,
    id: String,
) -> Result<Option<ProjectRecord>, AppError> {
    state_db(&state)?.get_project(&id)
}

#[tauri::command(async)]
pub fn local_db_save_project(
    state: State<'_, LocalDbState>,
    input: SaveProjectInput,
) -> Result<SaveResult, AppError> {
    state_db(&state)?.save_project(&input)
}

#[tauri::command(async)]
pub fn local_db_delete_project(
    state: State<'_, LocalDbState>,
    id: String,
    expected_version: i64,
) -> Result<(), AppError> {
    state_db(&state)?.delete_project(&id, expected_version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arch-db-{tag}-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn input(id: &str, expected: Option<i64>) -> SaveProjectInput {
        SaveProjectInput {
            id: id.into(),
            name: "주택".into(),
            site_label: None,
            client_name: Some("건축주".into()),
            client_contact: None,
            schema_version: 1,
            engine_version: "0.1.0".into(),
            design_model: r#"{"schema_version":1,"units":"mm"}"#.into(),
            note: None,
            expected_version: expected,
        }
    }

    fn new_id() -> String {
        uuid::Uuid::now_v7().to_string()
    }

    fn table_count(db: &LocalDb) -> i64 {
        db.read(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |r| r.get(0),
            )
            .map_err(db_err)
        })
        .unwrap()
    }

    #[test]
    fn fresh_open_creates_eleven_tables_in_wal() {
        let dir = temp_dir("fresh");
        let db = LocalDb::open(&dir).unwrap();
        assert_eq!(db.mode(), DbMode::ReadWrite);
        assert_eq!(table_count(&db), 11);
        let (uv, jm): (i64, String) = db
            .read(|c| {
                Ok((
                    user_version(c).map_err(db_err)?,
                    c.query_row("PRAGMA journal_mode", [], |r| r.get(0))
                        .map_err(db_err)?,
                ))
            })
            .unwrap();
        assert_eq!(uv, MIGRATIONS.last().unwrap().version);
        assert_eq!(jm.to_ascii_lowercase(), "wal");
    }

    #[test]
    fn reopen_is_idempotent_and_keeps_data() {
        let dir = temp_dir("reopen");
        let id = new_id();
        {
            let db = LocalDb::open(&dir).unwrap();
            db.save_project(&input(&id, None)).unwrap();
        }
        let db = LocalDb::open(&dir).unwrap();
        assert_eq!(db.mode(), DbMode::ReadWrite);
        assert_eq!(table_count(&db), 11);
        assert_eq!(db.get_project(&id).unwrap().unwrap().version, 1);
    }

    const V2: Migration = Migration {
        version: 2,
        file: "test_v2.sql",
        sql: "ALTER TABLE projects ADD COLUMN test_flag INTEGER;",
    };

    #[test]
    fn upgrade_takes_snapshot_first() {
        let dir = temp_dir("upgrade");
        let id = new_id();
        LocalDb::open(&dir)
            .unwrap()
            .save_project(&input(&id, None))
            .unwrap();
        let migrations = [
            Migration {
                version: 1,
                file: MIGRATIONS[0].file,
                sql: MIGRATIONS[0].sql,
            },
            V2,
        ];
        let db = LocalDb::open_with(&dir, &migrations, |c| snapshot(c, &dir)).unwrap();
        assert_eq!(db.mode(), DbMode::ReadWrite);
        let snap = Connection::open(dir.join(SNAPSHOT_DIR).join(SNAPSHOT_FILE)).unwrap();
        let (uv, n): (i64, i64) = (
            user_version(&snap).unwrap(),
            snap.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
                .unwrap(),
        );
        assert_eq!((uv, n), (1, 1));
        let tmp_left = std::fs::read_dir(dir.join(SNAPSHOT_DIR))
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|x| x == "tmp")
            })
            .count();
        assert_eq!(tmp_left, 0);
    }

    #[test]
    fn snapshot_failure_skips_migration_and_starts_read_only() {
        let dir = temp_dir("snapfail");
        let id = new_id();
        LocalDb::open(&dir)
            .unwrap()
            .save_project(&input(&id, None))
            .unwrap();
        let migrations = [
            Migration {
                version: 1,
                file: MIGRATIONS[0].file,
                sql: MIGRATIONS[0].sql,
            },
            V2,
        ];
        let db = LocalDb::open_with(&dir, &migrations, |_| {
            Err(AppError::new(code::DB_READ_ONLY, "test"))
        })
        .unwrap();
        assert_eq!(db.mode(), DbMode::ReadOnly);
        assert_eq!(db.read(|c| user_version(c).map_err(db_err)).unwrap(), 1);
        assert_eq!(db.get_project(&id).unwrap().unwrap().version, 1);
        let err = db.save_project(&input(&id, Some(1))).unwrap_err();
        assert_eq!(err.code, code::DB_READ_ONLY);
        let err = db.delete_project(&id, 1).unwrap_err();
        assert_eq!(err.code, code::DB_READ_ONLY);
        assert_eq!(db.get_project(&id).unwrap().unwrap().version, 1);
    }

    #[test]
    fn failing_migration_rolls_back_and_starts_read_only() {
        let dir = temp_dir("migfail");
        LocalDb::open(&dir).unwrap();
        let migrations = [
            Migration {
                version: 1,
                file: MIGRATIONS[0].file,
                sql: MIGRATIONS[0].sql,
            },
            Migration {
                version: 2,
                file: "bad.sql",
                sql: "ALTER TABLE projects ADD COLUMN ok_col INTEGER; SELECT * FROM no_such_table;",
            },
        ];
        let db = LocalDb::open_with(&dir, &migrations, |c| snapshot(c, &dir)).unwrap();
        assert_eq!(db.mode(), DbMode::ReadOnly);
        let has_col: i64 = db
            .read(|c| {
                c.query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name = 'ok_col'",
                    [],
                    |r| r.get(0),
                )
                .map_err(db_err)
            })
            .unwrap();
        assert_eq!(has_col, 0);
        assert_eq!(db.read(|c| user_version(c).map_err(db_err)).unwrap(), 1);
    }

    #[test]
    fn newer_schema_starts_read_only() {
        let dir = temp_dir("newer");
        {
            let c = open_connection(&dir.join(DB_FILE)).unwrap();
            c.pragma_update(None, "user_version", 99).unwrap();
        }
        let db = LocalDb::open(&dir).unwrap();
        assert_eq!(db.mode(), DbMode::ReadOnly);
    }

    #[test]
    fn corrupt_file_is_ar060() {
        let dir = temp_dir("corrupt");
        std::fs::write(dir.join(DB_FILE), vec![0x42u8; 8192]).unwrap();
        let err = LocalDb::open(&dir).err().expect("손상 DB 거부");
        assert_eq!(err.code, code::DB_UNAVAILABLE);
    }

    #[test]
    fn save_bumps_rev_and_rejects_stale_expected_version() {
        let dir = temp_dir("rev");
        let db = LocalDb::open(&dir).unwrap();
        let id = new_id();
        assert_eq!(db.save_project(&input(&id, None)).unwrap().version, 1);
        assert_eq!(db.save_project(&input(&id, Some(1))).unwrap().version, 2);
        let stale = db.save_project(&input(&id, Some(1))).unwrap_err();
        assert_eq!(stale.code, code::VERSION_CONFLICT);
        let dup = db.save_project(&input(&id, None)).unwrap_err();
        assert_eq!(dup.code, code::VERSION_CONFLICT);
        let missing = db.save_project(&input(&new_id(), Some(1))).unwrap_err();
        assert_eq!(missing.code, code::NOT_FOUND);
        let rec = db.get_project(&id).unwrap().unwrap();
        assert_eq!(rec.version, 2);
        assert_eq!(rec.sha256, sha256_hex(rec.design_model.as_bytes()));
        let list = db.list_projects().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].version, 2);
    }

    #[test]
    fn delete_is_soft_and_checks_version() {
        let dir = temp_dir("delete");
        let db = LocalDb::open(&dir).unwrap();
        let id = new_id();
        db.save_project(&input(&id, None)).unwrap();
        assert_eq!(
            db.delete_project(&id, 2).unwrap_err().code,
            code::VERSION_CONFLICT
        );
        db.delete_project(&id, 1).unwrap();
        assert!(db.get_project(&id).unwrap().is_none());
        assert!(db.list_projects().unwrap().is_empty());
        assert_eq!(
            db.save_project(&input(&id, Some(1))).unwrap_err().code,
            code::NOT_FOUND
        );
        let rows: i64 = db
            .read(|c| {
                c.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
                    .map_err(db_err)
            })
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn invalid_input_is_rejected() {
        let dir = temp_dir("invalid");
        let db = LocalDb::open(&dir).unwrap();
        let id = new_id();
        for bad_id in [
            "1; DROP TABLE projects",
            "../x",
            "00000000-0000-4000-8000-000000000000",
            &id.to_ascii_uppercase(),
            &id.replace('-', ""),
        ] {
            assert_eq!(
                db.get_project(bad_id).unwrap_err().code,
                code::INVALID_INPUT
            );
        }
        let mut i = input(&id, None);
        i.design_model = "[1,2]".into();
        assert_eq!(db.save_project(&i).unwrap_err().code, code::INVALID_INPUT);
        let mut i = input(&id, None);
        i.name = "  ".into();
        assert_eq!(db.save_project(&i).unwrap_err().code, code::INVALID_INPUT);
    }

    #[test]
    fn save_input_rejects_unknown_fields_like_sql() {
        let id = new_id();
        let json = format!(
            r#"{{"id":"{id}","name":"a","schemaVersion":1,"engineVersion":"1","designModel":"{{}}","sql":"DROP TABLE projects"}}"#
        );
        assert!(serde_json::from_str::<SaveProjectInput>(&json).is_err());
    }

    fn concurrent_open(dir: &Path, migrations: &'static [Migration]) -> Vec<DbMode> {
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let (dir, barrier) = (dir.to_path_buf(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    LocalDb::open_with(&dir, migrations, |c| snapshot(c, &dir))
                        .unwrap()
                        .mode()
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    }

    static V1_V2: [Migration; 2] = [
        Migration {
            version: 1,
            file: "0001_init.sql",
            sql: include_str!("../../../migrations/0001_init.sql"),
        },
        V2,
    ];

    #[test]
    fn concurrent_instances_both_migrate_cleanly() {
        let fresh = temp_dir("race-fresh");
        assert_eq!(concurrent_open(&fresh, MIGRATIONS), [DbMode::ReadWrite; 2]);
        let db = LocalDb::open(&fresh).unwrap();
        assert_eq!(table_count(&db), 11);

        let upgrade = temp_dir("race-upgrade");
        LocalDb::open(&upgrade)
            .unwrap()
            .save_project(&input(&new_id(), None))
            .unwrap();
        assert_eq!(concurrent_open(&upgrade, &V1_V2), [DbMode::ReadWrite; 2]);
        let db = LocalDb::open_with(&upgrade, &V1_V2, |_| Ok(())).unwrap();
        assert_eq!(db.read(|c| user_version(c).map_err(db_err)).unwrap(), 2);
        assert!(upgrade.join(SNAPSHOT_DIR).join(SNAPSHOT_FILE).exists());
    }

    /// 적용된 마이그레이션은 고치지 않는다: 파일 해시를 고정한다(줄바꿈 차이는 무시).
    const APPLIED_HASHES: &[(&str, &str)] = &[(
        "0001_init.sql",
        "b6394b2e972b1124928ed9ba0f897f5db42c501b059303f4d775acf2b8dbdeed",
    )];

    #[test]
    fn applied_migration_files_are_pinned() {
        assert_eq!(
            MIGRATIONS.len(),
            APPLIED_HASHES.len(),
            "새 마이그레이션도 해시를 고정한다"
        );
        for (file, hash) in APPLIED_HASHES {
            let m = MIGRATIONS
                .iter()
                .find(|m| m.file == *file)
                .expect("적용된 마이그레이션 파일이 사라짐");
            let normalized = m.sql.replace("\r\n", "\n");
            assert_eq!(
                sha256_hex(normalized.as_bytes()),
                *hash,
                "{file}: 적용된 마이그레이션 수정 금지(새 번호 파일로 추가)"
            );
        }
    }

    #[test]
    fn migrations_are_additive_only() {
        let mut prev = 0;
        for m in MIGRATIONS {
            assert_eq!(m.version, prev + 1, "{}: 버전은 1씩 증가", m.file);
            prev = m.version;
            assert!(
                m.file.starts_with(&format!("{:04}_", m.version)),
                "{}",
                m.file
            );
            let sql: String = m
                .sql
                .lines()
                .map(|l| l.split("--").next().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n")
                .to_ascii_uppercase();
            for banned in ["DROP ", "RENAME ", "DELETE ", "UPDATE ", "PRAGMA "] {
                assert!(!sql.contains(banned), "{}: {banned} 금지", m.file);
            }
            for stmt in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
                let ok = stmt.starts_with("CREATE TABLE IF NOT EXISTS ")
                    || stmt.starts_with("CREATE INDEX IF NOT EXISTS ")
                    || (stmt.starts_with("ALTER TABLE ") && stmt.contains(" ADD COLUMN "));
                assert!(ok, "{}: 추가 문장만 허용", m.file);
            }
        }
    }
}
