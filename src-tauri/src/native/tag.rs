use super::support::{ensure_game_closed, game_running, user_profile};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_NAME: &str = "Peak车队";
const DEFAULT_COLOR: u32 = (11 << 16) | (243 << 8) | 243;

pub fn defaults() -> Result<Value, String> {
    Ok(json!({
        "tagName": DEFAULT_NAME,
        "r": 11,
        "g": 243,
        "b": 243,
        "colorDecimal": DEFAULT_COLOR,
    }))
}

pub fn status() -> Result<Value, String> {
    let mut items = Vec::new();
    for (label, path) in targets() {
        if !path.is_file() {
            items.push(json!({
                "label": label,
                "path": path.display().to_string(),
                "exists": false,
            }));
            continue;
        }
        let (name, color) = read_tag(&path).unwrap_or((None, None));
        items.push(json!({
            "label": label,
            "path": path.display().to_string(),
            "exists": true,
            "tagName": name,
            "tagColor": color,
            "applied": name.as_deref() == Some(DEFAULT_NAME) && color == Some(DEFAULT_COLOR),
        }));
    }
    Ok(json!({
        "ok": true,
        "gameRunning": game_running(),
        "items": items,
        "defaultName": DEFAULT_NAME,
    }))
}

pub fn apply(payload: &Value) -> Result<Value, String> {
    ensure_game_closed()?;
    let name = payload
        .get("tagName")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_NAME);
    let mut wrote = 0;
    let mut missing = 0;
    for (_label, path) in targets() {
        if !path.is_file() {
            missing += 1;
            continue;
        }
        write_tag(&path, name, DEFAULT_COLOR)?;
        wrote += 1;
    }
    if wrote == 0 {
        return Err("未找到 TruckersMP 配置。请先运行一次 ETS2MP。".into());
    }
    Ok(json!({
        "ok": true,
        "message": format!("已写入 {wrote} 个配置。请重新打开 TruckersMP 后再进服。"),
        "missing": missing,
        "tagName": name,
    }))
}

fn targets() -> Vec<(String, PathBuf)> {
    let docs = user_profile().join("Documents");
    vec![
        ("ETS2MP".into(), docs.join("ETS2MP\\config.txt")),
        ("ATSMP".into(), docs.join("ATSMP\\config.txt")),
    ]
}

fn read_tag(path: &Path) -> Result<(Option<String>, Option<u32>), String> {
    let value = read_json(path)?;
    let name = value
        .pointer("/generals/tag_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let color = value
        .pointer("/generals/tag_color")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    Ok((name, color))
}

fn write_tag(path: &Path, name: &str, color: u32) -> Result<(), String> {
    let mut value = read_json(path)?;
    let generals = value
        .as_object_mut()
        .and_then(|root| root.get_mut("generals"))
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| format!("配置缺少 generals：{}", path.display()))?;
    generals.insert("tag_name".into(), json!(name));
    generals.insert("tag_color".into(), json!(color));
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("写入失败：{e}"))?;
    Ok(())
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("读取失败：{e}"))?;
    let trimmed = raw.trim_start_matches('\u{feff}');
    let start = trimmed
        .find('{')
        .ok_or_else(|| format!("配置不是 JSON：{}", path.display()))?;
    serde_json::from_str(&trimmed[start..]).map_err(|e| format!("解析配置失败：{e}"))
}
