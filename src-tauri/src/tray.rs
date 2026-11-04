use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

use crate::{PET_LABEL, show_main_later};

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Mở Tiểu Mai", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle-pet", "Hiện / ẩn trợ lý", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Từ tiếp theo", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Tạm dừng 30 phút", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Tiếp tục", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &toggle, &next, &pause, &resume, &sep, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Tiểu Mai — học tiếng Trung")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_later(app),
            "quit" => app.exit(0),
            id => {
                // The pet window owns the scheduler; forward the command to it.
                let _ = app.emit_to(PET_LABEL, "tray:command", id);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_later(tray.app_handle());
            }
        });
    // A face close-up: the full app icon turns to mush at the 16-24 px trays use.
    tray = tray.icon(tauri::include_image!("icons/tray.png"));
    tray.build(app)?;
    Ok(())
}
