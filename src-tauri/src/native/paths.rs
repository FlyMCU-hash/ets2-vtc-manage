use super::support::{hidden, user_profile};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectedPaths {
    ets2_install_path: String,
    ets2_documents_path: String,
    changed: bool,
    install_valid: bool,
    docs_exists: bool,
}

fn valid_install(dir: &Path) -> bool {
    dir.join("bin\\win_x64\\eurotrucks2.exe").is_file()
        || dir.join("eurotrucks2.exe").is_file()
}

fn reg_value(key: &str, name: &str) -> String {
    let output = hidden("reg")
        .args(["query", key, "/v", name])
        .output();
    let Ok(output) = output else {
        return String::new();
    };
    if !output.status.success() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let line = line.trim();
        if line.to_ascii_lowercase().starts_with(&name.to_ascii_lowercase()) {
            let mut parts = line.split_whitespace();
            let _name = parts.next();
            let _kind = parts.next();
            let rest = parts.collect::<Vec<_>>().join(" ");
            if !rest.is_empty() {
                return rest;
            }
        }
    }
    String::new()
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let steam = reg_value(r"HKCU\Software\Valve\Steam", "SteamPath").replace('/', "\\");
    if !steam.is_empty() {
        roots.push(PathBuf::from(&steam));
        let vdf = PathBuf::from(&steam).join("steamapps\\libraryfolders.vdf");
        if let Ok(text) = std::fs::read_to_string(vdf) {
            for line in text.lines() {
                let line = line.trim();
                if let Some(idx) = line.find("\"path\"") {
                    let after = &line[idx + 6..];
                    if let Some(start) = after.find('"') {
                        if let Some(end) = after[start + 1..].find('"') {
                            let raw = &after[start + 1..start + 1 + end];
                            let path = raw.replace("\\\\", "\\");
                            roots.push(PathBuf::from(path));
                        }
                    }
                }
            }
        }
    }
    roots
}

fn guess_install() -> String {
    let keys = [
        (
            r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 227300",
            "InstallLocation",
        ),
        (
            r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 227300",
            "InstallLocation",
        ),
    ];
    for (key, name) in keys {
        let value = reg_value(key, name);
        let path = PathBuf::from(value.trim());
        if valid_install(&path) {
            return path.display().to_string();
        }
    }
    for root in steam_roots() {
        let game = root.join("steamapps\\common\\Euro Truck Simulator 2");
        if valid_install(&game) {
            return game.display().to_string();
        }
    }
    String::new()
}

fn documents_candidates() -> Vec<PathBuf> {
    let mut list = Vec::new();
    let personal = reg_value(
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders",
        "Personal",
    );
    if !personal.is_empty() {
        list.push(PathBuf::from(personal).join("Euro Truck Simulator 2"));
    }
    let home = user_profile();
    list.push(home.join("Documents\\Euro Truck Simulator 2"));
    list.push(home.join("OneDrive\\Documents\\Euro Truck Simulator 2"));
    list
}

fn guess_documents() -> String {
    for path in documents_candidates() {
        if path.is_dir() {
            return path.display().to_string();
        }
    }
    documents_candidates()
        .into_iter()
        .next()
        .map(|p| p.display().to_string())
        .unwrap_or_default()
}

pub fn detect(payload: &Value) -> Result<Value, String> {
    let given_install = payload
        .get("ets2InstallPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let given_docs = payload
        .get("ets2DocumentsPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let install = if valid_install(Path::new(given_install)) {
        given_install.to_string()
    } else {
        guess_install()
    };
    let docs = if !given_docs.is_empty() && Path::new(given_docs).is_dir() {
        given_docs.to_string()
    } else {
        guess_documents()
    };

    let detected = DetectedPaths {
        changed: install != given_install || docs != given_docs,
        install_valid: valid_install(Path::new(&install)),
        docs_exists: Path::new(&docs).is_dir(),
        ets2_install_path: install,
        ets2_documents_path: docs,
    };
    serde_json::to_value(detected).map_err(|e| e.to_string())
}

pub fn resolve_docs(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if !trimmed.is_empty() && Path::new(trimmed).is_dir() {
        return Ok(PathBuf::from(trimmed));
    }
    let value = detect(&json!({ "ets2DocumentsPath": trimmed, "ets2InstallPath": "" }))?;
    let docs = value
        .get("ets2DocumentsPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if docs.is_empty() || !Path::new(&docs).is_dir() {
        return Err("未找到欧卡文档目录，请先到「平台设置」填写".into());
    }
    Ok(PathBuf::from(docs))
}
