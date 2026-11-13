use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewWindow, WindowEvent};

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn warn_still_deployed() {
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
    use windows::core::w;
    unsafe {
        let _ = MessageBoxW(
            None,
            w!("请先到「存档部署」卸载存档，再关闭软件。"),
            w!("无法关闭"),
            MB_OK | MB_ICONWARNING,
        );
    }
}

fn quit_app(app: &tauri::AppHandle) {
    if crate::native::archive_still_deployed() {
        show_main(app);
        warn_still_deployed();
        return;
    }
    app.exit(0);
}

fn app_logo() -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
    Ok(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.ico"))?)
}

pub fn setup_shell(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let logo = app_logo()?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_icon(logo);
        let handle = app.handle().clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if crate::native::archive_still_deployed() {
                    api.prevent_close();
                    show_main(&handle);
                    warn_still_deployed();
                }
            }
        });
    }

    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::with_id("peak")
        .tooltip("Peak车队中心")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Ok(icon) = app_logo() {
        tray = tray.icon(icon);
    }

    let _ = tray.build(app)?;
    Ok(())
}

#[tauri::command]
pub fn set_window_mode(window: WebviewWindow, mode: String) -> Result<(), String> {
    let (width, height) = match mode.as_str() {
        "admin" => (1440.0, 1010.0),
        "member" => (1300.0, 950.0),
        _ => (336.0, 470.0),
    };
    window.set_resizable(false).map_err(|e| e.to_string())?;
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)))
        .map_err(|e| e.to_string())?;
    let _ = window.center();
    Ok(())
}
