use super::paths::resolve_docs;
use super::support::{ensure_dir, stamp_file, toolbox_root};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

pub fn status(payload: &Value) -> Result<Value, String> {
    let docs = resolve_docs(payload.get("docsPath").and_then(|v| v.as_str()).unwrap_or(""))?;
    let config = docs.join("config.cfg");
    let text = fs::read_to_string(&config).unwrap_or_default();
    let developer = read_uset(&text, "g_developer").as_deref() == Some("1");
    let console = read_uset(&text, "g_console").as_deref() == Some("1");
    Ok(json!({
        "ok": true,
        "docsPath": docs.display().to_string(),
        "configPath": config.display().to_string(),
        "configExists": config.is_file(),
        "developer": developer,
        "console": console,
        "ready": developer && console,
        "message": if config.is_file() { "" } else { "未找到 config.cfg" },
    }))
}

pub fn set_enabled(payload: &Value, enabled: bool) -> Result<Value, String> {
    let docs = resolve_docs(payload.get("docsPath").and_then(|v| v.as_str()).unwrap_or(""))?;
    let config = docs.join("config.cfg");
    if !config.is_file() {
        return Err("未找到 config.cfg".into());
    }
    let original = fs::read_to_string(&config).map_err(|e| format!("读取配置失败：{e}"))?;
    let backup = toolbox_root().join("飞行控制台").join(format!("{}.cfg", stamp_file()));
    ensure_dir(backup.parent().unwrap_or(Path::new(".")))?;
    fs::write(&backup, &original).map_err(|e| format!("备份失败：{e}"))?;
    let value = if enabled { "1" } else { "0" };
    let mut next = write_uset(&original, "g_developer", value);
    next = write_uset(&next, "g_console", value);
    fs::write(&config, next).map_err(|e| format!("写入配置失败：{e}"))?;
    Ok(json!({
        "ok": true,
        "message": if enabled { "已开启开发者模式和控制台" } else { "已关闭开发者模式和控制台" },
        "backupPath": backup.display().to_string(),
    }))
}

pub fn open_backup() -> Result<Value, String> {
    let dir = toolbox_root().join("飞行控制台");
    ensure_dir(&dir)?;
    super::support::open_path(&dir.display().to_string())?;
    Ok(json!({ "ok": true, "path": dir.display().to_string() }))
}

fn read_uset(content: &str, key: &str) -> Option<String> {
    let needle = format!("uset {key}");
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        if !trimmed.to_ascii_lowercase().starts_with(&needle.to_ascii_lowercase()) {
            continue;
        }
        if let Some(start) = trimmed.find('"') {
            if let Some(end) = trimmed[start + 1..].find('"') {
                return Some(trimmed[start + 1..start + 1 + end].to_string());
            }
        }
    }
    None
}

fn write_uset(content: &str, key: &str, value: &str) -> String {
    let needle = format!("uset {key}");
    let mut found = false;
    let mut lines = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if !found && !trimmed.starts_with('#')
            && trimmed.to_ascii_lowercase().starts_with(&needle.to_ascii_lowercase())
        {
            lines.push(format!("uset {key} \"{value}\""));
            found = true;
        } else {
            lines.push(line.to_string());
        }
    }
    if !found {
        lines.push(format!("uset {key} \"{value}\""));
    }
    let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let mut text = lines.join(newline);
    if content.ends_with('\n') || content.ends_with("\r\n") {
        text.push_str(newline);
    }
    text
}
