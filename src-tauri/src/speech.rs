//! Optional pronunciation backends that need native access: HTTP TTS APIs (no CORS, results
//! cached on disk so each word is fetched once) and local voice-pack folders.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

const CALL_TIMEOUT: Duration = Duration::from_secs(30);

// ureq waits forever by default, which would leave the speak button spinning on a dead server.
static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(CALL_TIMEOUT))
        .build()
        .into()
});

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
    let (bytes, content_type) = tauri::async_runtime::spawn_blocking(move || fetch(&request))
        .await
        .map_err(|e| e.to_string())??;
    // An error page or an empty body must not be replayed from the cache forever.
    if is_audio(&bytes, &content_type) {
        if let Err(e) = write_cache(&cache_dir, &cache_file, &bytes) {
            eprintln!("tts cache {}: {e}", cache_file.display());
        }
    }
    Ok(Response::new(bytes))
}

/// Write-then-rename so a crash never leaves a truncated clip, under a temp name of its own so two
/// requests for the same word never write the same file.
fn write_cache(dir: &Path, file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fs::create_dir_all(dir)?;
    let tmp = file.with_extension(format!("{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let result = File::create(&tmp)
        .and_then(|mut f| f.write_all(bytes).and_then(|_| f.sync_all()))
        .and_then(|_| fs::rename(&tmp, file));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn is_audio(bytes: &[u8], content_type: &str) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let starts = |magic: &[u8]| bytes.starts_with(magic);
    content_type.trim().to_ascii_lowercase().starts_with("audio/")
        || starts(b"ID3")
        || (bytes.len() > 1 && bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0) // MPEG / ADTS frame sync
        || (starts(b"RIFF") && bytes.get(8..12) == Some(b"WAVE"))
        || starts(b"OggS")
        || starts(b"fLaC")
        || starts(&[0x1A, 0x45, 0xDF, 0xA3]) // WebM
        || bytes.get(4..8) == Some(b"ftyp") // MP4 / M4A
}

fn fetch(r: &HttpTtsRequest) -> Result<(Vec<u8>, String), String> {
    let err = |e: ureq::Error| match e {
        ureq::Error::Timeout(_) => format!("API giọng đọc không trả lời trong {} giây.", CALL_TIMEOUT.as_secs()),
        ureq::Error::StatusCode(code) => format!("API giọng đọc trả về lỗi HTTP {code}."),
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed => {
            format!("Không kết nối được tới API giọng đọc ({e}).")
        }
        e => format!("Lỗi gọi API giọng đọc: {e}"),
    };
    let mut response = match r.preset.as_str() {
        "openai" => {
            let body = serde_json::json!({
                "model": r.model, "input": r.text, "voice": r.voice,
                "response_format": "mp3", "speed": r.rate,
            });
            let mut req = AGENT.post(&r.url);
            if !r.api_key.is_empty() {
                req = req.header("Authorization", &format!("Bearer {}", r.api_key));
            }
            req.send_json(&body).map_err(err)?
        }
        "azure" => {
            // The region becomes part of the hostname.
            if r.region.is_empty() || !r.region.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err("Vùng Azure chỉ gồm chữ và số, ví dụ southeastasia.".into());
            }
            let url = format!("https://{}.tts.speech.microsoft.com/cognitiveservices/v1", r.region);
            let rate = format!("{:+.0}%", (r.rate - 1.0) * 100.0);
            let ssml = format!(
                "<speak version='1.0' xml:lang='zh-CN'><voice name='{}'><prosody rate='{}'>{}</prosody></voice></speak>",
                xml_escape(&r.voice), rate, xml_escape(&r.text)
            );
            AGENT
                .post(&url)
                .header("Ocp-Apim-Subscription-Key", &r.api_key)
                .header("Content-Type", "application/ssml+xml")
                .header("X-Microsoft-OutputFormat", "audio-24khz-48kbitrate-mono-mp3")
                .header("User-Agent", "TieuMai")
                .send(ssml.as_str())
                .map_err(err)?
        }
        _ => {
            let url = r.url.replace("{text}", &url_encode(&r.text)).replace("{voice}", &url_encode(&r.voice));
            AGENT.get(&url).call().map_err(err)?
        }
    };
    let content_type =
        response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    Ok((response.body_mut().read_to_vec().map_err(err)?, content_type))
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
pub async fn voicepack_info(dir: String) -> Result<VoicePackManifest, String> {
    read_manifest(Path::new(&dir))
}

#[tauri::command]
pub async fn voicepack_clip(dir: String, slot: String, text: String) -> Result<Response, String> {
    let dir = PathBuf::from(dir);
    let manifest = read_manifest(&dir)?;
    let path = clip_path(&dir, &manifest, &slot, &text)?;
    fs::read(&path).map(Response::new).map_err(|_| "Gói giọng chưa có âm cho từ này.".into())
}

/// The clip file for `text`, refusing any manifest entry or text that would leave the pack folder.
fn clip_path(dir: &Path, manifest: &VoicePackManifest, slot: &str, text: &str) -> Result<PathBuf, String> {
    // Clip names are the Chinese text itself.
    if text.is_empty() || text.contains(['/', '\\', ':']) || text.contains("..") {
        return Err("Tên đoạn âm không hợp lệ.".into());
    }
    let voice = manifest.voices.get(slot).ok_or("Gói giọng không có giọng này.")?;
    let mut parts = Path::new(voice).components();
    if !matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None)) {
        return Err("manifest.json: giọng phải là tên một thư mục con trong gói.".into());
    }
    let format = &manifest.format;
    if format.is_empty() || format.len() > 5 || !format.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("manifest.json: định dạng âm thanh không hợp lệ.".into());
    }
    let base = dir.canonicalize().map_err(|_| "Không mở được thư mục gói giọng.".to_string())?;
    let path = dir
        .join(voice)
        .join(format!("{text}.{format}"))
        .canonicalize()
        .map_err(|_| "Gói giọng chưa có âm cho từ này.".to_string())?;
    // A symlink inside the pack can still point elsewhere.
    if !path.starts_with(&base) {
        return Err("Đoạn âm nằm ngoài thư mục gói giọng.".into());
    }
    Ok(path)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn pack(voice: &str, format: &str) -> (PathBuf, VoicePackManifest) {
        let dir = std::env::temp_dir().join(format!("tieumai-pack-{}", std::process::id()));
        fs::create_dir_all(dir.join("female")).unwrap();
        fs::write(dir.join("female").join("吃.mp3"), b"ID3").unwrap();
        let voices = [("female".to_string(), voice.to_string())].into();
        (dir, VoicePackManifest { name: "test".into(), license: String::new(), format: format.into(), voices })
    }

    #[test]
    fn clip_inside_pack_is_found() {
        let (dir, manifest) = pack("female", "mp3");
        let path = clip_path(&dir, &manifest, "female", "吃").unwrap();
        assert!(path.ends_with(Path::new("female").join("吃.mp3")));
    }

    #[test]
    fn manifest_cannot_point_outside_pack() {
        // An absolute voice folder that holds the clip, so only the path check can refuse it.
        let outside = std::env::temp_dir().join(format!("tieumai-outside-{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("吃.mp3"), b"ID3").unwrap();
        let outside = outside.to_string_lossy().into_owned();
        for (voice, format) in
            [(outside.as_str(), "mp3"), ("female", "/../../x"), ("female", ".."), ("..", "mp3"), ("female/..", "mp3"), ("", "mp3")]
        {
            let (dir, manifest) = pack(voice, format);
            assert!(clip_path(&dir, &manifest, "female", "吃").is_err(), "{voice:?} {format:?}");
        }
    }

    #[test]
    fn only_audio_is_cached() {
        assert!(is_audio(b"ID3\x04", ""));
        assert!(is_audio(b"\x00\x01", "audio/mpeg"));
        assert!(!is_audio(b"", "audio/mpeg"));
        assert!(!is_audio(br#"{"error":"quota"}"#, "application/json"));
    }
}
