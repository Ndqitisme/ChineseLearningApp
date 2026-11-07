//! settings.json and progress.json in the app data folder, shared by both windows.
//!
//! A save writes a synced temp file and renames it over the target, keeping the replaced file as
//! `<name>.bak`. The file on disk is therefore always a complete save, and a file that still fails
//! to parse at start-up (damaged disk, or written by an older version that saved in place) is set
//! aside and replaced by the backup instead of starting empty.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// The only files the windows can open: name, what the user calls it, and how long a change
/// waits for more changes before it is written.
const FILES: [(&str, &str, Duration); 2] = [
    ("settings.json", "Cài đặt", Duration::from_millis(300)),
    ("progress.json", "Tiến độ học", Duration::from_millis(1500)),
];

/// Sent to every window after each write, the writer included.
const CHANGE_EVENT: &str = "store:change";

#[derive(Serialize, Clone)]
struct Change<'a> {
    name: &'a str,
    key: &'a str,
    value: &'a Value,
}

pub struct Stores(HashMap<&'static str, Arc<StoreFile>>);

struct StoreFile {
    path: PathBuf,
    debounce: Duration,
    contents: Mutex<Contents>,
    save_scheduled: AtomicBool,
    /// Held from taking the snapshot until it is on disk, so saves land in the order they were taken.
    writing: Mutex<()>,
}

struct Contents {
    entries: Map<String, Value>,
    dirty: bool,
}

#[derive(Debug, PartialEq)]
enum Recovery {
    None,
    Restored,
    /// The damaged file was moved to this path and the store starts empty.
    Lost(PathBuf),
}

impl Stores {
    fn get(&self, name: &str) -> Result<&Arc<StoreFile>, String> {
        self.0.get(name).ok_or_else(|| format!("Không có kho dữ liệu {name}."))
    }

    pub fn save_all(&self) {
        for file in self.0.values() {
            if let Err(e) = file.save() {
                eprintln!("saving {}: {e}", file.path.display());
            }
        }
    }
}

impl StoreFile {
    fn save(&self) -> io::Result<()> {
        let _writing = self.writing.lock().unwrap();
        let bytes = {
            let mut contents = self.contents.lock().unwrap();
            if !contents.dirty {
                return Ok(());
            }
            contents.dirty = false;
            serde_json::to_vec_pretty(&contents.entries)?
        };
        write_atomic(&self.path, &bytes).inspect_err(|_| self.contents.lock().unwrap().dirty = true)
    }

    fn schedule_save(self: &Arc<Self>) {
        if self.save_scheduled.swap(true, Ordering::AcqRel) {
            return;
        }
        let file = self.clone();
        std::thread::spawn(move || {
            let mut wait = file.debounce;
            loop {
                std::thread::sleep(wait);
                file.save_scheduled.store(false, Ordering::Release);
                let Err(e) = file.save() else { return };
                eprintln!("saving {}: {e}", file.path.display());
                // Antivirus or the search indexer can hold the just-renamed file for a moment, so a
                // failed save is retried with backoff, unless a newer write already scheduled its own.
                if file.save_scheduled.swap(true, Ordering::AcqRel) {
                    return;
                }
                wait = (wait * 2).clamp(Duration::from_secs(1), Duration::from_secs(60));
            }
        });
    }
}

/// Reads both files, restoring damaged ones from their backups, and tells the user once if it had to.
pub fn init(app: &AppHandle) -> Result<Stores, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut files = HashMap::new();
    let mut notices = Vec::new();
    for (name, label, debounce) in FILES {
        let path = dir.join(name);
        let (entries, recovery) = load_or_recover(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        match recovery {
            Recovery::None => {}
            Recovery::Restored => {
                notices.push(format!("{label} bị hỏng khi lưu lần trước.\nĐã khôi phục từ bản sao lưu gần nhất."))
            }
            Recovery::Lost(damaged) => notices.push(format!(
                "{label} bị hỏng và không có bản sao lưu.\nTệp hỏng được giữ ở {}.",
                damaged.display()
            )),
        }
        let contents = Mutex::new(Contents { entries, dirty: false });
        let file = StoreFile { path, debounce, contents, save_scheduled: AtomicBool::new(false), writing: Mutex::new(()) };
        files.insert(name, Arc::new(file));
    }
    if !notices.is_empty() {
        app.dialog().message(notices.join("\n\n")).title("Tiểu Mai").kind(MessageDialogKind::Warning).show(|_| {});
    }
    Ok(Stores(files))
}

#[tauri::command]
pub async fn store_load(stores: State<'_, Stores>, name: String) -> Result<Map<String, Value>, String> {
    Ok(stores.get(&name)?.contents.lock().unwrap().entries.clone())
}

#[tauri::command]
pub async fn store_set(app: AppHandle, stores: State<'_, Stores>, name: String, key: String, value: Value) -> Result<(), String> {
    let file = stores.get(&name)?;
    {
        let mut contents = file.contents.lock().unwrap();
        // Emitted under the lock so every window sees writes in the order they reach the file.
        app.emit(CHANGE_EVENT, Change { name: &name, key: &key, value: &value }).map_err(|e| e.to_string())?;
        contents.entries.insert(key, value);
        contents.dirty = true;
    }
    file.schedule_save();
    Ok(())
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".");
    name.push(suffix);
    name.into()
}

fn read_good(path: &Path) -> Option<Map<String, Value>> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// Replaces `path` with `bytes` so that a crash at any point leaves a complete file at `path`,
/// or (between the two renames) none there and a complete one at `<path>.tmp`.
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = sibling(path, "tmp");
    let mut file = File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    // Only complete saves ever sit at `path`, so the file being replaced is a good backup.
    match fs::rename(path, sibling(path, "bak")) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    fs::rename(&tmp, path)
}

fn load_or_recover(path: &Path) -> io::Result<(Map<String, Value>, Recovery)> {
    match fs::read(path) {
        Ok(bytes) => {
            if let Ok(entries) = serde_json::from_slice(&bytes) {
                return Ok((entries, Recovery::None));
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            // A save cut off between its two renames left the newest data, complete, in the temp file.
            let tmp = sibling(path, "tmp");
            if let Some(entries) = read_good(&tmp) {
                fs::rename(&tmp, path)?;
                return Ok((entries, Recovery::None));
            }
            // A crash while writing that temp file (or a restore cut short) leaves only the backup.
            // Starting empty here would let the next two saves overwrite it.
            return Ok(match restore_backup(path)? {
                Some(entries) => (entries, Recovery::Restored),
                None => (Map::new(), Recovery::None),
            });
        }
        Err(e) => return Err(e),
    }
    let damaged = sibling(path, "damaged");
    fs::rename(path, &damaged)?;
    Ok(match restore_backup(path)? {
        Some(entries) => (entries, Recovery::Restored),
        None => (Map::new(), Recovery::Lost(damaged)),
    })
}

/// Rewrites `path` (which must not exist) from `<path>.bak`, leaving the backup untouched.
fn restore_backup(path: &Path) -> io::Result<Option<Map<String, Value>>> {
    let Some(entries) = read_good(&sibling(path, "bak")) else { return Ok(None) };
    write_atomic(path, &serde_json::to_vec_pretty(&entries)?)?;
    Ok(Some(entries))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tieumai-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn save(path: &Path, value: Value) {
        write_atomic(path, &serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    }

    /// Two saves, so the backup holds the first and the file the second.
    fn saved_twice(name: &str) -> PathBuf {
        let path = temp_dir(name).join("progress.json");
        save(&path, json!({ "srs": { "吃": 1 } }));
        save(&path, json!({ "srs": { "吃": 2 } }));
        path
    }

    #[test]
    fn save_keeps_previous_file_as_backup() {
        let path = saved_twice("rotate");
        assert_eq!(read_good(&path), json!({ "srs": { "吃": 2 } }).as_object().cloned());
        assert_eq!(read_good(&sibling(&path, "bak")), json!({ "srs": { "吃": 1 } }).as_object().cloned());
        assert!(!sibling(&path, "tmp").exists());
    }

    #[test]
    fn damaged_file_is_restored_from_backup_without_touching_it() {
        let truncated = |bytes: &[u8]| bytes[..bytes.len() / 2].to_vec();
        let cases: [(&str, fn(&[u8]) -> Vec<u8>); 3] =
            [("truncated", truncated), ("garbage", |_| b"\x00\x00\x00\x00garbage".to_vec()), ("empty", |_| Vec::new())];
        for (name, damage) in cases {
            let path = saved_twice(name);
            let bak = sibling(&path, "bak");
            let bak_before = fs::read(&bak).unwrap();
            let damaged_bytes = damage(&fs::read(&path).unwrap());
            fs::write(&path, &damaged_bytes).unwrap();

            let (entries, recovery) = load_or_recover(&path).unwrap();
            assert_eq!(recovery, Recovery::Restored, "{name}");
            assert_eq!(Value::Object(entries.clone()), json!({ "srs": { "吃": 1 } }), "{name}");
            assert_eq!(fs::read(&bak).unwrap(), bak_before, "{name}: backup changed");
            assert_eq!(read_good(&path), Some(entries), "{name}: file not rewritten");
            assert_eq!(fs::read(sibling(&path, "damaged")).unwrap(), damaged_bytes, "{name}");

            // The next save must back up the restored file, not the damaged one.
            save(&path, json!({ "srs": { "吃": 3 } }));
            assert_eq!(read_good(&bak), json!({ "srs": { "吃": 1 } }).as_object().cloned(), "{name}");
        }
    }

    #[test]
    fn damaged_file_without_backup_is_kept_aside() {
        let path = temp_dir("lost").join("settings.json");
        fs::write(&path, b"{\"settings\": {\"theme\"").unwrap();
        let (entries, recovery) = load_or_recover(&path).unwrap();
        assert!(entries.is_empty());
        assert_eq!(recovery, Recovery::Lost(sibling(&path, "damaged")));
        assert_eq!(fs::read(sibling(&path, "damaged")).unwrap(), b"{\"settings\": {\"theme\"");
        assert!(!path.exists() && !sibling(&path, "bak").exists());
    }

    #[test]
    fn save_cut_between_renames_is_completed() {
        let path = saved_twice("between");
        // State after the first rename of a third save: no file, the new data in the temp file.
        fs::write(sibling(&path, "tmp"), serde_json::to_vec(&json!({ "srs": { "吃": 3 } })).unwrap()).unwrap();
        fs::rename(&path, sibling(&path, "bak")).unwrap();
        let (entries, recovery) = load_or_recover(&path).unwrap();
        assert_eq!(recovery, Recovery::None);
        assert_eq!(Value::Object(entries), json!({ "srs": { "吃": 3 } }));
        assert_eq!(read_good(&path), json!({ "srs": { "吃": 3 } }).as_object().cloned());
    }

    #[test]
    fn missing_file_with_damaged_temp_is_restored_from_backup() {
        let path = saved_twice("tmp-cut");
        // A crash while a restore or save was writing its temp file: no file, a half temp file, the backup.
        fs::remove_file(&path).unwrap();
        fs::write(sibling(&path, "tmp"), b"{\"srs\": {\"").unwrap();
        let bak_before = fs::read(sibling(&path, "bak")).unwrap();
        let (entries, recovery) = load_or_recover(&path).unwrap();
        assert_eq!(recovery, Recovery::Restored);
        assert_eq!(Value::Object(entries.clone()), json!({ "srs": { "吃": 1 } }));
        assert_eq!(read_good(&path), Some(entries));
        assert_eq!(fs::read(sibling(&path, "bak")).unwrap(), bak_before);
    }

    #[test]
    fn missing_file_starts_empty() {
        let path = temp_dir("fresh").join("progress.json");
        let (entries, recovery) = load_or_recover(&path).unwrap();
        assert!(entries.is_empty());
        assert_eq!(recovery, Recovery::None);
    }
}
