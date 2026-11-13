use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn hidden(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub fn user_profile() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\Users\\Public"))
}

pub fn local_app_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| user_profile().join("AppData\\Local"))
        .join("Peak车队中心")
}

pub fn toolbox_root() -> PathBuf {
    let drive = PathBuf::from("D:\\");
    if drive.exists() {
        PathBuf::from("D:\\peak工具箱备份")
    } else {
        local_app_dir().join("工具箱备份")
    }
}

pub fn stamp_text() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn stamp_file() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!(
        "{}-{millis}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

pub fn game_running() -> bool {
    let Ok(output) = hidden("tasklist").args(["/FO", "CSV", "/NH"]).output() else {
        return false;
    };
    let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    text.contains("eurotrucks2.exe")
}

pub fn ensure_game_closed() -> Result<(), String> {
    if game_running() {
        Err("请先完全退出欧洲卡车模拟 2，再执行这项操作".into())
    } else {
        Ok(())
    }
}

pub fn open_path(path: &str) -> Result<(), String> {
    let target = path.trim();
    if target.is_empty() {
        return Err("路径为空".into());
    }
    if !Path::new(target).exists() {
        return Err(format!("路径不存在：{target}"));
    }
    hidden("explorer")
        .arg(target)
        .spawn()
        .map_err(|e| format!("无法打开目录：{e}"))?;
    Ok(())
}

pub fn ensure_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| format!("创建目录失败：{e}"))
}

pub fn copy_tree(from: &Path, to: &Path) -> Result<u64, String> {
    if !from.exists() {
        return Err(format!("源目录不存在：{}", from.display()));
    }
    ensure_dir(to)?;
    let mut count = 0u64;
    for entry in walkdir::WalkDir::new(from) {
        let entry = entry.map_err(|e| format!("遍历失败：{e}"))?;
        let rel = entry
            .path()
            .strip_prefix(from)
            .map_err(|e| e.to_string())?;
        let dest = to.join(rel);
        if entry.file_type().is_dir() {
            ensure_dir(&dest)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = dest.parent() {
                ensure_dir(parent)?;
            }
            std::fs::copy(entry.path(), &dest).map_err(|e| format!("复制失败：{e}"))?;
            count += 1;
        }
    }
    Ok(count)
}

pub fn move_tree(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        ensure_dir(parent)?;
    }
    if to.exists() {
        return Err(format!("目标已存在：{}", to.display()));
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_tree(from, to)?;
    std::fs::remove_dir_all(from).map_err(|e| format!("清理原目录失败：{e}"))?;
    Ok(())
}

pub fn str_field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(|v| v.as_str()).unwrap_or("").trim()
}
