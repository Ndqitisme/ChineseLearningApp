mod pet;
mod speech;
mod system;
mod tray;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

pub const MAIN_LABEL: &str = "main";
pub const PET_LABEL: &str = "pet";
const AUTOSTART_FLAG: &str = "--autostart";

/// Opens the learning window, creating it if it was destroyed on close.
/// `route` is a hash route such as `/word/吃`.
/// Async on purpose: building a window inside a synchronous command deadlocks on Windows.
#[tauri::command]
async fn open_main(app: tauri::AppHandle, route: Option<String>) -> tauri::Result<()> {
    show_main(&app, route.as_deref())
}

/// For tray and single-instance callbacks: those run inside event handlers, where building a
/// window synchronously can deadlock on Windows, so hand the work to the async runtime.
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
    WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App(url.into()))
        .title("TieuMai - Chinese Learning")
        .inner_size(1120.0, 760.0)
        .min_inner_size(860.0, 600.0)
        .decorations(false)
        .transparent(false)
        .visible(false)
        .center()
        .build()?;
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
        .plugin(tauri_plugin_store::Builder::new().build())
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
        ])
        .setup(|app| {
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

    app.run(|_app, event| {
        // Closing every window must not quit: the app lives in the tray.
        if let RunEvent::ExitRequested { code: None, api, .. } = event {
            api.prevent_exit();
        }
    });
}
