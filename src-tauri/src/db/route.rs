use super::{
    allows, done, fail, hash_password, member_by_id, member_by_tmp, new_token, next_number,
    public_user, upload_root, verify_password, Member,
};
use base64::Engine;
use serde_json::{json, Value};
use sqlx::{MySqlPool, Row};
use std::path::Path;

pub async fn dispatch(
    pool: &MySqlPool,
    method: &str,
    path: &str,
    body: Value,
    token: String,
    admin_token: String,
) -> Value {
    let method = method.to_ascii_uppercase();
    let (path, query) = split_path(path);
    let result = route(pool, &method, &path, &query, body, &token, &admin_token).await;
    match result {
        Ok(value) => value,
        Err(err) => fail(500, err),
    }
}

async fn route(
    pool: &MySqlPool,
    method: &str,
    path: &str,
    query: &str,
    body: Value,
    token: &str,
    admin_token: &str,
) -> Result<Value, String> {
    if path == "/api/client/ping" {
        sqlx::query("SELECT 1").execute(pool).await.map_err(|err| err.to_string())?;
        return Ok(done(json!({
            "message": "车队中心在线",
        })));
    }
    if path == "/api/map/config" {
        return Ok(map_config());
    }
    if path == "/api/client/login" && method == "POST" {
        return login(pool, &body, false).await;
    }
    if path == "/api/login" && method == "POST" {
        return login(pool, &body, true).await;
    }
    if path == "/api/client/logout" && method == "POST" {
        let member = match client(pool, token).await? {
            Ok(member) => member,
            Err(value) => return Ok(value),
        };
        sqlx::query("DELETE FROM center_sessions WHERE member_id = ?")
            .bind(member.id)
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
        return Ok(done(json!({})));
    }
    if path == "/api/client/me" {
        let member = match client(pool, token).await? {
            Ok(member) => member,
            Err(value) => return Ok(value),
        };
        let admin = ensure_admin_token(pool, &member).await?;
        return Ok(done(json!({
            "user": public_user(&member),
            "adminToken": admin.0,
            "adminUser": admin.1,
        })));
    }
    if path == "/api/client/password" && method == "PUT" {
        return change_password(pool, token, &body).await;
    }
    if path.starts_with("/api/client/") {
        let member = match client(pool, token).await? {
            Ok(member) => member,
            Err(value) => return Ok(value),
        };
        if path == "/api/client/activities" {
            return list_activities(pool).await;
        }
        if let Some(id) = prefixed(path, "/api/client/activities/") {
            if path.ends_with("/files") {
                return list_files(pool, id).await;
            }
        }
        if path == "/api/client/map-dlcs" {
            return list_dlc(pool, "1", false).await;
        }
        if path == "/api/client/members" {
            return list_members(pool, true).await;
        }
        if path == "/api/client/store" {
            let items = products(pool, true).await?;
            return Ok(done(json!({ "score": member.score, "items": items })));
        }
        if path == "/api/client/store/redeem" && method == "POST" {
            return redeem(pool, token, &body).await;
        }
        if path == "/api/client/redeems" {
            return list_redeems(pool, Some(member.id)).await;
        }
        return Ok(fail(404, "接口不存在"));
    }

    let member = match admin(pool, admin_token).await? {
        Ok(member) => member,
        Err(value) => return Ok(value),
    };

    admin_route(pool, method, path, query, body, &member).await
}

fn split_path(raw: &str) -> (String, String) {
    let mut parts = raw.splitn(2, '?');
    let path = parts.next().unwrap_or(raw).trim_end_matches('/').to_string();
    let query = parts.next().unwrap_or("").to_string();
    (if path.is_empty() { "/".into() } else { path }, query)
}

fn prefixed(path: &str, prefix: &str) -> Option<i32> {
    let rest = path.strip_prefix(prefix)?;
    let id = rest.split('/').next().unwrap_or("");
    id.parse().ok()
}

fn map_config() -> Value {
    done(json!({
        "source": "ets2map",
        "ets": {
            "tileUrl": "https://ets2.online/map/ets2map_159/{z}/{x}/{y}.png",
            "fallbackUrl": "https://ets2.online/map/ets2map_159/{z}/{x}/{y}.png",
            "maxZoom": 8, "minZoom": 2, "tileSize": 512,
            "bounds": { "x": 131072, "y": 131072 }
        },
        "promods": {
            "tileUrl": "https://ets2.online/map/ets2mappromods_158/{z}/{x}/{y}.png",
            "fallbackUrl": "https://ets2.online/map/ets2mappromods_158/{z}/{x}/{y}.png",
            "maxZoom": 8, "minZoom": 2, "tileSize": 512,
            "bounds": { "x": 131072, "y": 131072 }
        }
    }))
}

async fn client(pool: &MySqlPool, token: &str) -> Result<Result<Member, Value>, String> {
    session_member(pool, token, false).await
}

async fn admin(pool: &MySqlPool, token: &str) -> Result<Result<Member, Value>, String> {
    session_member(pool, token, true).await
}

async fn session_member(pool: &MySqlPool, token: &str, admin: bool) -> Result<Result<Member, Value>, String> {
    if token.is_empty() {
        return Ok(Err(fail(if admin { 403 } else { 401 }, if admin { "需要管理权限，请使用管理员账号登录" } else { "未登录" })));
    }
    let row = sqlx::query("SELECT member_id, kind FROM center_sessions WHERE token = ? LIMIT 1")
        .bind(token)
        .fetch_optional(pool)
        .await
        .map_err(|err| err.to_string())?;
    let Some(row) = row else {
        return Ok(Err(fail(401, "登录已过期")));
    };
    let kind: String = row.try_get("kind").unwrap_or_default();
    if admin && kind != "admin" {
        return Ok(Err(fail(403, "需要管理权限，请使用管理员账号登录")));
    }
    let id: i32 = row.try_get("member_id").unwrap_or(0);
    let Some(member) = member_by_id(pool, id).await? else {
        return Ok(Err(fail(401, "登录已过期")));
    };
    if !member.leave_date.is_empty() {
        return Ok(Err(fail(403, "该成员已退队，无法登录")));
    }
    if admin && !(member.is_admin || member.is_super) {
        return Ok(Err(fail(403, "需要管理权限")));
    }
    Ok(Ok(member))
}

fn need(member: &Member, perm: &str) -> Result<(), Value> {
    if allows(member, perm) {
        Ok(())
    } else {
        Err(fail(403, "没有这项权限"))
    }
}

async fn login(pool: &MySqlPool, body: &Value, admin_only: bool) -> Result<Value, String> {
    let tmp_id = text(body, if admin_only { "username" } else { "tmpId" });
    let tmp_id = if tmp_id.is_empty() { text(body, "tmpId") } else { tmp_id };
    let password = text(body, "password");
    if tmp_id.is_empty() || password.is_empty() {
        return Ok(fail(400, "请输入 TMP ID 和密码"));
    }
    let Some(member) = member_by_tmp(pool, &tmp_id).await? else {
        return Ok(fail(401, "TMP ID 或密码错误"));
    };
    if !member.leave_date.is_empty() {
        return Ok(fail(403, "该成员已退队，无法登录"));
    }
    if member.password_hash.is_empty() {
        return Ok(fail(403, "未设置密码，请联系管理员"));
    }
    if !verify_password(&password, &member.password_hash) {
        return Ok(fail(401, "TMP ID 或密码错误"));
    }
    if admin_only && !(member.is_admin || member.is_super) {
        return Ok(fail(403, "该账号不是管理员"));
    }
    let client_token = insert_session(pool, member.id, "client").await?;
    let (admin_token, admin_user) = ensure_admin_token(pool, &member).await?;
    if admin_only {
        return Ok(done(json!({
            "token": admin_token,
            "user": public_user(&member),
        })));
    }
    Ok(done(json!({
        "token": client_token,
        "user": public_user(&member),
        "adminToken": admin_token,
        "adminUser": admin_user,
    })))
}

async fn insert_session(pool: &MySqlPool, member_id: i32, kind: &str) -> Result<String, String> {
    let token = new_token();
    sqlx::query("INSERT INTO center_sessions (token, member_id, kind, host, client_name) VALUES (?, ?, ?, '本机', 'Peak车队中心')")
        .bind(&token)
        .bind(member_id)
        .bind(kind)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(token)
}

async fn ensure_admin_token(pool: &MySqlPool, member: &Member) -> Result<(Value, Value), String> {
    if !(member.is_admin || member.is_super) {
        return Ok((Value::Null, Value::Null));
    }
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT token FROM center_sessions WHERE member_id = ? AND kind = 'admin' ORDER BY id DESC LIMIT 1",
    )
    .bind(member.id)
    .fetch_optional(pool)
    .await
    .map_err(|err| err.to_string())?;
    let token = if let Some(token) = existing {
        token
    } else {
        insert_session(pool, member.id, "admin").await?
    };
    Ok((json!(token), public_user(member)))
}

async fn change_password(pool: &MySqlPool, token: &str, body: &Value) -> Result<Value, String> {
    let member = match client(pool, token).await? {
        Ok(member) => member,
        Err(value) => return Ok(value),
    };
    let old = text(body, "oldPassword");
    let next = text(body, "newPassword");
    let confirm = text(body, "confirmPassword");
    if next != confirm {
        return Ok(fail(400, "两次输入的新密码不一致"));
    }
    if next.chars().count() < 6 {
        return Ok(fail(400, "新密码至少 6 位"));
    }
    if !verify_password(&old, &member.password_hash) {
        return Ok(fail(400, "原密码不正确"));
    }
    let hash = hash_password(&next)?;
    sqlx::query("UPDATE center_members SET password_hash = ? WHERE id = ?")
        .bind(hash)
        .bind(member.id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "密码已修改" })))
}

fn text(body: &Value, key: &str) -> String {
    body.get(key).and_then(|v| v.as_str()).unwrap_or("").trim().to_string()
}

async fn list_members(pool: &MySqlPool, active_only: bool) -> Result<Value, String> {
    let sql = if active_only {
        "SELECT id FROM center_members WHERE leave_date IS NULL AND is_super = 0 ORDER BY number, id"
    } else {
        "SELECT id FROM center_members WHERE is_super = 0 ORDER BY number, id"
    };
    let ids: Vec<i32> = sqlx::query_scalar(sql).fetch_all(pool).await.map_err(|err| err.to_string())?;
    let mut items = Vec::new();
    for id in ids {
        if let Some(member) = member_by_id(pool, id).await? {
            items.push(public_user(&member));
        }
    }
    Ok(done(json!({ "items": items, "members": items })))
}

async fn list_activities(pool: &MySqlPool) -> Result<Value, String> {
    let rows = sqlx::query(
        "SELECT id, name, start_date, end_date, location, status, IFNULL(content, '') AS content,
         IFNULL(dlc_ids, '[]') AS dlc_ids, IFNULL(checkin_configs, '[]') AS checkin_configs
         FROM center_activities ORDER BY id DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|err| err.to_string())?;
    let items: Vec<Value> = rows.into_iter().map(activity_json).collect();
    Ok(done(json!({ "items": items })))
}

fn activity_json(row: sqlx::mysql::MySqlRow) -> Value {
    let dlc: Value = serde_json::from_str(&row.try_get::<String, _>("dlc_ids").unwrap_or_else(|_| "[]".into())).unwrap_or(json!([]));
    let configs: Value = serde_json::from_str(&row.try_get::<String, _>("checkin_configs").unwrap_or_else(|_| "[]".into())).unwrap_or(json!([]));
    json!({
        "id": row.try_get::<i32, _>("id").unwrap_or(0),
        "name": row.try_get::<String, _>("name").unwrap_or_default(),
        "startDate": row.try_get::<String, _>("start_date").unwrap_or_default(),
        "endDate": row.try_get::<String, _>("end_date").unwrap_or_default(),
        "location": row.try_get::<String, _>("location").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "upcoming".into()),
        "content": row.try_get::<String, _>("content").unwrap_or_default(),
        "dlcIds": dlc,
        "checkinConfigs": configs,
    })
}

async fn products(pool: &MySqlPool, only_on: bool) -> Result<Vec<Value>, String> {
    let sql = if only_on {
        "SELECT id, name, price, stock, status, IFNULL(description, '') AS description FROM center_products WHERE status <> 'off' ORDER BY id DESC"
    } else {
        "SELECT id, name, price, stock, status, IFNULL(description, '') AS description FROM center_products ORDER BY id DESC"
    };
    let rows = sqlx::query(sql).fetch_all(pool).await.map_err(|err| err.to_string())?;
    Ok(rows.into_iter().map(|row| json!({
        "id": row.try_get::<i32, _>("id").unwrap_or(0),
        "name": row.try_get::<String, _>("name").unwrap_or_default(),
        "price": row.try_get::<i32, _>("price").unwrap_or(0),
        "stock": row.try_get::<i32, _>("stock").unwrap_or(0),
        "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "on".into()),
        "desc": row.try_get::<String, _>("description").unwrap_or_default(),
    })).collect())
}

async fn list_redeems(pool: &MySqlPool, member_id: Option<i32>) -> Result<Value, String> {
    let rows = if let Some(id) = member_id {
        sqlx::query("SELECT r.id, r.product_id, r.product_name, r.price, r.qq, r.note, r.ship_status,
            DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, m.name, m.tmp_id
            FROM center_redeems r LEFT JOIN center_members m ON m.id = r.member_id
            WHERE r.member_id = ? ORDER BY r.id DESC")
            .bind(id)
            .fetch_all(pool)
            .await
    } else {
        sqlx::query("SELECT r.id, r.product_id, r.product_name, r.price, r.qq, r.note, r.ship_status,
            DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, m.name, m.tmp_id
            FROM center_redeems r LEFT JOIN center_members m ON m.id = r.member_id
            ORDER BY r.id DESC")
            .fetch_all(pool)
            .await
    }
    .map_err(|err| err.to_string())?;
    let items: Vec<Value> = rows.into_iter().map(|row| {
        let ship = row.try_get::<String, _>("ship_status").unwrap_or_else(|_| "pending".into());
        json!({
            "id": row.try_get::<i32, _>("id").unwrap_or(0),
            "productId": row.try_get::<i32, _>("product_id").unwrap_or(0),
            "productName": row.try_get::<String, _>("product_name").unwrap_or_default(),
            "price": row.try_get::<i32, _>("price").unwrap_or(0),
            "note": row.try_get::<String, _>("note").unwrap_or_default(),
            "qq": row.try_get::<String, _>("qq").unwrap_or_default(),
            "name": row.try_get::<String, _>("name").unwrap_or_default(),
            "tmpId": row.try_get::<String, _>("tmp_id").unwrap_or_default(),
            "createdAt": row.try_get::<String, _>("created_at").unwrap_or_default(),
            "shipStatus": ship,
            "shipped": ship == "shipped",
        })
    }).collect();
    Ok(done(json!({ "items": items })))
}

async fn list_files(pool: &MySqlPool, activity_id: i32) -> Result<Value, String> {
    let rows = sqlx::query(
        "SELECT name, stored_path, size_bytes FROM center_activity_files WHERE activity_id = ? ORDER BY id",
    )
    .bind(activity_id)
    .fetch_all(pool)
    .await
    .map_err(|err| err.to_string())?;
    let items: Vec<Value> = rows.into_iter().map(|row| {
        let name = row.try_get::<String, _>("name").unwrap_or_default();
        json!({
            "name": name,
            "size": row.try_get::<i64, _>("size_bytes").unwrap_or(0),
            "downloadUrl": format!("/api/client/activities/{activity_id}/files/{}", url_encode(&name)),
        })
    }).collect();
    Ok(done(json!({ "items": items })))
}

pub async fn read_activity_file(pool: &MySqlPool, token: &str, activity_id: i32, name: &str) -> Result<Vec<u8>, Value> {
    match client(pool, token).await {
        Ok(Ok(_)) => {}
        Ok(Err(value)) => return Err(value),
        Err(err) => return Err(fail(500, err)),
    }
    let name = Path::new(name).file_name().and_then(|value| value.to_str()).unwrap_or("");
    if name.is_empty() || name.contains("..") {
        return Err(fail(400, "文件名无效"));
    }
    let row = sqlx::query("SELECT stored_path FROM center_activity_files WHERE activity_id = ? AND name = ?")
        .bind(activity_id)
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|err| fail(500, err.to_string()))?;
    let Some(row) = row else {
        return Err(fail(404, "存档不存在"));
    };
    let stored = row.try_get::<String, _>("stored_path").unwrap_or_default();
    let root = upload_root().join(activity_id.to_string());
    let path = std::path::PathBuf::from(&stored);
    if !path.starts_with(&root) {
        return Err(fail(403, "存档路径无效"));
    }
    std::fs::read(&path).map_err(|_| fail(404, "存档文件不存在"))
}

async fn list_dlc(pool: &MySqlPool, kind: &str, sync: bool) -> Result<Value, String> {
    let rows = if kind == "1" || kind == "2" {
        sqlx::query("SELECT id, name_zh, name_en, kind, price, steam_app_id, cover_url, IFNULL(scs_files, '[]') AS scs_files FROM center_dlcs WHERE kind = ? ORDER BY id")
            .bind(kind.parse::<i32>().unwrap_or(0))
            .fetch_all(pool).await
    } else {
        sqlx::query("SELECT id, name_zh, name_en, kind, price, steam_app_id, cover_url, IFNULL(scs_files, '[]') AS scs_files FROM center_dlcs ORDER BY id")
            .fetch_all(pool).await
    }.map_err(|err| err.to_string())?;
    let items: Vec<Value> = rows.into_iter().map(|row| {
        let scs: Value = serde_json::from_str(&row.try_get::<String, _>("scs_files").unwrap_or_else(|_| "[]".into())).unwrap_or(json!([]));
        json!({
            "id": row.try_get::<i32, _>("id").unwrap_or(0),
            "nameZh": row.try_get::<String, _>("name_zh").unwrap_or_default(),
            "nameEn": row.try_get::<String, _>("name_en").unwrap_or_default(),
            "name": row.try_get::<String, _>("name_zh").unwrap_or_default(),
            "type": row.try_get::<i8, _>("kind").unwrap_or(1),
            "price": row.try_get::<i32, _>("price").unwrap_or(0),
            "appId": row.try_get::<String, _>("steam_app_id").unwrap_or_default(),
            "imageUrl": row.try_get::<String, _>("cover_url").unwrap_or_default(),
            "scsFiles": scs,
        })
    }).collect();
    let mut payload = json!({ "items": items });
    if sync {
        if let Some(map) = payload.as_object_mut() {
            map.insert("message".into(), json!("本地图库没有可同步的远程封面"));
        }
    }
    Ok(done(payload))
}

async fn redeem(pool: &MySqlPool, token: &str, body: &Value) -> Result<Value, String> {
    let member = match client(pool, token).await? {
        Ok(member) => member,
        Err(value) => return Ok(value),
    };
    let product_id = body.get("productId").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let qq = text(body, "qq");
    if qq.is_empty() {
        return Ok(fail(400, "请填写收货 QQ"));
    }
    let mut tx = pool.begin().await.map_err(|err| err.to_string())?;
    let product = sqlx::query("SELECT name, price, stock, status FROM center_products WHERE id = ? FOR UPDATE")
        .bind(product_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
    let Some(product) = product else {
        return Ok(fail(404, "商品不存在"));
    };
    let status: String = product.try_get("status").unwrap_or_default();
    let stock: i32 = product.try_get("stock").unwrap_or(0);
    let price: i32 = product.try_get("price").unwrap_or(0);
    let name: String = product.try_get("name").unwrap_or_default();
    if status == "off" {
        return Ok(fail(400, "商品已下架"));
    }
    if stock <= 0 {
        return Ok(fail(400, "库存不足"));
    }
    if member.score < price {
        return Ok(fail(400, "积分不足"));
    }
    sqlx::query("UPDATE center_products SET stock = stock - 1 WHERE id = ?")
        .bind(product_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("UPDATE center_members SET score = score - ? WHERE id = ?")
        .bind(price)
        .bind(member.id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("INSERT INTO center_redeems (product_id, member_id, product_name, price, qq, note) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(product_id)
        .bind(member.id)
        .bind(&name)
        .bind(price)
        .bind(&qq)
        .bind(text(body, "note"))
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("INSERT INTO center_point_logs (member_id, delta, reason) VALUES (?, ?, ?)")
        .bind(member.id)
        .bind(-price)
        .bind(format!("兑换 {name}"))
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
    tx.commit().await.map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": format!("已兑换「{name}」，扣除 {price} 积分") })))
}

pub async fn save_upload(pool: &MySqlPool, activity_id: i32, body: &Value) -> Result<Value, String> {
    let files = body.get("files").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if files.is_empty() {
        return Ok(fail(400, "未选择文件"));
    }
    let max_mb: u64 = std::env::var("UPLOAD_MAX_MB").ok().and_then(|v| v.parse().ok()).unwrap_or(50);
    let dir = upload_root().join(activity_id.to_string());
    std::fs::create_dir_all(&dir).map_err(|err| format!("创建上传目录失败：{err}"))?;
    for file in files {
        let name = Path::new(file.get("name").and_then(|v| v.as_str()).unwrap_or("file.zip"))
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("file.zip")
            .to_string();
        let data = file.get("dataBase64").and_then(|v| v.as_str()).unwrap_or("");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| format!("文件 {name} 内容无效"))?;
        if bytes.len() as u64 > max_mb * 1024 * 1024 {
            return Ok(fail(400, format!("文件超过 {max_mb} MB")));
        }
        let path = dir.join(&name);
        std::fs::write(&path, &bytes).map_err(|err| format!("保存文件失败：{err}"))?;
        sqlx::query(
            "INSERT INTO center_activity_files (activity_id, name, stored_path, size_bytes)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE stored_path = VALUES(stored_path), size_bytes = VALUES(size_bytes)",
        )
        .bind(activity_id)
        .bind(&name)
        .bind(path.display().to_string())
        .bind(bytes.len() as i64)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    }
    Ok(done(json!({ "message": "存档已上传" })))
}

async fn admin_route(
    pool: &MySqlPool,
    method: &str,
    path: &str,
    query: &str,
    body: Value,
    member: &Member,
) -> Result<Value, String> {
    if path == "/api/members/sync-join-dates" && method == "POST" {
        if let Err(value) = need(member, "members") {
            return Ok(value);
        }
        let result = sqlx::query(
            "UPDATE center_members SET join_date = DATE(created_at) WHERE join_date IS NULL AND is_super = 0",
        )
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
        return Ok(done(json!({ "message": format!("已同步 {} 人的入队日期", result.rows_affected()) })));
    }
    if path == "/api/members" && method == "GET" {
        if let Err(value) = need(member, "members") {
            return Ok(value);
        }
        return list_members(pool, false).await;
    }
    if path == "/api/members" && method == "POST" {
        if let Err(value) = need(member, "members") {
            return Ok(value);
        }
        return create_member(pool, &body).await;
    }
    if let Some((id, tail)) = split_id(path, "/api/members/") {
        if let Err(value) = need(member, "members") {
            return Ok(value);
        }
        if tail == "leave" && method == "POST" {
            return leave_member(pool, id).await;
        }
        if tail.is_empty() && method == "PUT" {
            return update_member(pool, id, &body).await;
        }
        if tail.is_empty() && method == "DELETE" {
            return delete_member(pool, id).await;
        }
    }
    if path == "/api/points" && method == "GET" {
        if let Err(value) = need(member, "points") {
            return Ok(value);
        }
        return list_members(pool, false).await;
    }
    if path == "/api/points" && method == "POST" {
        if let Err(value) = need(member, "points") {
            return Ok(value);
        }
        return adjust_points(pool, &body).await;
    }
    if path == "/api/activities" && method == "GET" {
        if let Err(value) = need(member, "activities") {
            return Ok(value);
        }
        return list_activities(pool).await;
    }
    if path == "/api/activities" && method == "POST" {
        if let Err(value) = need(member, "activities") {
            return Ok(value);
        }
        return save_activity(pool, None, &body).await;
    }
    if let Some((id, tail)) = split_id(path, "/api/activities/") {
        if let Err(value) = need(member, "activities") {
            return Ok(value);
        }
        if tail == "files" && method == "GET" {
            return list_files(pool, id).await;
        }
        if tail == "files" && method == "POST" {
            return save_upload(pool, id, &body).await;
        }
        if let Some(name) = tail.strip_prefix("files/") {
            if method == "DELETE" {
                return delete_file(pool, id, &url_decode(name)).await;
            }
        }
        if tail.is_empty() && method == "PUT" {
            return save_activity(pool, Some(id), &body).await;
        }
        if tail.is_empty() && method == "DELETE" {
            return delete_activity(pool, id).await;
        }
    }
    if path == "/api/checkins/scan" && method == "POST" {
        if let Err(value) = need(member, "activities") {
            return Ok(value);
        }
        return Ok(done(json!({
            "created": 0,
            "message": "地图扫描尚未接入，请手动创建签到",
        })));
    }
    if path == "/api/checkins" && method == "GET" {
        if let Err(value) = need(member, "activities") {
            return Ok(value);
        }
        return list_checkins(pool, &query_value(query, "activityId")).await;
    }
    if path == "/api/checkins" && method == "POST" {
        if let Err(value) = need(member, "activities") {
            return Ok(value);
        }
        return create_checkin(pool, &body).await;
    }
    if let Some((id, tail)) = split_id(path, "/api/checkins/") {
        if let Err(value) = need(member, "activities") {
            return Ok(value);
        }
        if tail.is_empty() && method == "DELETE" {
            return delete_checkin(pool, id).await;
        }
    }
    if path == "/api/store" && method == "GET" {
        if let Err(value) = need(member, "store") {
            return Ok(value);
        }
        return Ok(done(json!({ "items": products(pool, false).await? })));
    }
    if path == "/api/store" && method == "POST" {
        if let Err(value) = need(member, "store") {
            return Ok(value);
        }
        return save_product(pool, None, &body).await;
    }
    if let Some((id, tail)) = split_id(path, "/api/store/") {
        if let Err(value) = need(member, "store") {
            return Ok(value);
        }
        if tail.is_empty() && method == "PUT" {
            return save_product(pool, Some(id), &body).await;
        }
        if tail.is_empty() && method == "DELETE" {
            return delete_product(pool, id).await;
        }
    }
    if path == "/api/redeems" && method == "GET" {
        if let Err(value) = need(member, "store") {
            return Ok(value);
        }
        return list_redeems(pool, None).await;
    }
    if let Some((id, tail)) = split_id(path, "/api/redeems/") {
        if let Err(value) = need(member, "store") {
            return Ok(value);
        }
        if tail == "ship" && method == "PUT" {
            return ship_redeem(pool, id, &body).await;
        }
        if tail.is_empty() && method == "DELETE" {
            return delete_redeem(pool, id).await;
        }
    }
    if path == "/api/dlc" && method == "GET" {
        if let Err(value) = need(member, "dlc") {
            return Ok(value);
        }
        let kind = query_value(query, "type");
        let sync = query_value(query, "syncImages") == "1";
        return list_dlc(pool, &kind, sync).await;
    }
    if path == "/api/permissions" && method == "GET" {
        if let Err(value) = need(member, "settings") {
            return Ok(value);
        }
        return list_permissions(pool).await;
    }
    if let Some((id, tail)) = split_id(path, "/api/permissions/") {
        if let Err(value) = need(member, "settings") {
            return Ok(value);
        }
        if tail.is_empty() && method == "PUT" {
            return save_permissions(pool, id, &body).await;
        }
    }
    if path == "/api/online" && method == "GET" {
        if let Err(value) = need(member, "monitor") {
            return Ok(value);
        }
        return list_online(pool).await;
    }
    if let Some((id, tail)) = split_id(path, "/api/online/") {
        if let Err(value) = need(member, "monitor") {
            return Ok(value);
        }
        if tail.is_empty() && method == "DELETE" {
            return kick_online(pool, id).await;
        }
    }
    Ok(fail(404, "接口不存在"))
}

fn split_id(path: &str, prefix: &str) -> Option<(i32, String)> {
    let rest = path.strip_prefix(prefix)?;
    let mut parts = rest.splitn(2, '/');
    let id = parts.next()?.parse().ok()?;
    Some((id, parts.next().unwrap_or("").to_string()))
}

fn query_value(query: &str, key: &str) -> String {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next() == Some(key) {
            return url_decode(parts.next().unwrap_or(""));
        }
    }
    String::new()
}

fn url_encode(input: &str) -> String {
    let mut out = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(
                std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                16,
            ) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(if bytes[index] == b'+' { b' ' } else { bytes[index] });
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn number_of(body: &Value, key: &str) -> i32 {
    body.get(key)
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
        })
        .unwrap_or(0) as i32
}

fn optional_text(body: &Value, key: &str) -> Option<String> {
    let value = body.get(key)?;
    if value.is_null() {
        return None;
    }
    let text = value.as_str()?.trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

async fn create_member(pool: &MySqlPool, body: &Value) -> Result<Value, String> {
    let tmp_id = text(body, "tmpId");
    let name = text(body, "name");
    if tmp_id.is_empty() || name.is_empty() {
        return Ok(fail(400, "TMP ID 和昵称不能为空"));
    }
    let password = text(body, "password");
    if !password.is_empty() && password.chars().count() < 6 {
        return Ok(fail(400, "初始密码至少 6 位"));
    }
    let hash = if password.is_empty() {
        String::new()
    } else {
        hash_password(&password)?
    };
    let requested = number_of(body, "number");
    let number = if requested > 0 { requested } else { next_number(pool).await? };
    let result = sqlx::query(
        "INSERT INTO center_members
         (number, tmp_id, name, password_hash, qq, role, score, join_date, is_admin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(number)
    .bind(&tmp_id)
    .bind(&name)
    .bind(&hash)
    .bind(optional_text(body, "qq").unwrap_or_default())
    .bind(optional_text(body, "role").unwrap_or_else(|| "司机".into()))
    .bind(number_of(body, "score"))
    .bind(optional_text(body, "joinDate"))
    .bind(if body.get("isAdmin").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 })
    .execute(pool)
    .await;
    match result {
        Ok(_) => Ok(done(json!({ "message": format!("「{name}」已创建") }))),
        Err(err) if err.to_string().contains("Duplicate") => Ok(fail(400, "该 TMP ID 已存在")),
        Err(err) => Err(err.to_string()),
    }
}

async fn update_member(pool: &MySqlPool, id: i32, body: &Value) -> Result<Value, String> {
    let Some(current) = member_by_id(pool, id).await? else {
        return Ok(fail(404, "成员不存在"));
    };
    if current.is_super {
        return Ok(fail(403, "不能修改超级管理员"));
    }
    let password = text(body, "password");
    if !password.is_empty() && password.chars().count() < 6 {
        return Ok(fail(400, "密码至少 6 位"));
    }
    if password.is_empty() {
        sqlx::query("UPDATE center_members SET name = ?, qq = ?, role = ?, score = ? WHERE id = ?")
            .bind(text(body, "name"))
            .bind(optional_text(body, "qq").unwrap_or_default())
            .bind(optional_text(body, "role").unwrap_or_else(|| current.role.clone()))
            .bind(number_of(body, "score"))
            .bind(id)
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
    } else {
        let hash = hash_password(&password)?;
        sqlx::query("UPDATE center_members SET name = ?, qq = ?, role = ?, score = ?, password_hash = ? WHERE id = ?")
            .bind(text(body, "name"))
            .bind(optional_text(body, "qq").unwrap_or_default())
            .bind(optional_text(body, "role").unwrap_or_else(|| current.role.clone()))
            .bind(number_of(body, "score"))
            .bind(hash)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
    }
    Ok(done(json!({ "message": "成员信息已更新" })))
}

async fn leave_member(pool: &MySqlPool, id: i32) -> Result<Value, String> {
    let Some(current) = member_by_id(pool, id).await? else {
        return Ok(fail(404, "成员不存在"));
    };
    if current.is_super {
        return Ok(fail(403, "不能把超级管理员标记离队"));
    }
    sqlx::query("UPDATE center_members SET leave_date = CURDATE() WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("DELETE FROM center_sessions WHERE member_id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "已标记离队" })))
}

async fn delete_member(pool: &MySqlPool, id: i32) -> Result<Value, String> {
    let Some(current) = member_by_id(pool, id).await? else {
        return Ok(fail(404, "成员不存在"));
    };
    if current.is_super {
        return Ok(fail(403, "不能删除超级管理员"));
    }
    sqlx::query("DELETE FROM center_sessions WHERE member_id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("DELETE FROM center_members WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "成员已删除" })))
}

async fn adjust_points(pool: &MySqlPool, body: &Value) -> Result<Value, String> {
    let member_id = number_of(body, "memberId");
    let delta = number_of(body, "delta");
    if member_id <= 0 || delta == 0 {
        return Ok(fail(400, "请输入非 0 的积分变动"));
    }
    let Some(_) = member_by_id(pool, member_id).await? else {
        return Ok(fail(404, "成员不存在"));
    };
    let reason = optional_text(body, "reason").unwrap_or_else(|| "管理员调整".into());
    sqlx::query("UPDATE center_members SET score = score + ? WHERE id = ?")
        .bind(delta)
        .bind(member_id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("INSERT INTO center_point_logs (member_id, delta, reason) VALUES (?, ?, ?)")
        .bind(member_id)
        .bind(delta)
        .bind(&reason)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "积分已调整" })))
}

async fn save_activity(pool: &MySqlPool, id: Option<i32>, body: &Value) -> Result<Value, String> {
    let name = text(body, "name");
    let start = text(body, "startDate");
    if name.is_empty() || start.is_empty() {
        return Ok(fail(400, "活动名称和开始时间不能为空"));
    }
    let status = match text(body, "status").as_str() {
        "ongoing" | "done" | "upcoming" => text(body, "status"),
        _ => "upcoming".into(),
    };
    let end = {
        let value = text(body, "endDate");
        if value.is_empty() { format!("{start} 23:59") } else { value }
    };
    let dlc = body.get("dlcIds").cloned().unwrap_or(json!([])).to_string();
    let configs = body.get("checkinConfigs").cloned().unwrap_or(json!([])).to_string();
    if let Some(id) = id {
        let changed = sqlx::query(
            "UPDATE center_activities
             SET name = ?, start_date = ?, end_date = ?, location = ?, status = ?, content = ?, dlc_ids = ?, checkin_configs = ?
             WHERE id = ?",
        )
        .bind(&name)
        .bind(&start)
        .bind(&end)
        .bind(optional_text(body, "location").unwrap_or_default())
        .bind(&status)
        .bind(optional_text(body, "content").unwrap_or_default())
        .bind(&dlc)
        .bind(&configs)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
        if changed.rows_affected() == 0 {
            return Ok(fail(404, "活动不存在"));
        }
    } else {
        sqlx::query(
            "INSERT INTO center_activities
             (name, start_date, end_date, location, status, content, dlc_ids, checkin_configs)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&name)
        .bind(&start)
        .bind(&end)
        .bind(optional_text(body, "location").unwrap_or_default())
        .bind(&status)
        .bind(optional_text(body, "content").unwrap_or_default())
        .bind(&dlc)
        .bind(&configs)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    }
    Ok(done(json!({ "message": "活动已保存" })))
}

async fn delete_activity(pool: &MySqlPool, id: i32) -> Result<Value, String> {
    let rows = sqlx::query("SELECT stored_path FROM center_activity_files WHERE activity_id = ?")
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(|err| err.to_string())?;
    for row in rows {
        if let Ok(path) = row.try_get::<String, _>("stored_path") {
            let _ = std::fs::remove_file(path);
        }
    }
    let _ = std::fs::remove_dir(upload_root().join(id.to_string()));
    sqlx::query("DELETE FROM center_activity_files WHERE activity_id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("DELETE FROM center_checkins WHERE activity_id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("DELETE FROM center_activities WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "活动已删除" })))
}

async fn delete_file(pool: &MySqlPool, activity_id: i32, name: &str) -> Result<Value, String> {
    let name = Path::new(name).file_name().and_then(|v| v.to_str()).unwrap_or("");
    if name.is_empty() || name.contains("..") {
        return Ok(fail(400, "文件名无效"));
    }
    let row = sqlx::query("SELECT stored_path FROM center_activity_files WHERE activity_id = ? AND name = ?")
        .bind(activity_id)
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|err| err.to_string())?;
    let Some(row) = row else {
        return Ok(fail(404, "存档不存在"));
    };
    if let Ok(path) = row.try_get::<String, _>("stored_path") {
        let _ = std::fs::remove_file(path);
    }
    sqlx::query("DELETE FROM center_activity_files WHERE activity_id = ? AND name = ?")
        .bind(activity_id)
        .bind(name)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "存档已删除" })))
}

async fn list_checkins(pool: &MySqlPool, activity_id: &str) -> Result<Value, String> {
    let activity_id: i32 = activity_id.parse().unwrap_or(0);
    let rows = sqlx::query(
        "SELECT c.id, c.activity_id, IFNULL(a.name, '') AS activity_name, c.member_id,
         IFNULL(m.name, '') AS name, IFNULL(m.tmp_id, '') AS tmp_id, c.points, c.note,
         DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
         FROM center_checkins c
         LEFT JOIN center_activities a ON a.id = c.activity_id
         LEFT JOIN center_members m ON m.id = c.member_id
         WHERE (? = 0 OR c.activity_id = ?)
         ORDER BY c.id DESC",
    )
    .bind(activity_id)
    .bind(activity_id)
    .fetch_all(pool)
    .await
    .map_err(|err| err.to_string())?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<i32, _>("id").unwrap_or(0),
                "activityId": row.try_get::<i32, _>("activity_id").unwrap_or(0),
                "activityName": row.try_get::<String, _>("activity_name").unwrap_or_default(),
                "memberId": row.try_get::<i32, _>("member_id").unwrap_or(0),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "tmpId": row.try_get::<String, _>("tmp_id").unwrap_or_default(),
                "points": row.try_get::<i32, _>("points").unwrap_or(0),
                "note": row.try_get::<String, _>("note").unwrap_or_default(),
                "createdAt": row.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();
    Ok(done(json!({ "items": items })))
}

async fn create_checkin(pool: &MySqlPool, body: &Value) -> Result<Value, String> {
    let activity_id = number_of(body, "activityId");
    let member_id = number_of(body, "memberId");
    if activity_id <= 0 || member_id <= 0 {
        return Ok(fail(400, "请选择活动和成员"));
    }
    let exists: Option<i32> = sqlx::query_scalar("SELECT id FROM center_activities WHERE id = ?")
        .bind(activity_id)
        .fetch_optional(pool)
        .await
        .map_err(|err| err.to_string())?;
    if exists.is_none() {
        return Ok(fail(404, "活动不存在"));
    }
    if member_by_id(pool, member_id).await?.is_none() {
        return Ok(fail(404, "成员不存在"));
    }
    let configs: Option<String> = sqlx::query_scalar("SELECT checkin_configs FROM center_activities WHERE id = ?")
        .bind(activity_id)
        .fetch_one(pool)
        .await
        .map_err(|err| err.to_string())?;
    let points = config_points(configs.as_deref().unwrap_or("[]"));
    sqlx::query("INSERT INTO center_checkins (activity_id, member_id, points, note, source) VALUES (?, ?, ?, ?, 'manual')")
        .bind(activity_id)
        .bind(member_id)
        .bind(points)
        .bind(optional_text(body, "note").unwrap_or_default())
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    if points != 0 {
        sqlx::query("UPDATE center_members SET score = score + ? WHERE id = ?")
            .bind(points)
            .bind(member_id)
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
        sqlx::query("INSERT INTO center_point_logs (member_id, delta, reason) VALUES (?, ?, ?)")
            .bind(member_id)
            .bind(points)
            .bind("活动签到")
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
    }
    Ok(done(json!({ "message": "签到记录已创建", "points": points })))
}

fn config_points(raw: &str) -> i32 {
    let Ok(Value::Array(list)) = serde_json::from_str(raw) else {
        return 0;
    };
    list.iter()
        .map(|item| item.get("points").and_then(|value| value.as_i64()).unwrap_or(0) as i32)
        .sum()
}

async fn delete_checkin(pool: &MySqlPool, id: i32) -> Result<Value, String> {
    let row = sqlx::query("SELECT member_id, points FROM center_checkins WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|err| err.to_string())?;
    let Some(row) = row else {
        return Ok(fail(404, "签到不存在"));
    };
    let member_id: i32 = row.try_get("member_id").unwrap_or(0);
    let points: i32 = row.try_get("points").unwrap_or(0);
    sqlx::query("DELETE FROM center_checkins WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    if points != 0 {
        sqlx::query("UPDATE center_members SET score = score - ? WHERE id = ?")
            .bind(points)
            .bind(member_id)
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
        sqlx::query("INSERT INTO center_point_logs (member_id, delta, reason) VALUES (?, ?, ?)")
            .bind(member_id)
            .bind(-points)
            .bind("删除签到")
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
    }
    Ok(done(json!({ "message": "签到已删除" })))
}

async fn save_product(pool: &MySqlPool, id: Option<i32>, body: &Value) -> Result<Value, String> {
    let name = text(body, "name");
    if name.is_empty() {
        return Ok(fail(400, "商品名称不能为空"));
    }
    let status = if text(body, "status") == "off" { "off" } else { "on" };
    let desc = text(body, "desc");
    if let Some(id) = id {
        let changed = sqlx::query(
            "UPDATE center_products SET name = ?, price = ?, stock = ?, status = ?, description = ? WHERE id = ?",
        )
        .bind(&name)
        .bind(number_of(body, "price"))
        .bind(number_of(body, "stock"))
        .bind(status)
        .bind(&desc)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
        if changed.rows_affected() == 0 {
            return Ok(fail(404, "商品不存在"));
        }
    } else {
        sqlx::query(
            "INSERT INTO center_products (name, price, stock, status, description) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&name)
        .bind(number_of(body, "price"))
        .bind(number_of(body, "stock"))
        .bind(status)
        .bind(&desc)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    }
    Ok(done(json!({ "message": "商品已保存" })))
}

async fn delete_product(pool: &MySqlPool, id: i32) -> Result<Value, String> {
    sqlx::query("DELETE FROM center_products WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "商品已删除" })))
}

async fn ship_redeem(pool: &MySqlPool, id: i32, body: &Value) -> Result<Value, String> {
    let status = if text(body, "shipStatus") == "shipped" { "shipped" } else { "pending" };
    let changed = sqlx::query("UPDATE center_redeems SET ship_status = ? WHERE id = ?")
        .bind(status)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    if changed.rows_affected() == 0 {
        return Ok(fail(404, "兑换记录不存在"));
    }
    Ok(done(json!({ "message": if status == "shipped" { "已标记发货" } else { "已改回待发货" } })))
}

async fn delete_redeem(pool: &MySqlPool, id: i32) -> Result<Value, String> {
    sqlx::query("DELETE FROM center_redeems WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "记录已删除" })))
}

async fn list_permissions(pool: &MySqlPool) -> Result<Value, String> {
    let ids: Vec<i32> = sqlx::query_scalar(
        "SELECT id FROM center_members WHERE (is_admin = 1 OR is_super = 1) AND leave_date IS NULL ORDER BY is_super DESC, id",
    )
    .fetch_all(pool)
    .await
    .map_err(|err| err.to_string())?;
    let mut admins = Vec::new();
    for id in ids {
        if let Some(member) = member_by_id(pool, id).await? {
            admins.push(public_user(&member));
        }
    }
    Ok(done(json!({
        "defs": [
            { "key": "members", "label": "成员" },
            { "key": "points", "label": "积分" },
            { "key": "activities", "label": "活动" },
            { "key": "store", "label": "商城" },
            { "key": "dlc", "label": "DLC" },
            { "key": "monitor", "label": "监控" },
            { "key": "settings", "label": "设置" }
        ],
        "admins": admins,
    })))
}

async fn save_permissions(pool: &MySqlPool, id: i32, body: &Value) -> Result<Value, String> {
    let Some(current) = member_by_id(pool, id).await? else {
        return Ok(fail(404, "成员不存在"));
    };
    if current.is_super {
        return Ok(fail(403, "不能修改超级管理员的权限"));
    }
    let permissions = body.get("permissions").cloned().unwrap_or(json!({}));
    sqlx::query("UPDATE center_members SET permissions = ?, is_admin = 1 WHERE id = ?")
        .bind(permissions.to_string())
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "权限已更新" })))
}

async fn list_online(pool: &MySqlPool) -> Result<Value, String> {
    let rows = sqlx::query(
        "SELECT s.id, IFNULL(NULLIF(m.name, ''), m.tmp_id) AS login_name, s.host, s.client_name,
         DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS login_at
         FROM center_sessions s
         LEFT JOIN center_members m ON m.id = s.member_id
         WHERE s.kind = 'client'
         ORDER BY s.id DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|err| err.to_string())?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<i32, _>("id").unwrap_or(0),
                "loginName": row.try_get::<String, _>("login_name").unwrap_or_default(),
                "host": row.try_get::<String, _>("host").unwrap_or_default(),
                "client": row.try_get::<String, _>("client_name").unwrap_or_default(),
                "location": "",
                "loginAt": row.try_get::<String, _>("login_at").unwrap_or_default(),
            })
        })
        .collect();
    Ok(done(json!({ "items": items })))
}

async fn kick_online(pool: &MySqlPool, id: i32) -> Result<Value, String> {
    sqlx::query("DELETE FROM center_sessions WHERE id = ? AND kind = 'client'")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(done(json!({ "message": "会话已踢下线" })))
}
