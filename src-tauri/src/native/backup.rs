use super::paths::resolve_docs;
use super::sii::{field_key, value_of};
use super::support::{copy_tree, ensure_dir, open_path, toolbox_root, stamp_file};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub fn status_3c(payload: &Value) -> Result<Value, String> {
    let docs = resolve_docs(payload.get("docsPath").and_then(|v| v.as_str()).unwrap_or(""))?;
    let profiles = profiles(&docs);
    let selected = choose(&profiles, payload.get("profileId").and_then(|v| v.as_str()));
    let files = selected
        .map(|profile| file_states(&docs, &profile.1))
        .unwrap_or_default();
    Ok(json!({
        "ok": true,
        "docsPath": docs.display().to_string(),
        "profiles": profiles.iter().map(|p| json!({"id": p.0, "label": p.2})).collect::<Vec<_>>(),
        "selectedProfileId": selected.map(|p| p.0.clone()),
        "files": files,
    }))
}

pub fn run_3c(payload: &Value) -> Result<Value, String> {
    let docs = resolve_docs(payload.get("docsPath").and_then(|v| v.as_str()).unwrap_or(""))?;
    let profiles = profiles(&docs);
    let profile = choose(&profiles, payload.get("profileId").and_then(|v| v.as_str()))
        .ok_or("请选择档案")?;
    let dest = toolbox_root().join("3C配置").join(format!("{}-{}", profile.2, stamp_file()));
    ensure_dir(&dest)?;
    let mut copied = Vec::new();
    let mut missing = Vec::new();
    for (label, path) in sources(&docs, &profile.1) {
        if path.is_file() {
            let name = path.file_name().unwrap_or_default();
            fs::copy(&path, dest.join(name)).map_err(|e| format!("备份 {label} 失败：{e}"))?;
            copied.push(label);
        } else {
            missing.push(label);
        }
    }
    if copied.is_empty() {
        return Err("没有找到可备份的 controls.sii、config.cfg 或 config_local.cfg".into());
    }
    Ok(json!({
        "ok": true,
        "message": format!("已备份 {}", copied.join("、")),
        "path": dest.display().to_string(),
        "missing": missing,
    }))
}

pub fn open_3c() -> Result<Value, String> {
    let dir = toolbox_root().join("3C配置");
    ensure_dir(&dir)?;
    open_path(&dir.display().to_string())?;
    Ok(json!({ "ok": true, "path": dir.display().to_string() }))
}

pub fn status_profile(payload: &Value) -> Result<Value, String> {
    let docs = resolve_docs(payload.get("docsPath").and_then(|v| v.as_str()).unwrap_or(""))?;
    let profiles = profiles(&docs);
    let selected = choose(&profiles, payload.get("profileId").and_then(|v| v.as_str()));
    let info = selected.map(|profile| inspect(&profile.1));
    Ok(json!({
        "ok": true,
        "docsPath": docs.display().to_string(),
        "profiles": profiles.iter().map(|p| json!({"id": p.0, "label": p.2})).collect::<Vec<_>>(),
        "selectedProfileId": selected.map(|p| p.0.clone()),
        "fileCount": info.as_ref().map(|v| v.0).unwrap_or(0),
        "hasProfile": info.as_ref().map(|v| v.1).unwrap_or(false),
        "hasSave": info.as_ref().map(|v| v.2).unwrap_or(false),
    }))
}

pub fn run_profile(payload: &Value) -> Result<Value, String> {
    let docs = resolve_docs(payload.get("docsPath").and_then(|v| v.as_str()).unwrap_or(""))?;
    let profiles = profiles(&docs);
    let profile = choose(&profiles, payload.get("profileId").and_then(|v| v.as_str()))
        .ok_or("请选择档案")?;
    let dest = toolbox_root().join("完整存档").join(format!("{}-{}", safe(&profile.2), stamp_file()));
    let count = copy_tree(&profile.1, &dest)?;
    let (files, has_profile, has_save) = inspect(&profile.1);
    Ok(json!({
        "ok": true,
        "message": format!("已复制 {count} 个文件"),
        "path": dest.display().to_string(),
        "fileCount": files,
        "hasProfile": has_profile,
        "hasSave": has_save,
    }))
}

pub fn open_profile() -> Result<Value, String> {
    let dir = toolbox_root().join("完整存档");
    ensure_dir(&dir)?;
    open_path(&dir.display().to_string())?;
    Ok(json!({ "ok": true, "path": dir.display().to_string() }))
}

fn profiles(docs: &Path) -> Vec<(String, PathBuf, String)> {
    let mut items = Vec::new();
    let Ok(read) = fs::read_dir(docs.join("profiles")) else {
        return items;
    };
    for entry in read.flatten() {
        let folder = entry.path();
        if !folder.join("profile.sii").is_file() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let label = fs::read_to_string(folder.join("profile.sii"))
            .ok()
            .and_then(|text| {
                text.lines().find_map(|line| {
                    (field_key(line) == Some("profile_name")).then(|| value_of(line)).filter(|v| !v.is_empty())
                })
            })
            .unwrap_or_else(|| id.clone());
        items.push((id, folder, label));
    }
    items.sort_by(|a, b| a.2.cmp(&b.2));
    items
}

fn choose<'a>(
    items: &'a [(String, PathBuf, String)],
    id: Option<&str>,
) -> Option<&'a (String, PathBuf, String)> {
    id.and_then(|id| items.iter().find(|item| item.0 == id))
        .or_else(|| items.first())
}

fn sources(docs: &Path, profile: &Path) -> Vec<(&'static str, PathBuf)> {
    vec![
        ("controls.sii", profile.join("controls.sii")),
        ("config.cfg", docs.join("config.cfg")),
        ("config_local.cfg", docs.join("config_local.cfg")),
    ]
}

fn file_states(docs: &Path, profile: &Path) -> Vec<Value> {
    sources(docs, profile)
        .into_iter()
        .map(|(name, path)| json!({ "name": name, "exists": path.is_file() }))
        .collect()
}

fn inspect(profile: &Path) -> (u64, bool, bool) {
    let mut count = 0u64;
    if let Ok(walk) = std::panic::catch_unwind(|| walkdir::WalkDir::new(profile)) {
        for entry in walk.into_iter().flatten() {
            if entry.file_type().is_file() {
                count += 1;
            }
        }
    }
    (
        count,
        profile.join("profile.sii").is_file(),
        profile.join("save").is_dir(),
    )
}

fn safe(name: &str) -> String {
    name.chars()
        .map(|ch| if "\\/:*?\"<>|".contains(ch) { '_' } else { ch })
        .collect()
}
