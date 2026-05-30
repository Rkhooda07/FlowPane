use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const APP_WINDOW_WIDTH: f64 = 325.0;
const APP_WINDOW_HEIGHT: f64 = 395.0;
const NEW_WINDOW_OFFSET: i32 = 32;

fn spawn_hover_tracker(window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let mut is_over = false;
        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;

            let cursor_pos = match window.app_handle().cursor_position() {
                Ok(pos) => pos,
                Err(_) => continue,
            };

            let win_pos = match window.outer_position() {
                Ok(pos) => pos,
                Err(_) => break,
            };

            let win_size = match window.outer_size() {
                Ok(size) => size,
                Err(_) => break,
            };

            let x_over = cursor_pos.x >= win_pos.x as f64
                && cursor_pos.x <= (win_pos.x as f64 + win_size.width as f64);
            let y_over = cursor_pos.y >= win_pos.y as f64
                && cursor_pos.y <= (win_pos.y as f64 + win_size.height as f64);
            let currently_over = x_over && y_over;

            if currently_over != is_over {
                is_over = currently_over;
                let _ = window.emit(
                    if is_over {
                        "mouse-enter"
                    } else {
                        "mouse-leave"
                    },
                    (),
                );
            }
        }
    });
}

fn next_app_window_label(app: &AppHandle) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut label = format!("flowpane-{millis}");
    let mut suffix = 1;

    while app.get_webview_window(&label).is_some() {
        label = format!("flowpane-{millis}-{suffix}");
        suffix += 1;
    }

    label
}

fn offset_window_position(source_window: &WebviewWindow) -> PhysicalPosition<i32> {
    let source_pos = source_window
        .outer_position()
        .unwrap_or_else(|_| PhysicalPosition::new(80, 80));
    let mut x = source_pos.x + NEW_WINDOW_OFFSET;
    let mut y = source_pos.y + NEW_WINDOW_OFFSET;

    if let Ok(Some(monitor)) = source_window.current_monitor() {
        let work_area = monitor.work_area();
        let min_x = work_area.position.x + 12;
        let min_y = work_area.position.y + 12;
        let max_x =
            work_area.position.x + work_area.size.width as i32 - APP_WINDOW_WIDTH as i32 - 12;
        let max_y =
            work_area.position.y + work_area.size.height as i32 - APP_WINDOW_HEIGHT as i32 - 12;

        if max_x >= min_x {
            x = x.clamp(min_x, max_x);
            if x == max_x && source_pos.x >= max_x - NEW_WINDOW_OFFSET {
                x = min_x;
            }
        }

        if max_y >= min_y {
            y = y.clamp(min_y, max_y);
            if y == max_y && source_pos.y >= max_y - NEW_WINDOW_OFFSET {
                y = min_y;
            }
        }
    }

    PhysicalPosition::new(x, y)
}

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

#[tauri::command]
fn create_app_window(app: AppHandle, window: WebviewWindow) -> Result<String, String> {
    let label = next_app_window_label(&app);
    let position = offset_window_position(&window);
    let scale_factor = window.scale_factor().unwrap_or(1.0);

    let new_window =
        WebviewWindowBuilder::new(&app, label.as_str(), WebviewUrl::App("index.html".into()))
            .title("FlowPane")
            .inner_size(APP_WINDOW_WIDTH, APP_WINDOW_HEIGHT)
            .min_inner_size(APP_WINDOW_WIDTH, APP_WINDOW_HEIGHT)
            .resizable(true)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .shadow(false)
            .accept_first_mouse(true)
            .position(
                position.x as f64 / scale_factor,
                position.y as f64 / scale_factor,
            )
            .prevent_overflow()
            .build()
            .map_err(|e| e.to_string())?;

    let _ = new_window.set_focus();
    spawn_hover_tracker(new_window);

    Ok(label)
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

            // Background task to track mouse hover for inactive windows.
            spawn_hover_tracker(window.clone());

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
            get_app_version,
            create_app_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
