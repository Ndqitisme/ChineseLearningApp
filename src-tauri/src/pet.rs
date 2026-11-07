//! The desktop assistant window: transparent, frameless, always on top.
//!
//! Transparent pixels still swallow clicks and Tauri can only make a whole window
//! click-through, so a poller accepts input only while the cursor is over the rects the page reports.

use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::PET_LABEL;

const POLL_INTERVAL: Duration = Duration::from_millis(66);

/// A rectangle in CSS pixels relative to the pet window's top-left corner.
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Copy)]
struct Origin {
    x: f64,
    y: f64,
    scale: f64,
}

#[derive(Default)]
pub struct HitState {
    rects: Mutex<Vec<Rect>>,
    origin: Arc<Mutex<Option<Origin>>>,
}

#[tauri::command]
pub fn pet_set_hit_rects(state: State<'_, HitState>, rects: Vec<Rect>) {
    *state.rects.lock().unwrap() = rects;
}

pub fn create_pet_window(app: &AppHandle) -> tauri::Result<()> {
    let pet = WebviewWindowBuilder::new(app, PET_LABEL, WebviewUrl::App("pet.html".into()))
        .title("TieuMai - Chinese Learning")
        .inner_size(340.0, 330.0)
        .transparent(true)
        .no_redirection_bitmap(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .visible(false)
        .build()?;

    let origin = app.state::<HitState>().origin.clone();
    let read_origin = |w: &tauri::WebviewWindow| -> Option<Origin> {
        let pos = w.inner_position().ok()?;
        Some(Origin { x: pos.x as f64, y: pos.y as f64, scale: w.scale_factor().ok()? })
    };
    *origin.lock().unwrap() = read_origin(&pet);
    let pet_for_events = pet.clone();
    pet.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. } | WindowEvent::Resized(_)) {
            *origin.lock().unwrap() = read_origin(&pet_for_events);
        }
    });

    if cursor_tracking_supported() {
        spawn_hit_poller(app.clone(), pet);
    }
    Ok(())
}

/// Wayland exposes no global cursor position, so the window simply stays clickable there.
fn cursor_tracking_supported() -> bool {
    if cfg!(target_os = "linux") {
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
        // GDK_BACKEND is a preference list such as "x11,wayland"; GTK takes the first one that works,
        // and with WAYLAND_DISPLAY set both would.
        let forced_x11 = std::env::var("GDK_BACKEND")
            .is_ok_and(|v| v.split(',').map(str::trim).find(|b| *b == "x11" || *b == "wayland") == Some("x11"));
        return !wayland || forced_x11;
    }
    true
}

fn spawn_hit_poller(app: AppHandle, pet: tauri::WebviewWindow) {
    std::thread::Builder::new()
        .name("pet-hit-test".into())
        .spawn(move || {
            let state = app.state::<HitState>();
            let mut ignoring: Option<bool> = None;
            loop {
                std::thread::sleep(POLL_INTERVAL);
                let Some(origin) = *state.origin.lock().unwrap() else { continue };
                let Some((cx, cy)) = cursor_position(&app) else { continue };
                let lx = (cx - origin.x) / origin.scale;
                let ly = (cy - origin.y) / origin.scale;
                let inside = state.rects.lock().unwrap().iter().any(|r| {
                    lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h
                });
                let want_ignore = !inside;
                if ignoring != Some(want_ignore) {
                    if pet.set_ignore_cursor_events(want_ignore).is_err() {
                        break; // window destroyed
                    }
                    ignoring = Some(want_ignore);
                }
            }
        })
        .expect("spawn pet hit-test thread");
}

/// Physical screen coordinates of the cursor.
#[cfg(windows)]
fn cursor_position(_app: &AppHandle) -> Option<(f64, f64)> {
    // Direct call: avoids a round-trip through the main event loop 15 times a second.
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some((p.x as f64, p.y as f64))
}

#[cfg(not(windows))]
fn cursor_position(app: &AppHandle) -> Option<(f64, f64)> {
    let p = app.cursor_position().ok()?;
    Some((p.x, p.y))
}
