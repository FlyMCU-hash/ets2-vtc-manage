use super::{dispatch, env_str, pool, route::read_activity_file};
use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::Router;
use serde_json::Value;
use sqlx::MySqlPool;

pub fn serve() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("无法启动接口服务");
    if let Err(err) = runtime.block_on(listen()) {
        eprintln!("接口服务退出：{err}");
        std::process::exit(1);
    }
}

async fn listen() -> Result<(), String> {
    let pool = pool().await?;
    let port: u16 = env_str("PORT", "3000").parse().unwrap_or(3000);
    let bind = env_str("BIND", "127.0.0.1");
    let app = Router::new().fallback(handle).with_state(pool);
    let listener = tokio::net::TcpListener::bind((bind.as_str(), port))
        .await
        .map_err(|err| format!("端口 {port} 监听失败：{err}"))?;
    println!("Peak 车队中心接口已监听 {bind}:{port}");
    axum::serve(listener, app).await.map_err(|err| err.to_string())
}

async fn handle(State(pool): State<MySqlPool>, request: Request) -> Response {
    if request.method() == axum::http::Method::OPTIONS {
        return empty(StatusCode::NO_CONTENT);
    }
    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();
    let query = request.uri().query().unwrap_or("").to_string();
    let full = if query.is_empty() { path.clone() } else { format!("{path}?{query}") };
    let headers = request.headers().clone();
    let token = header_text(&headers, "x-client-token");
    let admin_token = header_text(&headers, "x-admin-token");
    if method == "GET" {
        if let Some((activity_id, name)) = activity_file(&path) {
            return file_response(&pool, &token, activity_id, &name).await;
        }
    }
    let bytes = axum::body::to_bytes(request.into_body(), 70 * 1024 * 1024)
        .await
        .unwrap_or_else(|_| Bytes::new());
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    let value = dispatch(&pool, &method, &full, body, token, admin_token).await;
    json_response(value)
}

fn activity_file(path: &str) -> Option<(i32, String)> {
    let rest = path.strip_prefix("/api/client/activities/")?;
    let (id, tail) = rest.split_once("/files/")?;
    let id = id.parse().ok()?;
    let name = url_decode(tail);
    if name.is_empty() { None } else { Some((id, name)) }
}

async fn file_response(pool: &MySqlPool, token: &str, activity_id: i32, name: &str) -> Response {
    match read_activity_file(pool, token, activity_id, name).await {
        Ok(bytes) => {
            let mut response = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .body(Body::from(bytes))
                .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR));
            apply_cors(response.headers_mut());
            response
        }
        Err(value) => json_response(value),
    }
}

fn json_response(value: Value) -> Response {
    let ok = value.get("ok").and_then(|item| item.as_bool()).unwrap_or(false);
    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::from_u16(value.get("status").and_then(|item| item.as_u64()).unwrap_or(400) as u16)
            .unwrap_or(StatusCode::BAD_REQUEST)
    };
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(Body::from(value.to_string()))
        .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR));
    apply_cors(response.headers_mut());
    response
}

fn empty(status: StatusCode) -> Response {
    let mut response = Response::builder()
        .status(status)
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()));
    apply_cors(response.headers_mut());
    response
}

fn apply_cors(headers: &mut HeaderMap) {
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        "Content-Type, Accept, X-Client-Token, X-Admin-Token".parse().unwrap(),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        "GET, POST, PUT, DELETE, OPTIONS".parse().unwrap(),
    );
}

fn header_text(headers: &HeaderMap, name: &str) -> String {
    headers.get(name).and_then(|value| value.to_str().ok()).unwrap_or("").trim().to_string()
}

fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""), 16) {
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
