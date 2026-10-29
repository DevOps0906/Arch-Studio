//! Arch Studio 데스크톱 셸 골격(AR-06-004). 명령·플러그인은 아직 없다.
//! 새 명령·플러그인 권한은 capabilities/ 와 함께 추가하고 보안 리뷰를 거친다.

/// 앱 빌더. 명령 등록은 여기 한 곳에서 한다(현재 0개).
pub fn builder<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    builder(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("Arch Studio 셸 실행 실패");
}
