#[cfg(feature = "server")]
mod db;
#[cfg(feature = "desktop")]
mod native;
#[cfg(feature = "desktop")]
mod shell;

#[cfg(feature = "desktop")]
use native::native_call;
#[cfg(feature = "desktop")]
use shell::{set_window_mode, setup_shell};
#[cfg(feature = "desktop")]
use tauri::Manager;

#[cfg(feature = "server")]
pub fn serve() {
    db::serve();
}

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_shell(app)?;
            native::chat::install();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![native_call, set_window_mode])
        .build(tauri::generate_context!())
        .expect("Peak 车队中心启动失败")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if native::archive_still_deployed() {
                    api.prevent_exit();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
