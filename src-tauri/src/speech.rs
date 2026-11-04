//! Optional pronunciation backends that need native access: HTTP TTS APIs (no CORS, results
//! cached on disk so each word is fetched once) and local voice-pack folders.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpTtsRequest {
    preset: String,
    url: String,
    api_key: String,
    model: String,
    region: String,
    voice: String,
    text: String,
    rate: f32,
}

#[tauri::command]
pub async fn tts_http(app: AppHandle, request: HttpTtsRequest) -> Result<Response, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("tts");
    let key = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    let cache_file = cache_dir.join(format!("{:016x}.audio", fnv1a(key.as_bytes())));
    if let Ok(bytes) = fs::read(&cache_file) {
        return Ok(Response::new(bytes));
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || fetch(&request))
        .await
        .map_err(|e| e.to_string())??;
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    // Write-then-rename so a crash never leaves a truncated clip in the cache.
    let tmp = cache_file.with_extension("tmp");
    fs::write(&tmp, &bytes).and_then(|_| fs::rename(&tmp, &cache_file)).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

fn fetch(r: &HttpTtsRequest) -> Result<Vec<u8>, String> {
    let err = |e: ureq::Error| format!("Lỗi gọi API giọng đọc: {e}");
    let mut response = match r.preset.as_str() {
        "openai" => {
            let body = serde_json::json!({
                "model": r.model, "input": r.text, "voice": r.voice,
                "response_format": "mp3", "speed": r.rate,
            });
            let mut req = ureq::post(&r.url);
            if !r.api_key.is_empty() {
                req = req.header("Authorization", &format!("Bearer {}", r.api_key));
            }
            req.send_json(&body).map_err(err)?
        }
        "azure" => {
            let url = format!("https://{}.tts.speech.microsoft.com/cognitiveservices/v1", r.region);
            let rate = format!("{:+.0}%", (r.rate - 1.0) * 100.0);
            let ssml = format!(
                "<speak version='1.0' xml:lang='zh-CN'><voice name='{}'><prosody rate='{}'>{}</prosody></voice></speak>",
                xml_escape(&r.voice), rate, xml_escape(&r.text)
            );
            ureq::post(&url)
                .header("Ocp-Apim-Subscription-Key", &r.api_key)
                .header("Content-Type", "application/ssml+xml")
                .header("X-Microsoft-OutputFormat", "audio-24khz-48kbitrate-mono-mp3")
                .header("User-Agent", "TieuMai")
                .send(ssml.as_str())
                .map_err(err)?
        }
        _ => {
            let url = r.url.replace("{text}", &url_encode(&r.text)).replace("{voice}", &url_encode(&r.voice));
            ureq::get(&url).call().map_err(err)?
        }
    };
    response.body_mut().read_to_vec().map_err(err)
}

#[derive(Deserialize, Serialize)]
pub struct VoicePackManifest {
    name: String,
    #[serde(default)]
    license: String,
    #[serde(default = "default_format")]
    format: String,
    /// slot ("female" | "male") → sub-folder holding that voice's clips.
    voices: std::collections::HashMap<String, String>,
}

fn default_format() -> String {
    "mp3".into()
}

fn read_manifest(dir: &Path) -> Result<VoicePackManifest, String> {
    let text = fs::read_to_string(dir.join("manifest.json")).map_err(|_| "Thư mục không có manifest.json của gói giọng.".to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("manifest.json không hợp lệ: {e}"))
}

#[tauri::command]
pub fn voicepack_info(dir: String) -> Result<VoicePackManifest, String> {
    read_manifest(Path::new(&dir))
}

#[tauri::command]
pub fn voicepack_clip(dir: String, slot: String, text: String) -> Result<Response, String> {
    // Clip names are the Chinese text itself; refuse anything that could escape the folder.
    if text.is_empty() || text.contains(['/', '\\', ':']) || text.contains("..") {
        return Err("Tên đoạn âm không hợp lệ.".into());
    }
    let dir = PathBuf::from(dir);
    let manifest = read_manifest(&dir)?;
    let voice = manifest.voices.get(&slot).ok_or("Gói giọng không có giọng này.")?;
    let path = dir.join(voice).join(format!("{text}.{}", manifest.format));
    fs::read(&path).map(Response::new).map_err(|_| "Gói giọng chưa có âm cho từ này.".into())
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |h, b| (h ^ *b as u64).wrapping_mul(0x100000001b3))
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('\'', "&apos;").replace('"', "&quot;")
}

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
