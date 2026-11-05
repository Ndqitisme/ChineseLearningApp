//! What the user is doing right now, so the assistant knows when to stay quiet.

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::PET_LABEL;

const MONITOR_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct SystemState {
    /// A fullscreen app, game or presentation is in front.
    busy: bool,
    /// Seconds since the last keyboard/mouse input.
    idle_secs: u64,
}

#[tauri::command]
pub fn system_state() -> SystemState {
    SystemState { busy: is_busy(), idle_secs: idle_secs() }
}

/// Emits `system:busy` to the pet window when fullscreen state flips, and keeps the
/// pet above other topmost windows (the taskbar steals topmost when clicked).
pub fn spawn_monitor(app: AppHandle) {
    std::thread::Builder::new()
        .name("system-monitor".into())
        .spawn(move || {
            let mut last_busy = false;
            loop {
                std::thread::sleep(MONITOR_INTERVAL);
                let busy = is_busy();
                if busy != last_busy {
                    let _ = app.emit_to(PET_LABEL, "system:busy", busy);
                    last_busy = busy;
                }
                if !busy {
                    keep_topmost(&app);
                }
            }
        })
        .expect("spawn system monitor thread");
}

#[cfg(windows)]
fn is_busy() -> bool {
    use windows::Win32::UI::Shell::{
        QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN, SHQueryUserNotificationState,
    };
    match unsafe { SHQueryUserNotificationState() } {
        Ok(s) => s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

#[cfg(windows)]
fn idle_secs() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    if unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        (unsafe { GetTickCount() }.wrapping_sub(info.dwTime) / 1000) as u64
    } else {
        0
    }
}

#[cfg(windows)]
fn keep_topmost(app: &AppHandle) {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SetWindowPos,
    };
    let Some(pet) = app.get_webview_window(PET_LABEL) else { return };
    let Ok(hwnd) = pet.hwnd() else { return };
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
    }
}

// Fullscreen and idle detection are Windows-only (see docs/PLAN.md §9).
#[cfg(not(windows))]
fn is_busy() -> bool {
    false
}

#[cfg(not(windows))]
fn idle_secs() -> u64 {
    0
}

#[cfg(not(windows))]
fn keep_topmost(_app: &AppHandle) {}
