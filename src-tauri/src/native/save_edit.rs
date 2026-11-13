use super::paths::resolve_docs;
use super::sii::{field_key, indent_of, join_lines, read_sii, rewrite_value, split_lines, value_of};
use super::support::{ensure_dir, ensure_game_closed, stamp_file, toolbox_root};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const MONEY: &str = "70000000";
const EXPERIENCE: &str = "575700";
const SKILL: &str = "6";
const ADR: &str = "63";

struct Profile {
    id: String,
    label: String,
    folder: PathBuf,
}

struct SaveSlot {
    id: String,
    label: String,
    folder: PathBuf,
}

pub fn status(payload: &Value) -> Result<Value, String> {
    let docs = match resolve_docs(payload.get("docsPath").and_then(|v| v.as_str()).unwrap_or("")) {
        Ok(path) => path,
        Err(message) => {
            return Ok(json!({
                "ok": false,
                "message": message,
                "profiles": [],
                "saves": [],
            }));
        }
    };
    let profiles = list_profiles(&docs);
    let selected = pick_profile(&profiles, payload.get("profileId").and_then(|v| v.as_str()));
    let saves = selected
        .map(|p| list_saves(&p.folder))
        .unwrap_or_default();
    let save = pick_save(&saves, payload.get("saveId").and_then(|v| v.as_str()));
    let snapshot = save.and_then(|slot| read_snapshot(&slot.folder.join("game.sii")).ok());
    Ok(json!({
        "ok": true,
        "docsPath": docs.display().to_string(),
        "gameRunning": super::support::game_running(),
        "profiles": profiles.iter().map(|p| json!({"id": p.id, "label": p.label})).collect::<Vec<_>>(),
        "selectedProfileId": selected.map(|p| p.id.clone()),
        "saves": saves.iter().map(|s| json!({"id": s.id, "label": s.label})).collect::<Vec<_>>(),
        "selectedSaveId": save.map(|s| s.id.clone()),
        "money": snapshot.as_ref().map(|s| s.money.clone()),
        "experience": snapshot.as_ref().map(|s| s.experience.clone()),
        "skillsMax": snapshot.as_ref().map(|s| s.skills_max).unwrap_or(false),
        "cities": snapshot.as_ref().map(|s| s.cities).unwrap_or(0),
        "dealers": snapshot.as_ref().map(|s| s.dealers).unwrap_or(0),
        "garagesTotal": snapshot.as_ref().map(|s| s.garages_total).unwrap_or(0),
        "garagesUpgradeable": snapshot.as_ref().map(|s| s.garages_upgradeable).unwrap_or(0),
        "message": if profiles.is_empty() { "未找到本地档案" } else { "" },
    }))
}

pub fn apply(payload: &Value) -> Result<Value, String> {
    ensure_game_closed()?;
    let docs = resolve_docs(payload.get("docsPath").and_then(|v| v.as_str()).unwrap_or(""))?;
    let profiles = list_profiles(&docs);
    let profile = pick_profile(&profiles, payload.get("profileId").and_then(|v| v.as_str()))
        .ok_or("请选择档案")?;
    let saves = list_saves(&profile.folder);
    let save = pick_save(&saves, payload.get("saveId").and_then(|v| v.as_str()))
        .ok_or("请选择存档点")?;
    let game = save.folder.join("game.sii");
    let text = read_sii(&game)?;
    let (mut lines, newline) = split_lines(&text);

    let backup_dir = toolbox_root().join("存档修改").join(stamp_file());
    ensure_dir(&backup_dir)?;
    fs::copy(&game, backup_dir.join("game.sii")).map_err(|e| format!("备份失败：{e}"))?;

    let money = set_in_bank(&mut lines, "money_account", MONEY);
    let experience = set_first(&mut lines, "experience_points", EXPERIENCE);
    let skills = set_skills(&mut lines);
    let (cities, dealers) = unlock_places(&mut lines);
    let (garages_upgraded, garages_skipped) = upgrade_garages(&mut lines);

    fs::write(&game, join_lines(&lines, newline)).map_err(|e| format!("写入存档失败：{e}"))?;
    Ok(json!({
        "ok": true,
        "message": "存档已修改",
        "backupPath": backup_dir.display().to_string(),
        "money": money,
        "experience": experience,
        "skills": skills,
        "cities": cities,
        "dealers": dealers,
        "garagesUpgraded": garages_upgraded,
        "garagesSkipped": garages_skipped,
    }))
}

pub fn open_backup() -> Result<Value, String> {
    let dir = toolbox_root().join("存档修改");
    ensure_dir(&dir)?;
    super::support::open_path(&dir.display().to_string())?;
    Ok(json!({ "ok": true, "path": dir.display().to_string() }))
}

struct Snapshot {
    money: String,
    experience: String,
    skills_max: bool,
    cities: u32,
    dealers: u32,
    garages_total: u32,
    garages_upgradeable: u32,
}

fn read_snapshot(path: &Path) -> Result<Snapshot, String> {
    let text = read_sii(path)?;
    let (lines, _) = split_lines(&text);
    let (total, upgradeable) = count_garages(&lines);
    Ok(Snapshot {
        money: first_value(&lines, "money_account"),
        experience: first_value(&lines, "experience_points"),
        skills_max: skills_are_max(&lines),
        cities: header_count(&lines, "visited_cities"),
        dealers: header_count(&lines, "unlocked_dealers"),
        garages_total: total,
        garages_upgradeable: upgradeable,
    })
}

fn list_profiles(docs: &Path) -> Vec<Profile> {
    let root = docs.join("profiles");
    let Ok(read) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for entry in read.flatten() {
        let folder = entry.path();
        if !folder.is_dir() || !folder.join("profile.sii").is_file() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let label = profile_label(&folder).unwrap_or_else(|| id.clone());
        items.push(Profile { id, label, folder });
    }
    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

fn list_saves(profile: &Path) -> Vec<SaveSlot> {
    let root = profile.join("save");
    let Ok(read) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for entry in read.flatten() {
        let folder = entry.path();
        if !folder.is_dir() || !folder.join("game.sii").is_file() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        items.push(SaveSlot {
            label: save_label(&id),
            id,
            folder,
        });
    }
    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

fn profile_label(folder: &Path) -> Option<String> {
    let text = fs::read_to_string(folder.join("profile.sii")).ok()?;
    for line in text.lines() {
        if field_key(line) == Some("profile_name") {
            let name = value_of(line);
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

fn save_label(id: &str) -> String {
    match id {
        "quicksave" => "快速存档".into(),
        "autosave" => "自动存档".into(),
        other => format!("存档 {other}"),
    }
}

fn pick_profile<'a>(items: &'a [Profile], id: Option<&str>) -> Option<&'a Profile> {
    if let Some(id) = id {
        if let Some(found) = items.iter().find(|p| p.id == id) {
            return Some(found);
        }
    }
    items.first()
}

fn pick_save<'a>(items: &'a [SaveSlot], id: Option<&str>) -> Option<&'a SaveSlot> {
    if let Some(id) = id {
        if let Some(found) = items.iter().find(|s| s.id == id) {
            return Some(found);
        }
    }
    items.iter().find(|s| s.id != "autosave").or_else(|| items.first())
}

fn first_value(lines: &[String], key: &str) -> String {
    lines
        .iter()
        .find(|line| field_key(line) == Some(key))
        .map(|line| value_of(line))
        .unwrap_or_default()
}

fn header_count(lines: &[String], key: &str) -> u32 {
    first_value(lines, key).parse().unwrap_or(0)
}

fn set_first(lines: &mut [String], key: &str, value: &str) -> bool {
    for line in lines.iter_mut() {
        if field_key(line) == Some(key) {
            *line = rewrite_value(line, value);
            return true;
        }
    }
    false
}

fn set_in_bank(lines: &mut [String], key: &str, value: &str) -> bool {
    let mut inside = false;
    for line in lines.iter_mut() {
        let trimmed = line.trim();
        if trimmed.starts_with("bank :") && trimmed.ends_with('{') {
            inside = true;
            continue;
        }
        if !inside {
            continue;
        }
        if trimmed == "}" {
            break;
        }
        if field_key(line) == Some(key) {
            *line = rewrite_value(line, value);
            return true;
        }
    }
    set_first(lines, key, value)
}

fn set_skills(lines: &mut [String]) -> bool {
    let stop = lines
        .iter()
        .position(|line| field_key(line) == Some("user_colors"))
        .unwrap_or(lines.len());
    let mut found = false;
    for line in lines.iter_mut().take(stop) {
        let value = match field_key(line) {
            Some("adr") => ADR,
            Some("long_dist" | "heavy" | "fragile" | "urgent" | "mechanical") => SKILL,
            _ => continue,
        };
        *line = rewrite_value(line, value);
        found = true;
    }
    found
}

fn skills_are_max(lines: &[String]) -> bool {
    let stop = lines
        .iter()
        .position(|line| field_key(line) == Some("user_colors"))
        .unwrap_or(lines.len());
    let mut seen = 0u8;
    for line in lines.iter().take(stop) {
        let ok = match field_key(line) {
            Some("adr") => value_of(line) == ADR,
            Some("long_dist" | "heavy" | "fragile" | "urgent" | "mechanical") => value_of(line) == SKILL,
            _ => continue,
        };
        if !ok {
            return false;
        }
        seen += 1;
    }
    seen >= 6
}

fn city_names(lines: &[String]) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for line in lines {
        let value = value_of(line);
        let Some(token) = value.split_whitespace().next() else {
            continue;
        };
        let Some(rest) = token.strip_prefix("company.volatile.") else {
            continue;
        };
        if let Some(city) = rest.rsplit('.').next() {
            if !city.is_empty() && city != "null" {
                names.insert(city.to_string());
            }
        }
    }
    names
}

fn indexed_block(indent: &str, key: &str, names: &BTreeSet<String>, with_count: bool) -> Vec<String> {
    let mut lines = vec![format!("{indent}{key}: {}", names.len())];
    for (idx, name) in names.iter().enumerate() {
        lines.push(format!("{indent}{key}[{idx}]: {name}"));
    }
    if with_count {
        lines.push(format!("{indent}{key}_count: {}", names.len()));
        for idx in 0..names.len() {
            lines.push(format!("{indent}{key}_count[{idx}]: 1"));
        }
    }
    lines
}

fn replace_until(lines: &mut Vec<String>, start_key: &str, end_key: &str, block: Vec<String>) -> bool {
    let Some(start) = lines.iter().position(|line| field_key(line) == Some(start_key)) else {
        return false;
    };
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, line)| field_key(line) == Some(end_key))
        .map(|(idx, _)| idx)
        .unwrap_or(lines.len());
    lines.splice(start..end, block);
    true
}

fn unlock_places(lines: &mut Vec<String>) -> (usize, usize) {
    let names = city_names(lines);
    if names.is_empty() {
        return (0, 0);
    }
    let indent = lines
        .iter()
        .find(|line| field_key(line) == Some("visited_cities"))
        .map(|line| indent_of(line).to_string())
        .unwrap_or_else(|| " ".into());
    let cities = if replace_until(
        lines,
        "visited_cities",
        "last_visited_city",
        indexed_block(&indent, "visited_cities", &names, true),
    ) {
        names.len()
    } else {
        0
    };
    let dealers = if replace_until(
        lines,
        "unlocked_dealers",
        "unlocked_recruitments",
        indexed_block(&indent, "unlocked_dealers", &names, false),
    ) {
        names.len()
    } else {
        0
    };
    (cities, dealers)
}

fn is_garage_header(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with("garage :") && trimmed.ends_with('{')
}

fn block_end(lines: &[String], start: usize) -> Option<usize> {
    lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, line)| line.trim() == "}")
        .map(|(idx, _)| idx)
}

fn garage_occupied(lines: &[String], start: usize, end: usize) -> bool {
    for line in &lines[start + 1..end] {
        let Some(key) = field_key(line) else { continue };
        let indexed = key.starts_with("vehicles[")
            || key.starts_with("drivers[")
            || key.starts_with("trailers[");
        if indexed && value_of(line) != "null" {
            return true;
        }
    }
    false
}

fn slot_count_is(lines: &[String], start: usize, end: usize, name: &str) -> bool {
    let Some(header) = lines[start + 1..end]
        .iter()
        .find(|line| field_key(line) == Some(name))
    else {
        return false;
    };
    if value_of(header) != "5" {
        return false;
    }
    let mut count = 0u32;
    let prefix = format!("{name}[");
    for line in &lines[start + 1..end] {
        let Some(key) = field_key(line) else { continue };
        if key.starts_with(&prefix) {
            if value_of(line) != "null" {
                return false;
            }
            count += 1;
        }
    }
    count == 5
}

fn garage_already_large(lines: &[String], start: usize, end: usize) -> bool {
    let status_ok = lines[start + 1..end]
        .iter()
        .any(|line| field_key(line) == Some("status") && value_of(line) == "3");
    status_ok
        && slot_count_is(lines, start, end, "vehicles")
        && slot_count_is(lines, start, end, "drivers")
}

fn count_garages(lines: &[String]) -> (u32, u32) {
    let mut total = 0u32;
    let mut upgradeable = 0u32;
    let mut idx = 0usize;
    while idx < lines.len() {
        if !is_garage_header(&lines[idx]) {
            idx += 1;
            continue;
        }
        let Some(end) = block_end(lines, idx) else {
            idx += 1;
            continue;
        };
        total += 1;
        if !garage_occupied(lines, idx, end) && !garage_already_large(lines, idx, end) {
            upgradeable += 1;
        }
        idx = end + 1;
    }
    (total, upgradeable)
}

fn field_range(lines: &[String], start: usize, end: usize, name: &str) -> Option<(usize, usize)> {
    let prefix = format!("{name}[");
    let mut begin = None;
    for idx in (start + 1)..end {
        let key = field_key(&lines[idx]).unwrap_or("");
        let hit = key == name || key.starts_with(&prefix);
        if begin.is_none() {
            if hit {
                begin = Some(idx);
            }
        } else if !hit {
            return Some((begin.unwrap(), idx));
        }
    }
    begin.map(|b| (b, end))
}

fn empty_slots(indent: &str, name: &str) -> Vec<String> {
    let mut lines = vec![format!("{indent}{name}: 5")];
    for idx in 0..5 {
        lines.push(format!("{indent}{name}[{idx}]: null"));
    }
    lines
}

fn replace_array(lines: &mut Vec<String>, start: usize, end: &mut usize, name: &str, indent: &str) {
    let block = empty_slots(indent, name);
    if let Some((from, to)) = field_range(lines, start, *end, name) {
        let delta = block.len() as isize - (to - from) as isize;
        lines.splice(from..to, block);
        *end = (*end as isize + delta) as usize;
    }
}

fn upgrade_garages(lines: &mut Vec<String>) -> (usize, usize) {
    let mut upgraded = 0usize;
    let mut skipped = 0usize;
    let mut idx = 0usize;
    while idx < lines.len() {
        if !is_garage_header(&lines[idx]) {
            idx += 1;
            continue;
        }
        let Some(mut end) = block_end(lines, idx) else {
            idx += 1;
            continue;
        };
        if garage_occupied(lines, idx, end) {
            skipped += 1;
            idx = end + 1;
            continue;
        }
        if garage_already_large(lines, idx, end) {
            idx = end + 1;
            continue;
        }
        let indent = lines[idx + 1..end]
            .iter()
            .find(|line| !line.trim().is_empty())
            .map(|line| indent_of(line).to_string())
            .unwrap_or_else(|| " ".into());
        replace_array(lines, idx, &mut end, "drivers", &indent);
        replace_array(lines, idx, &mut end, "vehicles", &indent);
        let mut wrote = false;
        for line_idx in (idx + 1)..end {
            if field_key(&lines[line_idx]) == Some("status") {
                lines[line_idx] = rewrite_value(&lines[line_idx], "3");
                wrote = true;
                break;
            }
        }
        if !wrote {
            lines.insert(end, format!("{indent}status: 3"));
        }
        upgraded += 1;
        idx = end + 1;
    }
    (upgraded, skipped)
}
