use serde_json::{json, Value};
use std::io::{Error, ErrorKind, Read};

const MAX_RESPONSE_BYTES: usize = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES: usize = 256 * 1024 * 1024;
const ALLOWED_HEADERS: &[&str] = &["accept", "content-type", "x-client-token", "x-admin-token"];

pub fn allow_api_url(url: &reqwest::Url) -> bool {
    allow_host(url, false)
}

pub fn allow_download_url(url: &reqwest::Url) -> bool {
    allow_host(url, true)
}

pub fn ensure_download_url(raw: &str) -> Result<(), String> {
    let url = parse_url(raw)?;
    if allow_download_url(&url) {
        Ok(())
    } else {
        Err("下载地址不在允许的主机".into())
    }
}

fn parse_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "服务器地址无效".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("服务器地址无效".into());
    }
    Ok(url)
}

fn allow_host(url: &reqwest::Url, archive: bool) -> bool {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    if host == "df.peakvtc.cn" {
        return true;
    }
    if scheme == "https" && host == "api.truckersmp.com" {
        return true;
    }
    if scheme == "http" && host == "110.42.60.187" && url.port_or_known_default() == Some(9100) {
        return true;
    }
    archive && scheme == "https" && (host == "aliyuncs.com" || host.ends_with(".aliyuncs.com"))
}

pub fn tmp_player(payload: &Value) -> Result<Value, String> {
    let id = payload
        .get("tmpId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if id.is_empty() {
        return Err("请先输入 TMP ID".into());
    }
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("https://api.truckersmp.com/v2/player/{id}"))
        .header("User-Agent", "TruckersMP-API/1.0")
        .header("Accept", "application/json")
        .send()
        .map_err(|_| "无法连接 TruckersMP，请检查网络后重试，或先手动填写昵称".to_string())?;
    let status = response.status();
    let text = response
        .text()
        .map_err(|_| "TruckersMP 返回异常".to_string())?;
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status.as_u16() == 404 || body.get("error") == Some(&Value::Bool(true)) {
        return Err(format!("TruckersMP 未找到 ID「{id}」"));
    }
    if !status.is_success() {
        return Err(format!("查询 TMP 失败（HTTP {}）", status.as_u16()));
    }
    let player = body.get("response").cloned().unwrap_or(Value::Null);
    if !player.is_object() {
        return Err("未查询到该 TMP 玩家，可手动填写昵称".into());
    }
    let name = player.get("name").and_then(|v| v.as_str()).unwrap_or("");
    Ok(json!({
        "ok": true,
        "source": "truckersmp",
        "player": {
            "id": player.get("id").cloned().unwrap_or(Value::Null),
            "name": name,
            "joinDate": player.get("joinDate").cloned().unwrap_or(Value::Null),
            "steamID": player.get("steamID64").or_else(|| player.get("steamID")).cloned().unwrap_or(Value::Null),
            "groupName": player.get("groupName").cloned().unwrap_or(Value::Null),
        }
    }))
}

pub fn api_request(payload: &Value) -> Result<Value, String> {
    let raw = payload.get("url").and_then(|v| v.as_str()).unwrap_or("").trim();
    let url = parse_url(raw)?;
    if !allow_api_url(&url) {
        return Err("服务器地址不在允许范围".into());
    }
    let method_name = payload.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
    if !matches!(method_name.to_ascii_uppercase().as_str(), "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE") {
        return Err("请求方法无效".into());
    }
    let method = reqwest::Method::from_bytes(method_name.as_bytes()).map_err(|_| "请求方法无效".to_string())?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8 {
                return attempt.error(Error::new(ErrorKind::Other, "重定向过多"));
            }
            if allow_api_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error(Error::new(ErrorKind::Other, "跳转地址不在允许范围"))
            }
        }))
        .build()
        .map_err(|err| format!("创建请求失败：{err}"))?;
    let mut request = client.request(method, url);
    if let Some(headers) = payload.get("headers").and_then(|v| v.as_object()) {
        for (key, value) in headers {
            let name = key.to_ascii_lowercase();
            if !ALLOWED_HEADERS.contains(&name.as_str()) {
                continue;
            }
            if let Some(text) = value.as_str() {
                if text.contains('\r') || text.contains('\n') {
                    return Err("请求头无效".into());
                }
                request = request.header(key.as_str(), text);
            }
        }
    }
    if let Some(files) = payload.get("files").and_then(|v| v.as_array()) {
        if files.len() > 8 {
            return Err("上传文件过多".into());
        }
        let mut form = reqwest::blocking::multipart::Form::new();
        for file in files {
            let name = file.get("name").and_then(|v| v.as_str()).unwrap_or("file.bin");
            if name.contains('\0') || name.contains('/') || name.contains('\\') {
                return Err(format!("文件 {name} 名称无效"));
            }
            let data = file.get("dataBase64").and_then(|v| v.as_str()).unwrap_or("");
            let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
                .map_err(|_| format!("文件 {name} 内容无效"))?;
            if bytes.len() > MAX_UPLOAD_BYTES {
                return Err(format!("文件 {name} 超过大小限制"));
            }
            let part = reqwest::blocking::multipart::Part::bytes(bytes).file_name(name.to_string());
            form = form.part("files", part);
        }
        request = request.multipart(form);
    } else if let Some(body) = payload.get("body").and_then(|v| v.as_str()) {
        if body.len() > MAX_UPLOAD_BYTES {
            return Err("请求内容超过大小限制".into());
        }
        request = request.header("content-type", "application/json").body(body.to_string());
    }
    let mut response = request.send().map_err(|_| "无法连接车队中心，请检查服务器地址".to_string())?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let size = response.read(&mut buf).map_err(|err| format!("读取响应失败：{err}"))?;
        if size == 0 {
            break;
        }
        if bytes.len() + size > MAX_RESPONSE_BYTES {
            return Err("响应内容过大".into());
        }
        bytes.extend_from_slice(&buf[..size]);
    }
    let text = String::from_utf8_lossy(&bytes);
    let body = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "message": text }));
    Ok(json!({ "status": status, "body": body }))
}

#[cfg(test)]
mod tests {
    use super::{allow_api_url, allow_download_url, api_request};
    use serde_json::json;

    #[test]
    fn rejects_unlisted_host() {
        let err = api_request(&json!({
            "method": "GET",
            "url": "https://example.com/secret"
        }))
        .expect_err("外部地址应被拒绝");
        assert!(err.contains("不在允许范围"), "{err}");
    }

    #[test]
    fn allows_fleet_and_archive_hosts() {
        let fleet = reqwest::Url::parse("http://df.peakvtc.cn/api/client/ping").unwrap();
        let tmp = reqwest::Url::parse("https://api.truckersmp.com/v2/servers").unwrap();
        let map = reqwest::Url::parse("http://110.42.60.187:9100/server/list").unwrap();
        let oss = reqwest::Url::parse("https://peak.oss-cn-shanghai.aliyuncs.com/a.zip").unwrap();
        let evil = reqwest::Url::parse("https://evil.com/a.zip").unwrap();
        assert!(allow_api_url(&fleet) && allow_api_url(&tmp) && allow_api_url(&map));
        assert!(!allow_api_url(&oss) && !allow_api_url(&evil));
        assert!(allow_download_url(&fleet) && allow_download_url(&oss));
        assert!(!allow_download_url(&evil));
    }

    #[test]
    fn live_ping_reaches_website() {
        let result = api_request(&json!({
            "method": "GET",
            "url": "http://df.peakvtc.cn/api/client/ping",
            "headers": { "Accept": "application/json" }
        }))
        .expect("网站应可访问");
        assert_eq!(result["status"], 200);
        assert_eq!(result["body"]["ok"], true);
        assert_eq!(result["body"]["service"], "peak-client");
    }
}
