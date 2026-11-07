mod pet;
mod speech;
mod store;
mod system;
mod tray;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

pub const MAIN_LABEL: &str = "main";
pub const PET_LABEL: &str = "pet";
// The dialog plugin imports TaskDialogIndirect, which only Common Controls v6 has. Without the app
// manifest that selects it, the unit-test exe fails to start (STATUS_ENTRYPOINT_NOT_FOUND).
#[cfg(all(test, windows, target_env = "gnu"))]
#[link(name = "resource", kind = "static")]
unsafe extern "C" {}

const AUTOSTART_FLAG: &str = "--autostart";
const MAIN_SIZE: (f64, f64) = (1120.0, 760.0);
const MAIN_MIN_SIZE: (f64, f64) = (860.0, 600.0);

/// Opens the learning window, creating it if it was destroyed on close.
/// `route` is a hash route such as `/word/吃`.
/// Async on purpose: building a window inside a synchronous command deadlocks on Windows.
#[tauri::command]
async fn open_main(app: tauri::AppHandle, route: Option<String>) -> tauri::Result<()> {
    show_main(&app, route.as_deref())
}

/// For tray and single-instance callbacks: building a window synchronously inside an event
/// handler can deadlock on Windows.
pub fn show_main_later(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = show_main(&app, None);
    });
}

pub fn show_main(app: &tauri::AppHandle, route: Option<&str>) -> tauri::Result<()> {
    use tauri::Emitter;
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        if let Some(route) = route {
            win.emit_to(MAIN_LABEL, "main:navigate", route)?;
        }
        win.unminimize()?;
        win.show()?;
        win.set_focus()?;
        return Ok(());
    }
    let url = match route {
        Some(r) => format!("index.html#{r}"),
        None => "index.html".to_string(),
    };
    let builder = WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App(url.into()))
        .title("TieuMai - Chinese Learning")
        .decorations(false)
        .transparent(false)
        .visible(false);
    let builder = match app.primary_monitor()? {
        // On a small screen (1366×768 at 125 %) the full size is taller than the work area, and
        // centring it would push the custom title bar above the screen where it cannot be dragged.
        Some(monitor) => {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let (x, y) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
            let (aw, ah) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
            let (w, h) = (MAIN_SIZE.0.min(aw), MAIN_SIZE.1.min(ah));
            builder
                .inner_size(w, h)
                .min_inner_size(MAIN_MIN_SIZE.0.min(aw), MAIN_MIN_SIZE.1.min(ah))
                .position(x + (aw - w) / 2.0, y + (ah - h) / 2.0)
        }
        None => builder.inner_size(MAIN_SIZE.0, MAIN_SIZE.1).min_inner_size(MAIN_MIN_SIZE.0, MAIN_MIN_SIZE.1).center(),
    };
    builder.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Must be registered first so a second launch only focuses the running instance.
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_later(app)))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec![AUTOSTART_FLAG]),
            ));
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pet::HitState::default())
        .invoke_handler(tauri::generate_handler![
            open_main,
            pet::pet_set_hit_rects,
            system::system_state,
            speech::tts_http,
            speech::voicepack_info,
            speech::voicepack_clip,
            store::store_load,
            store::store_set,
        ])
        .setup(|app| {
            // Before any window exists, so no page can read a store that has not been recovered yet.
            app.manage(store::init(app.handle())?);
            #[cfg(desktop)]
            {
                pet::create_pet_window(app.handle())?;
                tray::create_tray(app.handle())?;
                system::spawn_monitor(app.handle().clone());
                let autostarted = std::env::args().any(|a| a == AUTOSTART_FLAG);
                if !autostarted {
                    show_main(app.handle(), None)?;
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building TieuMai - Chinese Learning");

    app.run(|app, event| match event {
        // Closing every window must not quit: the app lives in the tray.
        RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
        RunEvent::Exit => app.state::<store::Stores>().save_all(),
        _ => {}
    });
}
