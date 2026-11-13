use std::fs;
use std::path::Path;

pub fn read_sii(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取 {} 失败：{e}", path.display()))?;
    decode_sii(&bytes)
}

pub fn decode_sii(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("存档文件是空的".into());
    }
    let body = bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .unwrap_or(bytes);
    if body.starts_with(b"SiiNunit") || body.starts_with(b"SiiNUnit") {
        return bytes_to_text(body.to_vec());
    }
    let decoded = decrypt_truck::decrypt_bin_file(&bytes.to_vec())
        .map_err(|err| format!("解密 game.sii 失败：{err}"))?;
    bytes_to_text(decoded)
}

fn bytes_to_text(mut bytes: Vec<u8>) -> Result<String, String> {
    while bytes.last() == Some(&0) {
        bytes.pop();
    }
    let text = String::from_utf8(bytes).map_err(|_| "解密结果不是文本存档".to_string())?;
    if !text.contains("SiiNunit") && !text.contains("SiiNUnit") {
        return Err("解密结果不是有效的 game.sii".into());
    }
    Ok(text)
}

pub fn split_lines(text: &str) -> (Vec<String>, &'static str) {
    if text.contains("\r\n") {
        (
            text.split("\r\n").map(|s| s.to_string()).collect(),
            "\r\n",
        )
    } else {
        (text.split('\n').map(|s| s.to_string()).collect(), "\n")
    }
}

pub fn join_lines(lines: &[String], newline: &str) -> String {
    let mut text = lines.join(newline);
    if !text.ends_with(newline) {
        text.push_str(newline);
    }
    text
}

pub fn field_key(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
        return None;
    }
    let (left, _) = trimmed.split_once(':')?;
    let key = left.trim();
    if key.is_empty() {
        None
    } else {
        Some(key)
    }
}

pub fn value_of(line: &str) -> String {
    line.split_once(':')
        .map(|(_, right)| right.trim().trim_matches('"').to_string())
        .unwrap_or_default()
}

pub fn rewrite_value(line: &str, value: &str) -> String {
    match line.find(':') {
        Some(idx) => format!("{} {value}", &line[..=idx]),
        None => line.to_string(),
    }
}

pub fn indent_of(line: &str) -> &str {
    let end = line
        .char_indices()
        .find(|(_, ch)| !ch.is_whitespace())
        .map(|(i, _)| i)
        .unwrap_or(0);
    &line[..end]
}
