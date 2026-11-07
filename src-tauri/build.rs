fn main() {
    // Listing the commands makes each one need an `allow-<command>` permission, so capabilities/
    // can grant each window only the commands it calls.
    let commands = tauri_build::AppManifest::new().commands(&[
        "open_main",
        "pet_set_hit_rects",
        "system_state",
        "tts_http",
        "voicepack_info",
        "voicepack_clip",
        "store_load",
        "store_set",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands)).expect("failed to run tauri-build");

    // tauri-build links the resource holding the app manifest (Common Controls v6) into the binary
    // only; the lib's unit tests link it through `#[link]` in lib.rs and need its folder.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-search=native={}", std::env::var("OUT_DIR").unwrap());
    }
}
