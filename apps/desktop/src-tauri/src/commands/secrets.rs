//! 비밀 저장(AR-06-005). 토큰·PKCE verifier는 OS 키체인에만 둔다(SQLite·로그·설정 파일 금지).
//!
//! - 화면은 `secret_get`·`secret_set`·`secret_delete` 3개만 부르고, 키는 [`ALLOWED_KEYS`] 허용 목록만 받는다.
//! - Windows 자격 증명 관리자 항목 한계(2,560바이트) 때문에 값은 [`CHUNK_BYTES`] 조각 `<키>#<i>`로 나눠 쓰고,
//!   헤더 `<키>` = `v1:<조각 수>:<SHA-256>`를 마지막에 쓴다. 읽을 때 해시가 안 맞으면 "없음"으로 실패 닫힘.
//! - 오류 `detail`·`Debug` 출력에는 값과 키 원문을 넣지 않는다. 이 모듈은 로그를 남기지 않는다.
//! - 키체인 접근은 [`SecretBackend`] trait 뒤에 있다. 테스트는 [`MemoryBackend`]를 쓴다.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use tauri::State;

use super::{sha256_hex, AppError};

/// 키체인 서비스 이름. 개발 빌드(Mock 로그인 세션)와 릴리스 항목을 섞지 않는다.
pub const SERVICE: &str = if cfg!(debug_assertions) {
    "com.archstudio.desktop.dev"
} else {
    "com.archstudio.desktop"
};

/// 화면이 쓸 수 있는 키(정확히 일치). `auth.session` = supabase-js 세션, `auth.pkce` = PKCE verifier 묶음(JSON 한 항목).
/// 새 키는 보안 리뷰 후 여기와 `packages/shell-bridge/src/secure-store.ts`에 함께 추가한다.
pub const ALLOWED_KEYS: &[&str] = &["auth.session", "auth.pkce"];

/// 값 상한(UTF-8 바이트).
pub const MAX_VALUE_BYTES: usize = 16 * 1024;
/// 조각 크기. Windows Credential Manager `CRED_MAX_CREDENTIAL_BLOB_SIZE`(2,560) 아래.
pub const CHUNK_BYTES: usize = 2000;
/// 한 키의 최대 조각 수.
pub const MAX_CHUNKS: usize = MAX_VALUE_BYTES.div_ceil(CHUNK_BYTES);

const HEADER_VERSION: &str = "v1";

/// 오류 코드(화면 흐름용 내부 코드).
pub mod code {
    /// 허용 목록 밖 키.
    pub const KEY_NOT_ALLOWED: &str = "SECRET_KEY_NOT_ALLOWED";
    /// 값 크기 초과.
    pub const TOO_LARGE: &str = "SECRET_TOO_LARGE";
    /// 키체인 사용 불가(잠김·거부·플랫폼 오류).
    pub const UNAVAILABLE: &str = "SECRET_UNAVAILABLE";
}

/// 키체인 백엔드 오류. 원인 메시지는 담지 않는다(플랫폼 오류 문자열에 항목 이름이 섞일 수 있다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendError {
    Unavailable,
}

/// 키체인 계정 단위 저장소. `delete`는 없는 항목이어도 `Ok`.
pub trait SecretBackend: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>, BackendError>;
    fn set(&self, account: &str, bytes: &[u8]) -> Result<(), BackendError>;
    fn delete(&self, account: &str) -> Result<(), BackendError>;
}

/// OS 키체인(`keyring`: Windows Credential Manager, macOS Keychain, Linux keyutils).
pub struct KeyringBackend {
    service: &'static str,
}

impl KeyringBackend {
    pub fn new(service: &'static str) -> Self {
        Self { service }
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry, BackendError> {
        keyring::Entry::new(self.service, account).map_err(|_| BackendError::Unavailable)
    }
}

impl SecretBackend for KeyringBackend {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>, BackendError> {
        match self.entry(account)?.get_secret() {
            Ok(bytes) => Ok(Some(bytes)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(BackendError::Unavailable),
        }
    }

    fn set(&self, account: &str, bytes: &[u8]) -> Result<(), BackendError> {
        self.entry(account)?
            .set_secret(bytes)
            .map_err(|_| BackendError::Unavailable)
    }

    fn delete(&self, account: &str) -> Result<(), BackendError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(BackendError::Unavailable),
        }
    }
}

/// 메모리 백엔드(테스트·CI용). 릴리스 앱은 `run()`에서 [`KeyringBackend`]만 등록한다.
#[derive(Default)]
pub struct MemoryBackend {
    items: Mutex<BTreeMap<String, Vec<u8>>>,
}

impl MemoryBackend {
    /// 저장된 계정 이름 목록(값 없음).
    pub fn accounts(&self) -> Vec<String> {
        self.items
            .lock()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// 저장된 전체 바이트(누출 검사용).
    pub fn raw_bytes(&self) -> Vec<u8> {
        self.items
            .lock()
            .map(|m| m.values().flatten().copied().collect())
            .unwrap_or_default()
    }
}

impl SecretBackend for MemoryBackend {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>, BackendError> {
        let items = self.items.lock().map_err(|_| BackendError::Unavailable)?;
        Ok(items.get(account).cloned())
    }

    fn set(&self, account: &str, bytes: &[u8]) -> Result<(), BackendError> {
        let mut items = self.items.lock().map_err(|_| BackendError::Unavailable)?;
        items.insert(account.to_string(), bytes.to_vec());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), BackendError> {
        let mut items = self.items.lock().map_err(|_| BackendError::Unavailable)?;
        items.remove(account);
        Ok(())
    }
}

/// 비밀 값. `Debug`는 값을 출력하지 않는다.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretValue(String);

impl SecretValue {
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl std::fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretValue(<redacted>)")
    }
}

/// 허용 목록·크기 상한·분할 저장을 맡는 저장소. 한 번에 한 연산만(조각 혼합 방지).
pub struct SecretStore {
    backend: Arc<dyn SecretBackend>,
    lock: Mutex<()>,
}

/// 관리 상태.
#[derive(Clone)]
pub struct SecretState(pub Arc<SecretStore>);

fn unavailable() -> AppError {
    AppError::new(code::UNAVAILABLE, "keychain")
}

fn chunk_account(key: &str, index: usize) -> String {
    format!("{key}#{index}")
}

fn allowed(key: &str) -> Result<&'static str, AppError> {
    ALLOWED_KEYS
        .iter()
        .copied()
        .find(|k| *k == key)
        // 키 원문을 되풀이하지 않는다(실수로 토큰을 키 자리에 넣은 경우 대비).
        .ok_or_else(|| AppError::new(code::KEY_NOT_ALLOWED, "key"))
}

fn header(chunks: usize, digest: &str) -> String {
    format!("{HEADER_VERSION}:{chunks}:{digest}")
}

/// 헤더 → (조각 수, 해시). 형식이 틀리면 None.
fn parse_header(bytes: &[u8]) -> Option<(usize, String)> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut parts = text.split(':');
    if parts.next()? != HEADER_VERSION {
        return None;
    }
    let chunks: usize = parts.next()?.parse().ok()?;
    let digest = parts.next()?;
    if parts.next().is_some()
        || chunks > MAX_CHUNKS
        || digest.len() != 64
        || !digest.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return None;
    }
    Some((chunks, digest.to_ascii_lowercase()))
}

impl SecretStore {
    pub fn new(backend: Arc<dyn SecretBackend>) -> Self {
        Self {
            backend,
            lock: Mutex::new(()),
        }
    }

    /// 실제 OS 키체인 저장소.
    pub fn keychain() -> Self {
        Self::new(Arc::new(KeyringBackend::new(SERVICE)))
    }

    fn guard(&self) -> Result<std::sync::MutexGuard<'_, ()>, AppError> {
        self.lock.lock().map_err(|_| unavailable())
    }

    /// 값 읽기. 조각 누락·해시 불일치·형식 오류는 항목을 지우고 `None`(재로그인).
    pub fn get(&self, key: &str) -> Result<Option<SecretValue>, AppError> {
        let key = allowed(key)?;
        let _guard = self.guard()?;
        let b = &self.backend;
        let Some(raw_header) = b.get(key).map_err(|_| unavailable())? else {
            return Ok(None);
        };
        let Some((chunks, digest)) = parse_header(&raw_header) else {
            self.purge(key)?;
            return Ok(None);
        };
        let mut bytes = Vec::with_capacity(chunks * CHUNK_BYTES);
        for i in 0..chunks {
            match b.get(&chunk_account(key, i)).map_err(|_| unavailable())? {
                Some(part) if part.len() <= CHUNK_BYTES => bytes.extend_from_slice(&part),
                _ => {
                    self.purge(key)?;
                    return Ok(None);
                }
            }
        }
        if bytes.len() > MAX_VALUE_BYTES || sha256_hex(&bytes) != digest {
            self.purge(key)?;
            return Ok(None);
        }
        match String::from_utf8(bytes) {
            Ok(text) => Ok(Some(SecretValue(text))),
            Err(_) => {
                self.purge(key)?;
                Ok(None)
            }
        }
    }

    /// 값 쓰기. 조각 → 헤더 순서로 쓰고, 이전 값의 남는 조각을 지운다.
    pub fn set(&self, key: &str, value: &str) -> Result<(), AppError> {
        let key = allowed(key)?;
        if value.len() > MAX_VALUE_BYTES {
            return Err(AppError::new(code::TOO_LARGE, "value"));
        }
        let _guard = self.guard()?;
        let b = &self.backend;
        let bytes = value.as_bytes();
        let parts: Vec<&[u8]> = bytes.chunks(CHUNK_BYTES).collect();
        for (i, part) in parts.iter().enumerate() {
            b.set(&chunk_account(key, i), part)
                .map_err(|_| unavailable())?;
        }
        b.set(key, header(parts.len(), &sha256_hex(bytes)).as_bytes())
            .map_err(|_| unavailable())?;
        for i in parts.len()..MAX_CHUNKS {
            b.delete(&chunk_account(key, i))
                .map_err(|_| unavailable())?;
        }
        Ok(())
    }

    /// 값 삭제. 헤더를 먼저 지우고(읽기 즉시 "없음") 조각 전 범위를 지운다(고아 조각 청소).
    pub fn delete(&self, key: &str) -> Result<(), AppError> {
        let key = allowed(key)?;
        let _guard = self.guard()?;
        self.purge(key)
    }

    fn purge(&self, key: &str) -> Result<(), AppError> {
        let b = &self.backend;
        b.delete(key).map_err(|_| unavailable())?;
        for i in 0..MAX_CHUNKS {
            b.delete(&chunk_account(key, i))
                .map_err(|_| unavailable())?;
        }
        Ok(())
    }
}

fn state_store(state: &State<'_, SecretState>) -> Arc<SecretStore> {
    state.0.clone()
}

/// 키체인 읽기는 macOS에서 사용자 확인 창을 띄울 수 있어 비동기 명령(메인 스레드 밖)으로 둔다.
#[tauri::command(async)]
pub fn secret_get(state: State<'_, SecretState>, key: String) -> Result<Option<String>, AppError> {
    Ok(state_store(&state).get(&key)?.map(SecretValue::into_inner))
}

#[tauri::command(async)]
pub fn secret_set(
    state: State<'_, SecretState>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    state_store(&state).set(&key, &value)
}

#[tauri::command(async)]
pub fn secret_delete(state: State<'_, SecretState>, key: String) -> Result<(), AppError> {
    state_store(&state).delete(&key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TOKEN: &str = "eyJhbGciOiJIUzI1NiJ9.SECRET-TOKEN-VALUE.sig";

    fn store() -> (Arc<MemoryBackend>, SecretStore) {
        let backend = Arc::new(MemoryBackend::default());
        (backend.clone(), SecretStore::new(backend))
    }

    fn value_of(len: usize) -> String {
        // 조각 경계마다 다른 문자가 오도록(조각 혼합·순서 오류 검출).
        (0..len)
            .map(|i| char::from(b'a' + (i % 26) as u8))
            .collect()
    }

    #[test]
    fn service_name_separates_dev_and_release() {
        if cfg!(debug_assertions) {
            assert_eq!(SERVICE, "com.archstudio.desktop.dev");
        } else {
            assert_eq!(SERVICE, "com.archstudio.desktop");
        }
        assert_eq!(MAX_CHUNKS, 9);
    }

    #[test]
    fn roundtrip_across_chunk_boundaries() {
        let (backend, s) = store();
        for len in [
            0,
            1,
            CHUNK_BYTES - 1,
            CHUNK_BYTES,
            CHUNK_BYTES + 1,
            MAX_VALUE_BYTES,
        ] {
            let v = value_of(len);
            s.set("auth.session", &v).unwrap();
            assert_eq!(
                s.get("auth.session").unwrap().map(SecretValue::into_inner),
                Some(v),
                "len {len}"
            );
            assert_eq!(backend.accounts().len(), 1 + len.div_ceil(CHUNK_BYTES));
        }
    }

    #[test]
    fn multibyte_value_roundtrip() {
        let (_, s) = store();
        let v = "토큰값".repeat(1500); // 13,500바이트, 조각 경계가 글자 중간에 걸린다
        s.set("auth.session", &v).unwrap();
        assert_eq!(s.get("auth.session").unwrap().unwrap().expose(), v);
    }

    #[test]
    fn every_chunk_fits_windows_credential_limit() {
        let (backend, s) = store();
        s.set("auth.session", &value_of(MAX_VALUE_BYTES)).unwrap();
        for account in backend.accounts() {
            let len = backend.get(&account).unwrap().unwrap().len();
            assert!(len <= 2560, "{account}: {len}");
        }
    }

    #[test]
    fn rejects_oversized_value_without_echo() {
        let (backend, s) = store();
        let big = format!("{TOKEN}{}", value_of(MAX_VALUE_BYTES));
        let err = s.set("auth.session", &big).unwrap_err();
        assert_eq!(err.code, code::TOO_LARGE);
        assert!(!err.to_string().contains("SECRET-TOKEN"));
        assert!(!format!("{err:?}").contains("SECRET-TOKEN"));
        assert!(backend.accounts().is_empty());
    }

    #[test]
    fn rejects_keys_outside_allowlist_without_echo() {
        let (backend, s) = store();
        for key in [
            "",
            "Auth.Session",
            "auth.session ",
            "auth.session#0",
            "auth.session#1",
            "auth.session-user",
            "../auth.session",
            "license.private_key",
            TOKEN,
        ] {
            for err in [
                s.get(key).unwrap_err(),
                s.set(key, "x").unwrap_err(),
                s.delete(key).unwrap_err(),
            ] {
                assert_eq!(err.code, code::KEY_NOT_ALLOWED, "{key}");
                assert_eq!(err.detail, "key");
                assert!(!err.to_string().contains("SECRET-TOKEN"));
            }
        }
        assert!(backend.accounts().is_empty());
    }

    #[test]
    fn shorter_overwrite_removes_stale_chunks() {
        let (backend, s) = store();
        s.set("auth.session", &value_of(CHUNK_BYTES * 4)).unwrap();
        assert_eq!(backend.accounts().len(), 5);
        s.set("auth.session", "short").unwrap();
        assert_eq!(
            backend.accounts(),
            vec!["auth.session".to_string(), "auth.session#0".to_string()]
        );
        assert_eq!(s.get("auth.session").unwrap().unwrap().expose(), "short");
    }

    #[test]
    fn delete_removes_header_and_all_chunks() {
        let (backend, s) = store();
        s.set("auth.session", &value_of(MAX_VALUE_BYTES)).unwrap();
        s.set("auth.pkce", "verifier").unwrap();
        s.delete("auth.session").unwrap();
        s.delete("auth.pkce").unwrap();
        assert!(backend.accounts().is_empty());
        assert_eq!(s.get("auth.session").unwrap(), None);
        // 없는 키 삭제도 성공.
        s.delete("auth.session").unwrap();
    }

    #[test]
    fn delete_cleans_orphan_chunks_without_header() {
        let (backend, s) = store();
        s.set("auth.session", &value_of(CHUNK_BYTES * 3)).unwrap();
        backend.delete("auth.session").unwrap();
        assert_eq!(s.get("auth.session").unwrap(), None);
        s.delete("auth.session").unwrap();
        assert!(backend.accounts().is_empty());
    }

    #[test]
    fn corrupted_or_mixed_chunks_fail_closed_and_purge() {
        let (backend, s) = store();
        s.set("auth.session", &value_of(CHUNK_BYTES * 2)).unwrap();
        backend.set("auth.session#1", b"tampered").unwrap();
        assert_eq!(s.get("auth.session").unwrap(), None);
        assert!(backend.accounts().is_empty());

        // 조각 누락.
        s.set("auth.session", &value_of(CHUNK_BYTES * 2)).unwrap();
        backend.delete("auth.session#0").unwrap();
        assert_eq!(s.get("auth.session").unwrap(), None);
        assert!(backend.accounts().is_empty());

        // 헤더 형식 오류.
        for bad in [
            &b"garbage"[..],
            b"v2:1:00",
            b"v1:99:0000000000000000000000000000000000000000000000000000000000000000",
        ] {
            s.set("auth.session", "x").unwrap();
            backend.set("auth.session", bad).unwrap();
            assert_eq!(s.get("auth.session").unwrap(), None);
            assert!(backend.accounts().is_empty());
        }
    }

    #[test]
    fn debug_output_redacts_value() {
        let (_, s) = store();
        s.set("auth.session", TOKEN).unwrap();
        let v = s.get("auth.session").unwrap();
        let printed = format!("{v:?}");
        assert!(!printed.contains("SECRET-TOKEN"), "{printed}");
        assert!(printed.contains("redacted"));
    }

    #[test]
    fn concurrent_writes_never_mix_chunks() {
        let (_, s) = store();
        let s = Arc::new(s);
        let values: Vec<String> = (0..8)
            .map(|t| format!("{t}").repeat(CHUNK_BYTES * 3 + t))
            .collect();
        let handles: Vec<_> = values
            .iter()
            .cloned()
            .map(|v| {
                let s = s.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        s.set("auth.session", &v).unwrap();
                        let got = s.get("auth.session").unwrap().unwrap().into_inner();
                        assert!(got.chars().all(|c| c == got.chars().next().unwrap()));
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let last = s.get("auth.session").unwrap().unwrap().into_inner();
        assert!(values.contains(&last));
    }

    /// n번째 set부터 실패하는 백엔드(쓰기 도중 끊김).
    struct Flaky {
        inner: MemoryBackend,
        sets: AtomicUsize,
        fail_from: usize,
    }

    impl SecretBackend for Flaky {
        fn get(&self, a: &str) -> Result<Option<Vec<u8>>, BackendError> {
            self.inner.get(a)
        }
        fn set(&self, a: &str, b: &[u8]) -> Result<(), BackendError> {
            if self.sets.fetch_add(1, Ordering::SeqCst) >= self.fail_from {
                return Err(BackendError::Unavailable);
            }
            self.inner.set(a, b)
        }
        fn delete(&self, a: &str) -> Result<(), BackendError> {
            self.inner.delete(a)
        }
    }

    #[test]
    fn interrupted_overwrite_fails_closed() {
        let flaky = Arc::new(Flaky {
            inner: MemoryBackend::default(),
            sets: AtomicUsize::new(0),
            // 첫 값(조각 3 + 헤더 1) 성공, 두 번째 값은 조각 1개만 쓰고 끊김.
            fail_from: 5,
        });
        let s = SecretStore::new(flaky.clone());
        s.set("auth.session", &"a".repeat(CHUNK_BYTES * 3)).unwrap();
        let err = s
            .set(
                "auth.session",
                &format!("{TOKEN}{}", "b".repeat(CHUNK_BYTES * 3)),
            )
            .unwrap_err();
        assert_eq!(err.code, code::UNAVAILABLE);
        assert!(!err.to_string().contains("SECRET-TOKEN"));
        // 옛 헤더 + 새 조각 0 → 해시 불일치 → 없음(섞인 값을 돌려주지 않는다).
        assert_eq!(s.get("auth.session").unwrap(), None);
    }

    // ---- IPC(명령 등록·capability) ----

    use serde_json::{json, Value};
    use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
    use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::{WebviewWindow, WebviewWindowBuilder};

    /// 플랫폼별 로컬 출처(Windows는 http://tauri.localhost, 그 밖은 tauri://localhost).
    fn local_url() -> &'static str {
        if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
    }

    fn app(backend: Arc<MemoryBackend>) -> WebviewWindow<MockRuntime> {
        let app = crate::builder(mock_builder())
            .manage(SecretState(Arc::new(SecretStore::new(backend))))
            .build(tauri::generate_context!())
            .expect("앱 빌드");
        WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("메인 창")
    }

    fn call(w: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(
            w,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: local_url().parse().expect("URL"),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|b| match b {
            InvokeResponseBody::Json(s) => serde_json::from_str(&s).expect("JSON"),
            InvokeResponseBody::Raw(_) => panic!("JSON 응답 기대"),
        })
    }

    #[test]
    fn ipc_roundtrip_and_delete() {
        let backend = Arc::new(MemoryBackend::default());
        let w = app(backend.clone());
        let session = format!("{{\"access_token\":\"{TOKEN}\"}}").repeat(200);
        assert_eq!(
            call(
                &w,
                "secret_set",
                json!({"key": "auth.session", "value": session})
            )
            .unwrap(),
            Value::Null
        );
        assert_eq!(
            call(&w, "secret_get", json!({"key": "auth.session"})).unwrap(),
            Value::String(session)
        );
        call(&w, "secret_delete", json!({"key": "auth.session"})).unwrap();
        assert_eq!(
            call(&w, "secret_get", json!({"key": "auth.session"})).unwrap(),
            Value::Null
        );
        assert!(backend.accounts().is_empty());
    }

    #[test]
    fn ipc_errors_do_not_echo_values() {
        let backend = Arc::new(MemoryBackend::default());
        let w = app(backend.clone());
        let err = call(&w, "secret_set", json!({"key": TOKEN, "value": TOKEN})).unwrap_err();
        assert_eq!(err["code"], code::KEY_NOT_ALLOWED);
        assert!(!err.to_string().contains("SECRET-TOKEN"), "{err}");
        let big = format!("{TOKEN}{}", "x".repeat(MAX_VALUE_BYTES));
        let err = call(
            &w,
            "secret_set",
            json!({"key": "auth.session", "value": big}),
        )
        .unwrap_err();
        assert_eq!(err["code"], code::TOO_LARGE);
        assert!(!err.to_string().contains("SECRET-TOKEN"), "{err}");
        assert!(backend.accounts().is_empty());
    }

    #[test]
    fn capability_allows_only_registered_secret_commands() {
        let w = app(Arc::new(MemoryBackend::default()));
        for cmd in ["secret_get", "secret_set", "secret_delete"] {
            if let Err(err) = call(&w, cmd, json!({})) {
                let text = err.to_string();
                assert!(
                    !text.contains("not allowed") && !text.contains("not found"),
                    "{cmd}: {text}"
                );
            }
        }
        for cmd in ["secret_list", "secret_clear", "plugin:keyring|get"] {
            let err = call(&w, cmd, json!({})).expect_err(cmd).to_string();
            assert!(
                err.contains("not allowed") || err.contains("not found"),
                "{cmd}: {err}"
            );
        }
    }
}
