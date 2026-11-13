mod backup;
mod remote;
pub mod chat;
mod deploy;
mod fly;
mod paths;
mod save_edit;
mod sii;
mod support;
mod tag;

use serde_json::Value;

pub fn archive_still_deployed() -> bool {
    deploy::is_deployed()
}

#[tauri::command]
pub async fn native_call(method: String, payload: Option<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || dispatch(method, payload.unwrap_or(Value::Null)))
        .await
        .map_err(|err| format!("本机调用失败：{err}"))?
}

fn dispatch(method: String, payload: Value) -> Result<Value, String> {
    match method.as_str() {
        "detect_ets2_paths" => paths::detect(&payload),
        "open_path" => {
            support::open_path(support::str_field(&payload, "path"))?;
            Ok(Value::Null)
        }
        "deploy_status" => deploy::status(),
        "deploy_activity" => deploy::deploy(&payload),
        "uninstall_deploy" => deploy::uninstall(),
        "save_edit_status" => save_edit::status(&payload),
        "save_edit_apply" => save_edit::apply(&payload),
        "save_edit_open" => save_edit::open_backup(),
        "fly_console_status" => fly::status(&payload),
        "fly_console_enable" => fly::set_enabled(&payload, true),
        "fly_console_disable" => fly::set_enabled(&payload, false),
        "fly_console_open" => fly::open_backup(),
        "backup_3c_status" => backup::status_3c(&payload),
        "backup_3c_run" => backup::run_3c(&payload),
        "backup_3c_open" => backup::open_3c(),
        "backup_profile_status" => backup::status_profile(&payload),
        "backup_profile_run" => backup::run_profile(&payload),
        "backup_profile_open" => backup::open_profile(),
        "auto_chat_status" => chat::status(),
        "auto_chat_configure" => chat::configure(&payload),
        "auto_chat_start" => chat::start(&payload),
        "auto_chat_stop" => chat::stop(),
        "tmp_tag_status" => tag::status(),
        "tmp_tag_apply" => tag::apply(&payload),
        "tmp_tag_defaults" => tag::defaults(),
        "tmp_lookup" => remote::tmp_player(&payload),
        "api_request" => remote::api_request(&payload),
        other => Err(format!("未知本机能力：{other}")),
    }
}
