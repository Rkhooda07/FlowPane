use tauri::{Manager, Emitter};
#[allow(unused_imports)]
use window_vibrancy::{apply_acrylic, apply_vibrancy, NSVisualEffectMaterial};
use std::time::Duration;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_cursor_position(app: tauri::AppHandle) -> Result<(f64, f64), String> {
    match app.cursor_position() {
        Ok(pos) => Ok((pos.x, pos.y)),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // Background task to track mouse hover for inactive window
            let window_clone = window.clone();
            tauri::async_runtime::spawn(async move {
                let mut is_over = false;
                loop {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    
                    let cursor_pos = match window_clone.app_handle().cursor_position() {
                        Ok(pos) => pos,
                        Err(_) => continue,
                    };

                    let win_pos = match window_clone.outer_position() {
                        Ok(pos) => pos,
                        Err(_) => continue,
                    };

                    let win_size = match window_clone.outer_size() {
                        Ok(size) => size,
                        Err(_) => continue,
                    };

                    let x_over = cursor_pos.x >= win_pos.x as f64 && cursor_pos.x <= (win_pos.x as f64 + win_size.width as f64);
                    let y_over = cursor_pos.y >= win_pos.y as f64 && cursor_pos.y <= (win_pos.y as f64 + win_size.height as f64);
                    
                    let currently_over = x_over && y_over;

                    if currently_over != is_over {
                        is_over = currently_over;
                        if is_over {
                            let _ = window_clone.emit("mouse-enter", ());
                        } else {
                            let _ = window_clone.emit("mouse-leave", ());
                        }
                    }
                }
            });

            /* 
            #[cfg(target_os = "macos")]
            apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
                .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
            */

            // Tray setup
            let tray_menu = tauri::menu::Menu::with_items(app, &[
                &tauri::menu::MenuItem::with_id(app, "show", "Show", true, None::<&str>)?,
                &tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
            ])?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .on_menu_event(|app: &tauri::AppHandle, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        let window = app.get_webview_window("main").unwrap();
                        window.show().unwrap();
                        window.set_focus().unwrap();
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, get_cursor_position])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
