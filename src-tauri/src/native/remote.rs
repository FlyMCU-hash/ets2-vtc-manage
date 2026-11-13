use serde_json::{json, Value};

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
    let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("").trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("服务器地址无效".into());
    }
    let method = payload.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "请求方法无效".to_string())?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|err| format!("创建请求失败：{err}"))?;
    let mut request = client.request(method, url);
    if let Some(headers) = payload.get("headers").and_then(|v| v.as_object()) {
        for (key, value) in headers {
            if let Some(text) = value.as_str() {
                request = request.header(key.as_str(), text);
            }
        }
    }
    if let Some(files) = payload.get("files").and_then(|v| v.as_array()) {
        let mut form = reqwest::blocking::multipart::Form::new();
        for file in files {
            let name = file.get("name").and_then(|v| v.as_str()).unwrap_or("file.bin");
            let data = file.get("dataBase64").and_then(|v| v.as_str()).unwrap_or("");
            let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
                .map_err(|_| format!("文件 {name} 内容无效"))?;
            let part = reqwest::blocking::multipart::Part::bytes(bytes).file_name(name.to_string());
            form = form.part("files", part);
        }
        request = request.multipart(form);
    } else if let Some(body) = payload.get("body").and_then(|v| v.as_str()) {
        request = request.header("content-type", "application/json").body(body.to_string());
    }
    let response = request.send().map_err(|_| "无法连接车队中心，请检查服务器地址".to_string())?;
    let status = response.status().as_u16();
    let text = response.text().map_err(|err| format!("读取响应失败：{err}"))?;
    let body = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "message": text }));
    Ok(json!({ "status": status, "body": body }))
}

#[cfg(test)]
mod tests {
    use super::api_request;
    use serde_json::json;

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
