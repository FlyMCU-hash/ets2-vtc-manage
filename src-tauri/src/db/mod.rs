mod route;
mod http;

pub use http::serve;

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::RngCore;
use serde_json::{json, Value};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow};
use sqlx::{MySqlPool, Row};
use std::path::PathBuf;
use std::sync::OnceLock;

pub use route::dispatch;

const PERMS: &[&str] = &[
    "members", "points", "activities", "store", "dlc", "monitor", "settings",
];

pub struct Member {
    pub id: i32,
    pub number: i32,
    pub tmp_id: String,
    pub name: String,
    pub password_hash: String,
    pub qq: String,
    pub role: String,
    pub score: i32,
    pub join_date: String,
    pub leave_date: String,
    pub is_admin: bool,
    pub is_super: bool,
    pub permissions: Value,
    pub steam_id: String,
}

static POOL: OnceLock<MySqlPool> = OnceLock::new();

pub async fn pool() -> Result<MySqlPool, String> {
    if let Some(pool) = POOL.get() {
        return Ok(pool.clone());
    }
    load_env();
    let created = connect().await?;
    migrate(&created).await?;
    seed(&created).await?;
    let _ = POOL.set(created.clone());
    Ok(POOL.get().cloned().unwrap_or(created))
}

fn load_env() {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(".env"));
        }
    }
    candidates.push(PathBuf::from(".env"));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env"));
    candidates.push(PathBuf::from("../.env"));
    for path in candidates {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            if key.is_empty() || std::env::var_os(key).is_some() {
                continue;
            }
            std::env::set_var(key, value.trim().trim_matches('"'));
        }
        return;
    }
}

fn env_str(key: &str, fallback: &str) -> String {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| fallback.to_string())
}

fn db_name() -> String {
    let name = env_str("DB_NAME", "peak");
    if name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
        name
    } else {
        "peak".into()
    }
}

fn options(database: &str) -> MySqlConnectOptions {
    MySqlConnectOptions::new()
        .host(&env_str("DB_HOST", "127.0.0.1"))
        .port(env_str("DB_PORT", "3306").parse().unwrap_or(3306))
        .username(&env_str("DB_USER", "peak"))
        .password(&env_str("DB_PASSWORD", ""))
        .database(database)
        .charset("utf8mb4")
}

async fn try_connect(database: &str) -> Result<MySqlPool, String> {
    MySqlPoolOptions::new()
        .max_connections(8)
        .acquire_timeout(std::time::Duration::from_secs(8))
        .connect_with(options(database))
        .await
        .map_err(|err| err.to_string())
}

async fn connect() -> Result<MySqlPool, String> {
    let name = db_name();
    match try_connect(&name).await {
        Ok(pool) => Ok(pool),
        Err(err) if err.contains("Unknown database") => {
            let server = try_connect("mysql").await.map_err(|e| format!("无法连接 MySQL：{e}"))?;
            let sql = format!(
                "CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            );
            sqlx::query(&sql)
                .execute(&server)
                .await
                .map_err(|e| format!("创建数据库失败：{e}"))?;
            try_connect(&name).await.map_err(|e| format!("无法连接数据库：{e}"))
        }
        Err(err) => Err(format!("无法连接数据库：{err}")),
    }
}

async fn migrate(pool: &MySqlPool) -> Result<(), String> {
    for statement in include_str!("schema.sql").split(';') {
        let statement = statement
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        if statement.is_empty() {
            continue;
        }
        sqlx::query(&statement)
            .execute(pool)
            .await
            .map_err(|err| format!("建表失败：{err}"))?;
    }
    Ok(())
}

async fn seed(pool: &MySqlPool) -> Result<(), String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM center_members")
        .fetch_one(pool)
        .await
        .map_err(|err| err.to_string())?;
    if count == 0 {
        let password = random_password(10);
        let hash = hash_password(&password)?;
        sqlx::query(
            "INSERT INTO center_members
             (number, tmp_id, name, password_hash, role, is_admin, is_super)
             VALUES (0, 'admin', '超级管理员', ?, '超级管理员', 1, 1)",
        )
        .bind(&hash)
        .execute(pool)
        .await
        .map_err(|err| format!("创建初始管理员失败：{err}"))?;
        let dir = app_dir();
        std::fs::create_dir_all(&dir).ok();
        let note = dir.join("initial-admin.txt");
        let _ = std::fs::write(
            &note,
            format!("TMP ID: admin\r\n密码: {password}\r\n请登录后立即到账号设置修改密码。\r\n"),
        );
    }
    let dlc_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM center_dlcs")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    if dlc_count == 0 {
        for (zh, en, file) in MAP_DLCS {
            sqlx::query(
                "INSERT INTO center_dlcs (name_zh, name_en, kind, scs_files) VALUES (?, ?, 1, ?)",
            )
            .bind(zh)
            .bind(en)
            .bind(format!("[\"{file}\"]"))
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

const MAP_DLCS: &[(&str, &str, &str)] = &[
    ("斯堪的纳维亚", "Scandinavia", "dlc_north.scs"),
    ("走向东部", "Going East", "dlc_east.scs"),
    ("法国", "Vive la France", "dlc_fr.scs"),
    ("意大利", "Italia", "dlc_it.scs"),
    ("波罗的海", "Beyond the Baltic Sea", "dlc_balt.scs"),
    ("黑海以东", "Road to the Black Sea", "dlc_balkan_e.scs"),
    ("巴尔干西部", "West Balkans", "dlc_balkan_w.scs"),
    ("伊比利亚", "Iberia", "dlc_iberia.scs"),
    ("希腊", "Greece", "dlc_greece.scs"),
    ("北欧风光", "Nordic Horizons", "dlc_nordic.scs"),
];

pub fn app_dir() -> PathBuf {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local).join("Peak车队中心");
    }
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|dir| dir.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("data")
}

pub fn upload_root() -> PathBuf {
    let custom = env_str("UPLOAD_ROOT", "");
    if custom.is_empty() {
        app_dir().join("uploads")
    } else {
        PathBuf::from(custom)
    }
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| format!("密码加密失败：{err}"))
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored) else {
        return false;
    };
    Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
}

pub fn new_token() -> String {
    let mut bytes = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn random_password(len: usize) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut bytes = vec![0u8; len];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.into_iter().map(|b| CHARSET[(b as usize) % CHARSET.len()] as char).collect()
}

const MEMBER_SQL: &str = "SELECT id, number, tmp_id, name, password_hash, qq, role, score,
  IFNULL(DATE_FORMAT(join_date, '%Y-%m-%d'), '') AS join_date,
  IFNULL(DATE_FORMAT(leave_date, '%Y-%m-%d'), '') AS leave_date,
  is_admin, is_super, IFNULL(permissions, '') AS permissions, IFNULL(steam_id, '') AS steam_id
  FROM center_members";

pub async fn member_by_id(pool: &MySqlPool, id: i32) -> Result<Option<Member>, String> {
    let row = sqlx::query(&format!("{MEMBER_SQL} WHERE id = ? LIMIT 1"))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(row.map(member_from_row))
}

pub async fn member_by_tmp(pool: &MySqlPool, tmp_id: &str) -> Result<Option<Member>, String> {
    let row = sqlx::query(&format!("{MEMBER_SQL} WHERE tmp_id = ? LIMIT 1"))
        .bind(tmp_id)
        .fetch_optional(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(row.map(member_from_row))
}

fn member_from_row(row: MySqlRow) -> Member {
    let permissions = row.try_get::<String, _>("permissions").unwrap_or_default();
    let parsed = serde_json::from_str(&permissions).unwrap_or(Value::Null);
    Member {
        id: row.try_get("id").unwrap_or(0),
        number: row.try_get("number").unwrap_or(0),
        tmp_id: row.try_get("tmp_id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        password_hash: row.try_get("password_hash").unwrap_or_default(),
        qq: row.try_get("qq").unwrap_or_default(),
        role: row.try_get("role").unwrap_or_default(),
        score: row.try_get("score").unwrap_or(0),
        join_date: row.try_get("join_date").unwrap_or_default(),
        leave_date: row.try_get("leave_date").unwrap_or_default(),
        is_admin: flag(&row, "is_admin"),
        is_super: flag(&row, "is_super"),
        permissions: parsed,
        steam_id: row.try_get("steam_id").unwrap_or_default(),
    }
}

fn flag(row: &MySqlRow, key: &str) -> bool {
    row.try_get::<i8, _>(key).map(|n| n != 0).unwrap_or(false)
        || row.try_get::<bool, _>(key).unwrap_or(false)
        || row.try_get::<i32, _>(key).map(|n| n != 0).unwrap_or(false)
}

pub fn public_user(member: &Member) -> Value {
    json!({
        "id": member.id,
        "number": if member.number == 0 { Value::Null } else { json!(member.number) },
        "tmpId": member.tmp_id,
        "name": member.name,
        "qq": member.qq,
        "role": member.role,
        "score": member.score,
        "joinDate": member.join_date,
        "leaveDate": member.leave_date,
        "left": !member.leave_date.is_empty(),
        "isAdmin": member.is_admin || member.is_super,
        "isSuper": member.is_super,
        "steamId": member.steam_id,
        "permissions": permission_map(member),
    })
}

pub fn permission_map(member: &Member) -> Value {
    let mut map = serde_json::Map::new();
    for key in PERMS {
        let allowed = member.is_super
            || member.permissions.get(*key).and_then(|v| v.as_bool()).unwrap_or(true);
        map.insert((*key).into(), json!(allowed));
    }
    Value::Object(map)
}

pub fn allows(member: &Member, perm: &str) -> bool {
    member.is_super || member.permissions.get(perm).and_then(|v| v.as_bool()).unwrap_or(true)
}

pub fn fail(status: i32, message: impl Into<String>) -> Value {
    json!({ "ok": false, "status": status, "message": message.into() })
}

pub fn done(mut value: Value) -> Value {
    if let Some(map) = value.as_object_mut() {
        map.insert("ok".into(), json!(true));
        value
    } else {
        json!({ "ok": true, "data": value })
    }
}

pub async fn next_number(pool: &MySqlPool) -> Result<i32, String> {
    let max: Option<i32> = sqlx::query_scalar("SELECT MAX(number) FROM center_members WHERE is_super = 0")
        .fetch_one(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(max.unwrap_or(0) + 1)
}
