use std::time::Duration;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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

#[tauri::command]
fn show_eye_bubble_overlay(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let window = app
        .get_webview_window("eye-bubble")
        .ok_or_else(|| "Eye bubble overlay window not found".to_string())?;

    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_focusable(false);
    let _ = window.set_always_on_top(true);
    window.show().map_err(|e| e.to_string())?;
    window
        .emit("eye-bubble:show", ())
        .map_err(|e| e.to_string())?;
    let _ = window.eval("window.showEyeBubbleFromHost && window.showEyeBubbleFromHost()");

    Ok(())
}

#[tauri::command]
fn hide_eye_bubble_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("eye-bubble") {
        let _ = window.emit("eye-bubble:hide", ());
        let _ = window.eval("window.hideEyeBubbleFromHost && window.hideEyeBubbleFromHost()");
        window.hide().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            // Onboarding check could also be done here or in frontend
            
            let bubble_window = WebviewWindowBuilder::new(
                app,
                "eye-bubble",
                WebviewUrl::App("bubble.html".into()),
            )
            .title("FlowPane Bubble")
            .inner_size(300.0, 300.0)
            .min_inner_size(300.0, 300.0)
            .max_inner_size(300.0, 300.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focusable(false)
            .visible(false)
            .build()?;
            let _ = bubble_window.set_ignore_cursor_events(true);

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

            #[cfg(target_os = "linux")]
            {
                // Simple check for compositor on Linux
                let has_compositor = std::env::var("XDG_CURRENT_DESKTOP").is_ok() || 
                                     std::env::var("WAYLAND_DISPLAY").is_ok();
                if !has_compositor {
                    eprintln!("Warning: No compositor detected on Linux. Transparency may not work as expected.");
                }
            }

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
        .invoke_handler(tauri::generate_handler![
            greet,
            get_cursor_position,
            show_eye_bubble_overlay,
            hide_eye_bubble_overlay,
            get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
