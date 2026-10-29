//! 규칙 팩 설치·불러오기 명령(AR-06-042). 화면은 `rule_pack_install`·`rule_pack_load` 2개만 부른다.
//!
//! - 내려받기(HTTP)는 화면 쪽(shell-bridge)이 서명 URL로 하고, 이 모듈은 **받은 바이트를 믿지 않고** 다시 검증한다
//!   (Rust에 TLS 스택 의존성을 새로 넣지 않으려는 선택, tasks/logs/AR-06-042.md [DECISION] D3).
//! - 설치: 라이선스 파일 재검증 → [`admit_rule_pack`](서명 `"arch-rulepack-v1\n"`·`verify_strict`·sha256·크기·자격) →
//!   설치된 팩 중 검증을 통과한 최고 버전보다 낮으면 `downgrade`, 같은 버전·다른 본문은 `conflict`, 같은 버전·같은 본문은
//!   서명 매니페스트만 바꾼다(키 회전 재서명) → 임시 폴더에 쓰고 fsync 후 이름 바꾸기(원자적).
//! - 불러오기: 높은 버전부터 디스크에서 **다시** 검증(서명·해시·크기) + 라이선스 자격. 변조(서명 불일치·해시 불일치·형식
//!   위반·폴더 이름과 서명 버전 불일치·읽기 실패)면 낮은 버전으로 내려가지 않고 `invalid`(캐시 오염·쓰다 만 파일 방어).
//!   지금 키 고리에 없는 kid(키 회전으로 제거된 kid)로 서명된 폴더만 건너뛴다(보안 리뷰 #2: 회전 뒤 영구 `invalid` 방지).
//! - 설치(`installed`) 뒤 새 버전보다 높은데 검증되지 않는 폴더(모르는 kid·변조)는 `quarantine/`으로 옮긴다(지우지 않음).
//!   롤백 기준은 그대로 "검증된 설치본 중 최고 버전"이다.
//! - 설치 경로는 서명된 manifest의 `version`(`YYYY.MM.n`)과 고정 파일 이름으로만 만든다. 화면이 주는 경로·버전은 없다.
//! - 결과는 상태 이름만(서명·본문·경로 원문 없음). 이 모듈은 로그를 남기지 않는다.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;

use super::license::LicenseService;
use crate::license::rule_pack::{
    admit_rule_pack, compare_versions, valid_version, verify_rule_pack, RulePackManifest,
    RulePackRejection, MAX_PACK_BYTES, MAX_SIGNED_MANIFEST_BYTES,
};
use crate::license::KeyRing;

/// 설치 폴더 안 파일 이름(고정).
pub const MANIFEST_FILE: &str = "manifest.json";
pub const PACK_FILE: &str = "pack.json";
/// 쓰는 중인 임시 폴더 접두(불러오기·버전 계산에서 무시하고 다음 설치 때 지운다).
const TMP_PREFIX: &str = ".tmp-";
/// 검증되지 않는 상위 버전 폴더를 옮겨 두는 폴더(버전 형식이 아니라 불러오기·버전 계산에서 무시된다).
pub const QUARANTINE_DIR: &str = "quarantine";
/// 폴더 훑기 상한(로컬 DoS 방지. 월 1회 게시 기준 20년치).
const MAX_SCAN_ENTRIES: usize = 256;

/// 설치 결과.
#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct RulePackInstallStatus {
    /// `installed`·`already_installed`·`downgrade`·`conflict`·`not_entitled`·`too_large`·`malformed`·`unknown_kid`·
    /// `invalid_signature`·`content_mismatch`·`write_failed`.
    pub state: &'static str,
    /// 서명 검증을 통과한 manifest의 버전(그 전 단계 실패면 없음).
    pub version: Option<String>,
}

/// 엔진에 넘길 팩(서명·해시·자격 확인 끝).
#[derive(Serialize, Clone, PartialEq, Eq)]
pub struct LoadedRulePack {
    pub version: String,
    pub sha256: String,
    pub basis_date: String,
    pub published_at: String,
    /// 팩 본문(UTF-8 JSON). 워커가 `loadRulePack`으로 다시 검사한다.
    pub text: String,
}

impl std::fmt::Debug for LoadedRulePack {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoadedRulePack")
            .field("version", &self.version)
            .finish_non_exhaustive()
    }
}

/// 불러오기 결과. `state` = `ok`·`missing`(설치된 팩 없음, 또는 모두 지금 고리에 없는 kid)·`invalid`(디스크 팩 검증 실패)·`not_entitled`(라이선스 만료·자격 밖).
#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct RulePackLoadStatus {
    pub state: &'static str,
    pub pack: Option<LoadedRulePack>,
}

impl RulePackLoadStatus {
    fn fail(state: &'static str) -> Self {
        Self { state, pack: None }
    }
}

fn install_status(state: &'static str, version: Option<&str>) -> RulePackInstallStatus {
    RulePackInstallStatus {
        state,
        version: version.map(str::to_string),
    }
}

/// 상한까지만 읽는다(메타데이터 크기와 실제 읽은 크기 둘 다 검사).
fn read_capped(path: &Path, cap: usize) -> Option<Vec<u8>> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > cap as u64 {
        return None;
    }
    let mut buf = Vec::with_capacity(meta.len() as usize);
    fs::File::open(path)
        .ok()?
        .take(cap as u64 + 1)
        .read_to_end(&mut buf)
        .ok()?;
    (buf.len() <= cap).then_some(buf)
}

/// 디스크 폴더 하나의 검증 결과.
struct InstalledPack {
    manifest: RulePackManifest,
    signed: String,
    pack: Vec<u8>,
}

/// 설치 폴더 하나의 판정.
enum DirCheck {
    Verified(Box<InstalledPack>),
    /// 지금 키 고리에 없는 kid(키 회전으로 제거). 위조인지 옛 정상 팩인지 이 고리로는 가릴 수 없다 → 건너뛴다.
    UnknownKid,
    /// 서명 불일치·해시 불일치·형식 위반·버전 불일치·읽기 실패(변조·손상).
    Invalid,
}

fn check_dir(keys: &KeyRing, dir: &Path, version: &str) -> DirCheck {
    let read = || -> Option<(String, Vec<u8>)> {
        let signed = String::from_utf8(read_capped(
            &dir.join(MANIFEST_FILE),
            MAX_SIGNED_MANIFEST_BYTES,
        )?)
        .ok()?;
        let pack = read_capped(&dir.join(PACK_FILE), MAX_PACK_BYTES)?;
        Some((signed, pack))
    };
    let Some((signed, pack)) = read() else {
        return DirCheck::Invalid;
    };
    match verify_rule_pack(keys, &signed, &pack) {
        // 폴더 이름과 서명된 버전이 다르면(옮겨 놓은 폴더) 믿지 않는다.
        Ok(manifest) if manifest.version == version => {
            DirCheck::Verified(Box::new(InstalledPack {
                manifest,
                signed,
                pack,
            }))
        }
        Ok(_) => DirCheck::Invalid,
        Err(RulePackRejection::UnknownKid) => DirCheck::UnknownKid,
        Err(_) => DirCheck::Invalid,
    }
}

/// 설치 폴더의 버전 폴더(이름이 `YYYY.MM.n`인 실제 폴더만), 높은 버전부터.
fn installed_versions(root: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<String> = entries
        .take(MAX_SCAN_ENTRIES)
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| valid_version(n))
        .collect();
    out.sort_by(|a, b| compare_versions(b, a));
    out
}

fn write_file_synced(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = fs::File::create(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}

/// 파일 하나를 원자적으로 바꾼다(같은 폴더 임시 파일 → fsync → 이름 바꾸기).
fn replace_file_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    write_file_synced(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

/// 검증 서비스. 키 고리·라이선스 검증·설치 폴더를 주입받는다.
pub struct RulePackService {
    keys: KeyRing,
    license: Arc<LicenseService>,
    root: Option<PathBuf>,
    lock: Mutex<()>,
}

impl RulePackService {
    pub fn new(keys: KeyRing, license: Arc<LicenseService>, root: Option<PathBuf>) -> Self {
        Self {
            keys,
            license,
            root,
            lock: Mutex::new(()),
        }
    }

    /// 운영: 빌드 시 주입한 규칙 팩 공개키, 앱 데이터 폴더 `rule-packs/`.
    pub fn production(license: Arc<LicenseService>, app_data: Option<PathBuf>) -> Self {
        Self::new(
            KeyRing::production_rulepack(),
            license,
            app_data.map(|d| d.join("rule-packs")),
        )
    }

    /// 롤백 기준: 검증을 통과한 설치본 중 최고 버전(모르는 kid·변조 폴더는 기준이 되지 않는다).
    fn highest_verified(&self, root: &Path) -> Option<InstalledPack> {
        installed_versions(root).iter().find_map(|v| {
            match check_dir(&self.keys, &root.join(v), v) {
                DirCheck::Verified(p) => Some(*p),
                DirCheck::UnknownKid | DirCheck::Invalid => None,
            }
        })
    }

    /// 방금 설치한 `version`보다 높은 버전 폴더를 `quarantine/<버전>-<uuid>`로 옮긴다. 설치가 성공했다는 것은 더 높은
    /// **검증된** 폴더가 없다는 뜻(있으면 `downgrade`)이라 여기서 옮기는 폴더는 모두 검증되지 않는 폴더다(모르는 kid·변조).
    /// 지우지 않고 보관한다(조사용). 실패해도 설치 결과는 바꾸지 않는다(그 경우 불러오기가 `invalid`로 실패 닫힘).
    fn quarantine_above(&self, root: &Path, version: &str) {
        let above: Vec<String> = installed_versions(root)
            .into_iter()
            .filter(|v| compare_versions(v, version) == std::cmp::Ordering::Greater)
            .collect();
        if above.is_empty() {
            return;
        }
        let q = root.join(QUARANTINE_DIR);
        if fs::create_dir_all(&q).is_err() {
            return;
        }
        for v in above {
            // 경합으로 그 사이 검증되는 폴더가 생겼다면(뮤텍스 안이라 정상 경로로는 없음) 옮기지 않는다.
            if matches!(
                check_dir(&self.keys, &root.join(&v), &v),
                DirCheck::Verified(_)
            ) {
                continue;
            }
            let _ = fs::rename(
                root.join(&v),
                q.join(format!("{v}-{}", uuid::Uuid::now_v7())),
            );
        }
    }

    fn cleanup_tmp(root: &Path) {
        if let Ok(entries) = fs::read_dir(root) {
            for e in entries.take(MAX_SCAN_ENTRIES).filter_map(Result::ok) {
                if e.file_name().to_string_lossy().starts_with(TMP_PREFIX) {
                    let _ = fs::remove_dir_all(e.path());
                }
            }
        }
    }

    /// 서명 매니페스트 + 본문을 검증해 설치한다.
    pub fn install(
        &self,
        license_file: Option<&str>,
        signed_manifest: &str,
        pack: &[u8],
    ) -> RulePackInstallStatus {
        if signed_manifest.len() > MAX_SIGNED_MANIFEST_BYTES || pack.len() > MAX_PACK_BYTES {
            return install_status(RulePackRejection::TooLarge.as_str(), None);
        }
        // 서명·해시를 먼저 본다(라이선스 없음보다 위조를 먼저 알린다).
        let manifest = match verify_rule_pack(&self.keys, signed_manifest, pack) {
            Ok(m) => m,
            Err(e) => return install_status(e.as_str(), None),
        };
        let version = manifest.version.clone();
        let license = self.license.verify(license_file);
        if let Err(e) = admit_rule_pack(&license, &self.keys, signed_manifest, pack.to_vec()) {
            return install_status(e.as_str(), Some(&version));
        }
        let Some(root) = self.root.as_deref() else {
            return install_status("write_failed", Some(&version));
        };
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if fs::create_dir_all(root).is_err() {
            return install_status("write_failed", Some(&version));
        }
        Self::cleanup_tmp(root);
        if let Some(high) = self.highest_verified(root) {
            match compare_versions(&version, &high.manifest.version) {
                std::cmp::Ordering::Less => return install_status("downgrade", Some(&version)),
                std::cmp::Ordering::Equal => {
                    if high.manifest.sha256 != manifest.sha256 {
                        return install_status("conflict", Some(&version));
                    }
                    if high.signed == signed_manifest {
                        return install_status("already_installed", Some(&version));
                    }
                    // 같은 본문의 재서명(키 회전): 매니페스트만 원자적으로 바꾼다.
                    let path = root.join(&version).join(MANIFEST_FILE);
                    return match replace_file_atomic(&path, signed_manifest.as_bytes()) {
                        Ok(()) => install_status("already_installed", Some(&version)),
                        Err(_) => install_status("write_failed", Some(&version)),
                    };
                }
                std::cmp::Ordering::Greater => {}
            }
        }
        match Self::write_new(root, &version, signed_manifest, pack) {
            Ok(()) => {
                self.quarantine_above(root, &version);
                install_status("installed", Some(&version))
            }
            Err(_) => install_status("write_failed", Some(&version)),
        }
    }

    fn write_new(
        root: &Path,
        version: &str,
        signed_manifest: &str,
        pack: &[u8],
    ) -> std::io::Result<()> {
        let tmp = root.join(format!("{TMP_PREFIX}{}", uuid::Uuid::now_v7()));
        fs::create_dir(&tmp)?;
        let result = (|| {
            write_file_synced(&tmp.join(PACK_FILE), pack)?;
            write_file_synced(&tmp.join(MANIFEST_FILE), signed_manifest.as_bytes())?;
            let target = root.join(version);
            // 검증에 실패한(손상된) 같은 버전 폴더가 있으면 지우고 바꾼다.
            if fs::symlink_metadata(&target).is_ok() {
                fs::remove_dir_all(&target)?;
            }
            fs::rename(&tmp, &target)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&tmp);
        }
        result
    }

    /// 가장 높은 버전 팩을 디스크에서 다시 검증하고 자격이 있으면 돌려준다.
    pub fn load(&self, license_file: Option<&str>) -> RulePackLoadStatus {
        let Some(root) = self.root.as_deref() else {
            return RulePackLoadStatus::fail("missing");
        };
        let found = {
            let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
            // 높은 버전부터: 모르는 kid는 건너뛰고, 변조를 만나면 낮은 버전으로 내려가지 않는다.
            let mut found = None;
            for v in installed_versions(root) {
                match check_dir(&self.keys, &root.join(&v), &v) {
                    DirCheck::Verified(p) => {
                        found = Some(*p);
                        break;
                    }
                    DirCheck::UnknownKid => continue,
                    DirCheck::Invalid => return RulePackLoadStatus::fail("invalid"),
                }
            }
            // 폴더가 없거나 모두 모르는 kid면 쓸 수 있는 팩이 없다(`missing` → 화면은 내려받기 안내).
            let Some(found) = found else {
                return RulePackLoadStatus::fail("missing");
            };
            found
        };
        let license = self.license.verify(license_file);
        let admitted = match admit_rule_pack(&license, &self.keys, &found.signed, found.pack) {
            Ok(a) => a,
            Err(RulePackRejection::NotEntitled) => return RulePackLoadStatus::fail("not_entitled"),
            Err(_) => return RulePackLoadStatus::fail("invalid"),
        };
        let m = admitted.manifest();
        let Ok(text) = std::str::from_utf8(admitted.bytes()) else {
            return RulePackLoadStatus::fail("invalid");
        };
        RulePackLoadStatus {
            state: "ok",
            pack: Some(LoadedRulePack {
                version: m.version.clone(),
                sha256: m.sha256.clone(),
                basis_date: m.basis_date.clone(),
                published_at: m.published_at.clone(),
                text: text.to_string(),
            }),
        }
    }
}

/// 관리 상태.
#[derive(Clone)]
pub struct RulePackState(pub Arc<RulePackService>);

/// 규칙 팩 설치. `license_file`은 저장된 라이선스 파일 문자열(Rust가 다시 검증), `signed_manifest`는 서버
/// `/api/rule-packs/{version}/download` 응답의 `signed_manifest`, `pack`은 서명 URL로 받은 본문(UTF-8 JSON).
#[tauri::command(async)]
pub fn rule_pack_install(
    state: State<'_, RulePackState>,
    license_file: Option<String>,
    signed_manifest: String,
    pack: String,
) -> RulePackInstallStatus {
    state
        .0
        .install(license_file.as_deref(), &signed_manifest, pack.as_bytes())
}

/// 설치된 최고 버전 팩 불러오기(엔진 `load_rule_pack`용).
#[tauri::command(async)]
pub fn rule_pack_load(
    state: State<'_, RulePackState>,
    license_file: Option<String>,
) -> RulePackLoadStatus {
    state.0.load(license_file.as_deref())
}
