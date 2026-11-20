use super::paths::{resolve_docs, valid_install};
use super::remote::ensure_download_url;
use super::support::{ensure_dir, local_app_dir, move_tree, stamp_text, user_profile};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

const DLC_OFF_DIR: &str = "DLC";
const DLC_SUFFIX: &str = ".bak";
const DLC_LEGACY: &str = ".peak_disabled";
/// 部署时把本机 3C 盖到活动档：按键、画面、本地覆盖。
const LOCAL_3C: &[&str] = &["controls.sii", "config.cfg", "config_local.cfg"];
/// 服务器目录缺失时的内置名单。地图 11 个 + 客运 1 个 + 挂车 9 个。活动勾选了对应编号时，部署跳过该文件。
const FLEET_DISABLE_SCS: &[(&str, i64)] = &[
    ("dlc_greece.scs", 2604420),
    ("dlc_balkan_w.scs", 2004210),
    ("dlc_iberia.scs", 1209460),
    ("dlc_balkan_e.scs", 1056760),
    ("dlc_balt.scs", 925580),
    ("dlc_it.scs", 558244),
    ("dlc_fr.scs", 531130),
    ("dlc_north.scs", 304212),
    ("dlc_east.scs", 227310),
    ("dlc_polar.scs", 910001),
    ("dlc_iceland.scs", 3796990),
    ("dlc_bus.scs", 3809270),
    ("dlc_schwarzmuller.scs", 388477),
    ("dlc_feldbinder.scs", 2193220),
    ("dlc_wielton.scs", 2455690),
    ("dlc_tirsan.scs", 2569750),
    ("dlc_schmitz.scs", 2833100),
    ("dlc_kogel.scs", 3034940),
    ("dlc_kassbohrer.scs", 3034950),
    ("dlc_krone.scs", 933610),
    ("dlc_krone_agriculture.scs", 910002),
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeldFile {
    from: String,
    to: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployState {
    deployed: bool,
    activity_id: i64,
    activity_name: String,
    deployed_at: String,
    profiles_backup: String,
    profiles_dir: String,
    had_profiles: bool,
    deployed_profiles: Vec<String>,
    held_dlc: Vec<HeldFile>,
}

fn state_path() -> PathBuf {
    local_app_dir().join("deploy-state.json")
}

fn load_state() -> Option<DeployState> {
    let text = fs::read_to_string(state_path()).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_state(state: &DeployState) -> Result<(), String> {
    ensure_dir(&local_app_dir())?;
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(state_path(), text).map_err(|e| format!("写入部署状态失败：{e}"))
}

pub fn is_deployed() -> bool {
    load_state().is_some_and(|state| state.deployed)
}

pub fn status() -> Result<Value, String> {
    match load_state().filter(|s| s.deployed) {
        Some(state) => Ok(json!({
            "deployed": true,
            "activityId": state.activity_id,
            "activityName": state.activity_name,
            "deployedAt": state.deployed_at,
            "deployedProfiles": state.deployed_profiles,
        })),
        None => Ok(json!({
            "deployed": false,
            "activityId": null,
            "activityName": "",
            "deployedAt": "",
            "deployedProfiles": [],
        })),
    }
}

pub fn deploy(payload: &Value) -> Result<Value, String> {
    if load_state().is_some_and(|s| s.deployed) {
        return Err("已有活动存档在部署中，请先卸载".into());
    }
    let activity_id = payload
        .get("activityId")
        .and_then(|v| v.as_i64())
        .ok_or("缺少活动编号")?;
    let activity_name = payload
        .get("activityName")
        .and_then(|v| v.as_str())
        .unwrap_or("活动")
        .to_string();
    let download_url = payload
        .get("downloadUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let local_path = payload
        .get("localPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if download_url.is_empty() && local_path.is_empty() {
        return Err("活动存档没有下载地址".into());
    }
    let settings = payload.get("settings").cloned().unwrap_or(json!({}));
    let docs = resolve_docs(settings.get("ets2DocumentsPath").and_then(|v| v.as_str()).unwrap_or(""))?;
    let disable = settings
        .get("disableMapDlcOnDeploy")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let install = settings
        .get("ets2InstallPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if disable && !install.is_empty() && !valid_install(Path::new(&install)) {
        return Err("安装目录不是欧卡安装目录".into());
    }
    if !local_path.is_empty() {
        accept_local_zip(Path::new(&local_path))?;
    } else {
        ensure_download_url(&download_url)?;
    }
    let profiles_dir = docs.join("profiles");
    let had_profiles = profiles_dir.is_dir();
    let local_3c = read_local_3c(&docs, &profiles_dir);
    let backup = local_app_dir().join("deploy-backup").join(format!("profiles-{activity_id}"));
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|e| format!("清理旧备份失败：{e}"))?;
    }
    if had_profiles {
        move_tree(&profiles_dir, &backup)?;
    }
    ensure_dir(&profiles_dir)?;

    let zip_path = local_app_dir().join("incoming.zip");
    ensure_dir(&local_app_dir())?;
    if !local_path.is_empty() {
        fs::copy(&local_path, &zip_path).map_err(|e| format!("读取本地存档失败：{e}"))?;
    } else {
        download(&download_url, payload, &zip_path)?;
    }
    let deployed = match extract_profiles(&zip_path, &profiles_dir) {
        Ok(names) => names,
        Err(err) => {
            let _ = fs::remove_dir_all(&profiles_dir);
            if had_profiles {
                let _ = move_tree(&backup, &profiles_dir);
            }
            return Err(err);
        }
    };
    let _ = fs::remove_file(&zip_path);

    let mut notices = Vec::new();
    let (applied, failed) = apply_local_3c(&profiles_dir, &deployed, &local_3c);
    if applied.is_empty() && failed.is_empty() {
        notices.push("未找到本机 3C 文件，活动档保持压缩包内的配置。".to_string());
    } else if !applied.is_empty() {
        let missing: Vec<&str> = LOCAL_3C
            .iter()
            .copied()
            .filter(|name| !applied.iter().any(|item| item == name) && !failed.iter().any(|item| item == name))
            .collect();
        let mut message = format!("已套用本机 3C：{}。", applied.join("、"));
        if !missing.is_empty() {
            message.push_str(&format!("未找到 {}。", missing.join("、")));
        }
        if !failed.is_empty() {
            message.push_str(&format!("写入失败：{}。", failed.join("、")));
        }
        notices.push(message);
    } else {
        notices.push(format!("本机 3C 写入活动档失败：{}。", failed.join("、")));
    }
    let mut held = Vec::new();
    if disable {
        let root = Path::new(&install);
        if !valid_install(root) {
            notices.push("未找到欧卡安装目录，地图、客运和挂车 DLC 未禁用。请先到平台设置填写安装路径。".to_string());
        } else {
            enable_all_disabled(root);
            let catalog = disable_catalog(payload);
            let keep_ids = keep_dlc_ids(payload);
            let names = find_scs_to_disable(root, &keep_ids, &catalog);
            let kept = catalog.iter().filter(|(_, id)| keep_ids.contains(id)).count();
            held = disable_selected(root, &names);
            if names.is_empty() && kept > 0 {
                notices.push(format!("已按活动依赖保留 {kept} 个 DLC，没有额外禁用。"));
            } else if names.is_empty() {
                notices.push("未在欧卡安装目录找到需禁用的地图、客运或挂车 DLC（.scs）。请确认平台设置里的安装路径正确。".to_string());
            } else if held.is_empty() {
                notices.push("检测到 DLC 文件但禁用失败（可能被欧卡或 TMP 占用）。请先完全退出游戏后再部署。".to_string());
            } else if kept > 0 {
                notices.push(format!("已禁用 {} 个 DLC（挪至 {DLC_OFF_DIR}），跳过勾选的 {kept} 个。", held.len()));
            } else {
                notices.push(format!("已禁用 {} 个 DLC（挪至 {DLC_OFF_DIR}）。", held.len()));
            }
        }
    }

    let state = DeployState {
        deployed: true,
        activity_id,
        activity_name: activity_name.clone(),
        deployed_at: stamp_text(),
        profiles_backup: if had_profiles { backup.display().to_string() } else { String::new() },
        profiles_dir: profiles_dir.display().to_string(),
        had_profiles,
        deployed_profiles: deployed.clone(),
        held_dlc: held,
    };
    save_state(&state)?;
    Ok(json!({
        "ok": true,
        "message": format!("已部署「{activity_name}」"),
        "notices": notices,
        "deployedProfiles": deployed,
        "activityName": activity_name,
    }))
}

pub fn uninstall() -> Result<Value, String> {
    let Some(state) = load_state().filter(|s| s.deployed) else {
        return Err("当前没有已部署的活动存档".into());
    };
    let profiles = PathBuf::from(&state.profiles_dir);
    if profiles.exists() {
        fs::remove_dir_all(&profiles).map_err(|e| format!("移除活动档案失败：{e}"))?;
    }
    if state.had_profiles && !state.profiles_backup.is_empty() {
        move_tree(Path::new(&state.profiles_backup), &profiles)?;
    }
    for held in &state.held_dlc {
        let from = PathBuf::from(&held.to);
        let to = PathBuf::from(&held.from);
        if from.is_file() {
            if let Some(parent) = to.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::rename(&from, &to).map_err(|e| format!("恢复 DLC 失败：{e}"))?;
        }
    }
    let _ = fs::remove_file(state_path());
    Ok(json!({
        "ok": true,
        "message": "已卸载活动存档并恢复本地档案",
    }))
}

fn accept_local_zip(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("本地存档不存在".into());
    }
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
    if !name.to_ascii_lowercase().ends_with(".zip") {
        return Err("本地存档必须是 zip 文件".into());
    }
    let len = fs::metadata(path).map_err(|e| format!("读取本地存档失败：{e}"))?.len();
    if len > MAX_ARCHIVE_BYTES {
        return Err("本地存档超过 2GB 限制".into());
    }
    let canon = fs::canonicalize(path).map_err(|e| format!("无法解析本地存档：{e}"))?;
    let home = fs::canonicalize(user_profile()).unwrap_or_else(|_| user_profile());
    let app = fs::canonicalize(local_app_dir()).unwrap_or_else(|_| local_app_dir());
    let text = canon.to_string_lossy().to_ascii_lowercase();
    let allowed = [home, app].into_iter().any(|root| {
        let root = root.to_string_lossy().trim_end_matches(['\\', '/']).to_ascii_lowercase();
        text == root || text.starts_with(&(root.clone() + "\\")) || text.starts_with(&(root + "/"))
    });
    if !allowed {
        return Err("本地存档必须放在用户目录下".into());
    }
    Ok(())
}

fn download(url: &str, payload: &Value, dest: &Path) -> Result<(), String> {
    ensure_download_url(url)?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8 {
                return attempt.error(std::io::Error::new(std::io::ErrorKind::Other, "下载重定向过多"));
            }
            if super::remote::allow_download_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error(std::io::Error::new(std::io::ErrorKind::Other, "下载地址不在允许的主机"))
            }
        }))
        .build()
        .map_err(|e| format!("创建下载客户端失败：{e}"))?;
    let mut req = client.get(url);
    let token = payload.get("token").and_then(|v| v.as_str()).unwrap_or("");
    let api_base = payload.get("apiBase").and_then(|v| v.as_str()).unwrap_or("");
    if !token.is_empty() && (api_base.is_empty() || url.starts_with(api_base)) {
        req = req.header("X-Client-Token", token);
    }
    let mut res = req.send().map_err(|e| format!("下载存档失败：{e}"))?;
    if !res.status().is_success() {
        return Err(format!("下载存档失败（HTTP {}）", res.status()));
    }
    if res.content_length().is_some_and(|len| len > MAX_ARCHIVE_BYTES) {
        return Err("存档超过 2GB 限制".into());
    }
    let mut file = File::create(dest).map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut written = 0u64;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let size = res.read(&mut buf).map_err(|e| format!("下载存档失败：{e}"))?;
        if size == 0 {
            break;
        }
        written += size as u64;
        if written > MAX_ARCHIVE_BYTES {
            let _ = fs::remove_file(dest);
            return Err("存档超过 2GB 限制".into());
        }
        file.write_all(&buf[..size]).map_err(|e| format!("写入存档失败：{e}"))?;
    }
    Ok(())
}

fn read_local_3c(docs: &Path, profiles_dir: &Path) -> Vec<(&'static str, Vec<u8>)> {
    let profile = find_newest_profile(profiles_dir);
    let mut files = Vec::new();
    for name in LOCAL_3C {
        let from_profile = profile.as_ref().and_then(|dir| fs::read(dir.join(name)).ok());
        let bytes = if *name == "controls.sii" {
            from_profile
        } else {
            from_profile.or_else(|| fs::read(docs.join(name)).ok())
        };
        if let Some(bytes) = bytes {
            files.push((*name, bytes));
        }
    }
    files
}

fn find_newest_profile(profiles_dir: &Path) -> Option<PathBuf> {
    let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
    for entry in fs::read_dir(profiles_dir).ok()?.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if !dir.join("profile.sii").is_file() && !dir.join("save").is_dir() {
            continue;
        }
        let Ok(modified) = fs::metadata(&dir).and_then(|meta| meta.modified()) else {
            continue;
        };
        if newest.as_ref().is_none_or(|(_, time)| modified > *time) {
            newest = Some((dir, modified));
        }
    }
    newest.map(|(path, _)| path)
}

fn apply_local_3c(
    profiles_dir: &Path,
    names: &[String],
    files: &[(&str, Vec<u8>)],
) -> (Vec<String>, Vec<String>) {
    let mut applied = Vec::new();
    let mut failed = Vec::new();
    for (name, bytes) in files {
        let mut wrote = false;
        for folder in names {
            if fs::write(profiles_dir.join(folder).join(name), bytes).is_ok() {
                wrote = true;
            }
        }
        if wrote {
            applied.push((*name).to_string());
        } else {
            failed.push((*name).to_string());
        }
    }
    (applied, failed)
}

fn extract_profiles(zip_path: &Path, dest: &Path) -> Result<Vec<String>, String> {
    let file = File::open(zip_path).map_err(|e| format!("打开压缩包失败：{e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("压缩包无效：{e}"))?;
    let mut roots = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");
        if name.contains('\0') || name.split('/').any(|part| part == "..") {
            return Err("压缩包包含非法路径".into());
        }
        if name.ends_with("profile.sii") {
            let root = name
                .rsplit_once('/')
                .map(|(dir, _)| dir.to_string())
                .unwrap_or_default();
            roots.push(root);
        }
    }
    roots.sort();
    roots.dedup();
    if roots.is_empty() {
        return Err("压缩包里没有 profile.sii，不能当作活动档案部署".into());
    }
    let mut names = Vec::new();
    let mut inflated = 0u64;
    for root in roots {
        let leaf = root
            .rsplit('/')
            .find(|part| !part.is_empty())
            .unwrap_or("activity");
        let mut folder = safe_name(leaf);
        if folder == "." || folder == ".." {
            folder = "activity".into();
        }
        let mut target = dest.join(&folder);
        let mut n = 2;
        while target.exists() {
            folder = format!("{leaf}-{n}");
            target = dest.join(&folder);
            n += 1;
        }
        ensure_dir(&target)?;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
            let name = entry.name().replace('\\', "/");
            if name.contains('\0') || name.split('/').any(|part| part == "..") {
                return Err("压缩包包含非法路径".into());
            }
            let relative = if root.is_empty() {
                name.clone()
            } else if name == root || name.starts_with(&(root.clone() + "/")) {
                name.trim_start_matches(&root).trim_start_matches('/').to_string()
            } else {
                continue;
            };
            if relative.is_empty() {
                continue;
            }
            let path = contained_join(&target, &relative)?;
            if name.ends_with('/') {
                ensure_dir(&path)?;
                ensure_inside(&target, &path)?;
            } else {
                if let Some(parent) = path.parent() {
                    ensure_dir(parent)?;
                    ensure_inside(&target, parent)?;
                }
                let mut out = File::create(&path).map_err(|e| format!("解压失败：{e}"))?;
                let mut buf = [0u8; 64 * 1024];
                loop {
                    let size = entry.read(&mut buf).map_err(|e| format!("解压失败：{e}"))?;
                    if size == 0 {
                        break;
                    }
                    inflated += size as u64;
                    if inflated > MAX_ARCHIVE_BYTES {
                        return Err("解压后的存档超过 2GB 限制".into());
                    }
                    out.write_all(&buf[..size]).map_err(|e| format!("解压失败：{e}"))?;
                }
            }
        }
        names.push(folder);
    }
    Ok(names)
}

fn list_root_scs(install_root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(install_root) else {
        return out;
    };
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if name.to_ascii_lowercase().ends_with(".scs") {
            out.push(ent.path());
        }
    }
    out
}

fn enable_all_disabled(install_root: &Path) {
    let scan = |dir: PathBuf| {
        let Ok(rd) = fs::read_dir(&dir) else {
            return;
        };
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().to_string();
            let lower = name.to_ascii_lowercase();
            if !lower.starts_with("dlc_") || !lower.contains(".scs.") {
                continue;
            }
            let orig_name = if lower.ends_with(DLC_LEGACY) {
                name[..name.len() - DLC_LEGACY.len()].to_string()
            } else if lower.ends_with(DLC_SUFFIX) {
                name[..name.len() - DLC_SUFFIX.len()].to_string()
            } else {
                continue;
            };
            let orig_path = dir.join(&orig_name);
            if !orig_path.exists() {
                let _ = fs::rename(ent.path(), &orig_path);
            }
        }
    };
    scan(install_root.to_path_buf());
    scan(install_root.join("dlc"));

    for off_name in [DLC_OFF_DIR, "_peak_dlc_off", "_peak_held_dlc"] {
        let off = install_root.join(off_name);
        if let Ok(rd) = fs::read_dir(&off) {
            for ent in rd.flatten() {
                let full = ent.path();
                if !full.is_file() {
                    continue;
                }
                let dest = install_root.join(ent.file_name());
                if !dest.exists() {
                    let _ = fs::rename(&full, &dest);
                }
            }
            let _ = fs::remove_dir(&off);
        }
    }
}

fn disable_catalog(payload: &Value) -> Vec<(String, i64)> {
    let parsed = payload
        .get("disableDlcs")
        .and_then(|value| value.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|item| {
                    let file = item.get("file").and_then(|value| value.as_str()).unwrap_or("").trim().to_string();
                    let id = item
                        .get("id")
                        .and_then(|value| value.as_i64().or_else(|| value.as_u64().and_then(|n| i64::try_from(n).ok())))
                        .unwrap_or(0);
                    if file.is_empty() || id <= 0 { None } else { Some((file, id)) }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !parsed.is_empty() {
        return parsed;
    }
    FLEET_DISABLE_SCS.iter().map(|(file, id)| (file.to_string(), *id)).collect()
}

fn keep_dlc_ids(payload: &Value) -> HashSet<i64> {
    payload
        .get("keepDlcIds")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_i64().or_else(|| v.as_u64().and_then(|n| i64::try_from(n).ok())))
                .filter(|id| *id > 0)
                .collect()
        })
        .unwrap_or_default()
}

fn find_scs_to_disable(install_root: &Path, keep_ids: &HashSet<i64>, catalog: &[(String, i64)]) -> Vec<String> {
    let disable_set: HashSet<String> = catalog
        .iter()
        .filter(|(_, id)| !keep_ids.contains(id))
        .map(|(file, _)| file.to_ascii_lowercase())
        .collect();
    let mut names = Vec::new();
    for file in list_root_scs(install_root) {
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !disable_set.contains(&name.to_ascii_lowercase()) {
            continue;
        }
        if fs::metadata(&file).is_ok_and(|meta| meta.len() > 16) {
            names.push(name);
        }
    }
    names
}

fn disable_selected(install_root: &Path, scs_names: &[String]) -> Vec<HeldFile> {
    let wanted: HashSet<String> = scs_names.iter().map(|n| n.to_ascii_lowercase()).collect();
    let off = install_root.join(DLC_OFF_DIR);
    let _ = fs::create_dir_all(&off);
    let mut moved = Vec::new();
    for file in list_root_scs(install_root) {
        let base = file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !wanted.contains(&base.to_ascii_lowercase()) {
            continue;
        }
        let bak = PathBuf::from(format!("{}{DLC_SUFFIX}", file.display()));
        let legacy = PathBuf::from(format!("{}{DLC_LEGACY}", file.display()));
        let _ = fs::remove_file(&bak);
        let _ = fs::remove_file(&legacy);
        let dest = off.join(&base);
        if dest.exists() {
            let _ = fs::remove_file(&dest);
        }
        let parked = if fs::rename(&file, &dest).is_ok() {
            dest
        } else if fs::rename(&file, &bak).is_ok() {
            bak
        } else {
            continue;
        };
        moved.push(HeldFile {
            from: file.display().to_string(),
            to: parked.display().to_string(),
        });
    }
    moved
}

fn contained_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut out = root.to_path_buf();
    for part in relative.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains('\0') || part.contains(':') {
            return Err("压缩包包含非法路径".into());
        }
        out.push(part);
    }
    Ok(out)
}

fn ensure_inside(root: &Path, path: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|e| format!("无法解析档案目录：{e}"))?;
    let path = fs::canonicalize(path).map_err(|e| format!("无法解析解压路径：{e}"))?;
    let root_text = root.to_string_lossy().trim_end_matches(['\\', '/']).to_ascii_lowercase();
    let path_text = path.to_string_lossy().to_ascii_lowercase();
    if path_text == root_text || path_text.starts_with(&(root_text.clone() + "\\")) || path_text.starts_with(&(root_text + "/")) {
        Ok(())
    } else {
        Err("压缩包路径超出档案目录".into())
    }
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| if "\\/:*?\"<>|".contains(ch) { '_' } else { ch })
        .collect();
    if cleaned.trim().is_empty() {
        "activity".into()
    } else {
        cleaned
    }
}
