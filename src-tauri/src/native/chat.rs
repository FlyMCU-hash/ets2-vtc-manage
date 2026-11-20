use super::support::game_running;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, Once};
use std::thread;
use std::time::Duration;

use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, VK_RETURN};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetMessageW, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible, PostMessageW,
    MSG, WM_CHAR, WM_HOTKEY, WM_KEYDOWN, WM_KEYUP,
};

static RUNNING: AtomicBool = AtomicBool::new(false);
static INTERVAL: AtomicU32 = AtomicU32::new(60);
static HOTKEYS: AtomicBool = AtomicBool::new(false);
static TEXT: Mutex<String> = Mutex::new(String::new());
static START: Once = Once::new();

const VK_Y: u32 = 0x59;
const SCAN_Y: u32 = 0x15;
const SCAN_ENTER: u32 = 0x1C;

pub fn install() {
    START.call_once(|| {
        thread::spawn(hotkey_loop);
        thread::spawn(send_loop);
    });
}

pub fn status() -> Result<Value, String> {
    install();
    Ok(json!({
        "ok": true,
        "running": RUNNING.load(Ordering::SeqCst),
        "gameRunning": game_running(),
        "intervalSecs": INTERVAL.load(Ordering::SeqCst).max(60),
        "text": TEXT.lock().map(|v| v.clone()).unwrap_or_default(),
        "hotkeys": HOTKEYS.load(Ordering::SeqCst),
    }))
}

pub fn configure(payload: &Value) -> Result<Value, String> {
    install();
    store(payload)?;
    Ok(json!({ "ok": true, "message": "已保存发言内容和间隔" }))
}

pub fn start(payload: &Value) -> Result<Value, String> {
    install();
    store(payload)?;
    if !game_running() {
        return Err("未检测到欧洲卡车模拟 2，不能启动挂机发言".into());
    }
    let text = TEXT.lock().map(|v| v.clone()).unwrap_or_default();
    if text.trim().is_empty() {
        return Err("请先填写要发送的文字".into());
    }
    RUNNING.store(true, Ordering::SeqCst);
    Ok(json!({ "ok": true, "message": "挂机发言已启动。F10 启动，F11 停止。" }))
}

pub fn stop() -> Result<Value, String> {
    RUNNING.store(false, Ordering::SeqCst);
    Ok(json!({ "ok": true, "message": "挂机发言已停止" }))
}

fn store(payload: &Value) -> Result<(), String> {
    if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
        *TEXT.lock().map_err(|_| "内部锁失败")? = text.to_string();
    }
    let secs = payload
        .get("intervalSecs")
        .and_then(|v| v.as_u64())
        .unwrap_or(INTERVAL.load(Ordering::SeqCst) as u64)
        .max(60) as u32;
    INTERVAL.store(secs, Ordering::SeqCst);
    Ok(())
}

fn hotkey_loop() {
    unsafe {
        let f10 = RegisterHotKey(None, 1, Default::default(), 0x79);
        let f11 = RegisterHotKey(None, 2, Default::default(), 0x7A);
        HOTKEYS.store(f10.is_ok() && f11.is_ok(), Ordering::SeqCst);
        let mut msg = MSG::default();
        loop {
            let message = GetMessageW(&mut msg, None, 0, 0);
            if !message.as_bool() {
                break;
            }
            if msg.message == WM_HOTKEY {
                match msg.wParam.0 {
                    1 => {
                        if game_running() && !TEXT.lock().map(|v| v.trim().is_empty()).unwrap_or(true) {
                            RUNNING.store(true, Ordering::SeqCst);
                        }
                    }
                    2 => RUNNING.store(false, Ordering::SeqCst),
                    _ => {}
                }
            }
        }
    }
}

fn send_loop() {
    loop {
        if RUNNING.load(Ordering::SeqCst) {
            let text = TEXT.lock().map(|v| v.clone()).unwrap_or_default();
            let secs = INTERVAL.load(Ordering::SeqCst).max(60);
            if game_running() && !text.trim().is_empty() {
                let _ = send_chat(&text);
            } else if !game_running() {
                RUNNING.store(false, Ordering::SeqCst);
            }
            for _ in 0..(secs * 5) {
                if !RUNNING.load(Ordering::SeqCst) {
                    break;
                }
                thread::sleep(Duration::from_millis(200));
            }
        } else {
            thread::sleep(Duration::from_millis(200));
        }
    }
}

fn post_key(hwnd: HWND, vk: u32, scan: u32, down: bool) {
    let l_param = if down {
        (scan << 16) | 1
    } else {
        (scan << 16) | 0xC0000001
    };
    unsafe {
        let _ = PostMessageW(
            hwnd,
            if down { WM_KEYDOWN } else { WM_KEYUP },
            WPARAM(vk as usize),
            LPARAM(l_param as isize),
        );
    }
}

fn press_key(hwnd: HWND, vk: u32, scan: u32) {
    post_key(hwnd, vk, scan, true);
    thread::sleep(Duration::from_millis(50));
    post_key(hwnd, vk, scan, false);
}

fn send_chat(text: &str) -> Result<(), String> {
    let hwnd = find_game_window().ok_or("找不到游戏窗口")?;
    // 按 Y 打开聊天框，等窗口响应
    press_key(hwnd, VK_Y, SCAN_Y);
    thread::sleep(Duration::from_millis(500));
    // 逐字送入文字（UTF-16 code unit，与 TMP_Auto_typing 一致）
    for unit in text.encode_utf16() {
        unsafe {
            let _ = PostMessageW(hwnd, WM_CHAR, WPARAM(unit as usize), LPARAM(0));
        }
        thread::sleep(Duration::from_millis(30));
    }
    thread::sleep(Duration::from_millis(300));
    // 回车发送
    press_key(hwnd, VK_RETURN.0 as u32, SCAN_ENTER);
    Ok(())
}

static FOUND_SLOT: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

fn find_game_window() -> Option<HWND> {
    FOUND_SLOT.store(0, Ordering::SeqCst);
    unsafe {
        let _ = EnumWindows(Some(enum_window), LPARAM(0));
    }
    let raw = FOUND_SLOT.load(Ordering::SeqCst);
    if raw == 0 {
        None
    } else {
        Some(HWND(raw as *mut std::ffi::c_void))
    }
}

unsafe extern "system" fn enum_window(hwnd: HWND, _: LPARAM) -> BOOL {
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return BOOL(1);
    }
    let mut buf = vec![0u16; (len as usize) + 1];
    let n = GetWindowTextW(hwnd, &mut buf);
    if n <= 0 {
        return BOOL(1);
    }
    let title = String::from_utf16_lossy(&buf[..n as usize]);
    if title.contains("Euro Truck Simulator 2") {
        FOUND_SLOT.store(hwnd.0 as isize, Ordering::SeqCst);
        return BOOL(0);
    }
    BOOL(1)
}