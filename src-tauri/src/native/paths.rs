use super::support::{hidden, user_profile};
use serde::Serialize;
use serde_json::Value;
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

pub(crate) fn valid_install(dir: &Path) -> bool {
    dir.join("bin\\win_x64\\eurotrucks2.exe").is_file()
        || dir.join("eurotrucks2.exe").is_file()
}

pub(crate) fn is_ets2_documents(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let Some(name) = dir.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if !name.eq_ignore_ascii_case("Euro Truck Simulator 2") {
        return false;
    }
    dir.join("config.cfg").is_file() || dir.join("profiles").is_dir()
}

pub(crate) fn may_open(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let Ok(canon) = std::fs::canonicalize(path) else {
        return false;
    };
    if inside(&canon, &super::support::toolbox_root()) || inside(&canon, &super::support::local_app_dir()) {
        return true;
    }
    canon.ancestors().any(|dir| is_ets2_documents(dir) || valid_install(dir))
}

fn inside(path: &Path, root: &Path) -> bool {
    let Ok(root) = std::fs::canonicalize(root) else {
        return false;
    };
    let path_text = path.to_string_lossy().to_ascii_lowercase();
    let root_text = root.to_string_lossy().trim_end_matches(['\\', '/']).to_ascii_lowercase();
    path_text == root_text || path_text.starts_with(&(root_text.clone() + "\\")) || path_text.starts_with(&(root_text + "/"))
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
        if is_ets2_documents(&path) {
            return path.display().to_string();
        }
    }
    String::new()
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
    let docs = if is_ets2_documents(Path::new(given_docs)) {
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
    if !trimmed.is_empty() {
        let given = PathBuf::from(trimmed);
        if is_ets2_documents(&given) {
            return std::fs::canonicalize(&given).map_err(|e| format!("无法解析文档目录：{e}"));
        }
        if given.exists() {
            return Err("文档目录不是欧卡文档目录".into());
        }
    }
    let docs = guess_documents();
    if docs.is_empty() {
        return Err("未找到欧卡文档目录，请先到「平台设置」填写".into());
    }
    std::fs::canonicalize(&docs).map_err(|e| format!("无法解析文档目录：{e}"))
}
