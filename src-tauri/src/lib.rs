#[cfg(target_os = "windows")]
use std::sync::atomic::Ordering;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[cfg(target_os = "windows")]
use {
    tauri::raw_window_handle::{HasWindowHandle, RawWindowHandle},
    window_vibrancy::apply_acrylic,
    windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_STYLE, WS_THICKFRAME,
    },
};

/// Clears WS_THICKFRAME from the window style so Windows Snap Assist (AeroSnap)
/// treats FlowPane as non-resizable from OS perspective and won't intercept edge drags.
#[cfg(target_os = "windows")]
fn suppress_aero_snap(window: &WebviewWindow) {
    if let Ok(handle) = window.window_handle() {
        if let RawWindowHandle::Win32(h) = handle.as_raw() {
            let hwnd = h.hwnd.get() as isize;
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_THICKFRAME as isize));
            }
        }
    }
}

const APP_WINDOW_WIDTH: f64 = 335.0;
const APP_WINDOW_HEIGHT: f64 = 405.0;
const NEW_WINDOW_OFFSET: i32 = 32;
const MIN_WINDOW_SPAWN_INTERVAL: Duration = Duration::from_millis(700);
const MAX_APP_WINDOWS: usize = 8;

#[derive(Default)]
struct WindowSpawnLimiter {
    last_spawn: Mutex<Option<Instant>>,
}

#[derive(Default)]
struct HoverTrackerState {
    hovered_label: Mutex<Option<String>>,
    active_label: Mutex<Option<String>>,
    app_window_order: Mutex<Vec<String>>,
    // Milliseconds since UNIX_EPOCH of the last window-move event (Windows only).
    // Written by notify_window_moved IPC; read by hover tracker to skip polls
    // during high-frequency drag events and avoid CPU contention with AeroSnap.
    #[allow(dead_code)]
    last_move_ms: Arc<AtomicU64>,
}

fn is_app_window_label(label: &str) -> bool {
    label == "main" || label.starts_with("flowpane-")
}

fn app_window_count(app: &AppHandle) -> usize {
    app.webview_windows()
        .keys()
        .filter(|label| is_app_window_label(label))
        .count()
}

fn remember_app_window_order(state: &HoverTrackerState, label: &str) -> Result<(), String> {
    if !is_app_window_label(label) {
        return Ok(());
    }

    let mut order = state.app_window_order.lock().map_err(|e| e.to_string())?;
    order.retain(|existing_label| existing_label != label);
    order.push(label.to_string());
    Ok(())
}

fn set_active_app_window(
    app: &AppHandle,
    state: &HoverTrackerState,
    label: &str,
) -> Result<(), String> {
    if !is_app_window_label(label) {
        return Ok(());
    }

    remember_app_window_order(state, label)?;

    {
        let mut active_label = state.active_label.lock().map_err(|e| e.to_string())?;
        if active_label.as_deref() == Some(label) {
            return Ok(());
        }
        *active_label = Some(label.to_string());
    }

    for (window_label, window) in app.webview_windows() {
        if is_app_window_label(&window_label) {
            let _ = window.emit("app-window-active-changed", label.to_string());
        }
    }

    Ok(())
}

fn app_window_under_cursor(
    app: &AppHandle,
    state: &HoverTrackerState,
) -> Option<(String, WebviewWindow)> {
    let cursor_pos = app.cursor_position().ok()?;
    let windows = app.webview_windows();
    let order = state.app_window_order.lock().ok()?;

    order.iter().rev().find_map(|label| {
        let window = windows.get(label)?;
        let win_pos = window.outer_position().ok()?;
        let win_size = window.outer_size().ok()?;

        let x_over = cursor_pos.x >= win_pos.x as f64
            && cursor_pos.x <= (win_pos.x as f64 + win_size.width as f64);
        let y_over = cursor_pos.y >= win_pos.y as f64
            && cursor_pos.y <= (win_pos.y as f64 + win_size.height as f64);

        (x_over && y_over).then(|| (label.clone(), window.clone()))
    })
}

fn spawn_hover_tracker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<HoverTrackerState>();
        #[cfg(target_os = "windows")]
        let last_move_ms = Arc::clone(&state.last_move_ms);

        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;

            // Windows: skip this poll cycle when a move event arrived < 100ms ago.
            // Prevents the hover tracker from racing with AeroSnap during drags.
            #[cfg(target_os = "windows")]
            {
                let now_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let moved_ms = last_move_ms.load(Ordering::Relaxed);
                if moved_ms > 0 && now_ms.saturating_sub(moved_ms) < 100 {
                    continue;
                }
            }

            let hovered_window = app_window_under_cursor(&app, &state);
            let hovered_label = hovered_window.as_ref().map(|(label, _)| label.clone());
            let hover_payload = hovered_label.clone().unwrap_or_default();
            let previous_label = {
                let mut previous = match state.hovered_label.lock() {
                    Ok(previous) => previous,
                    Err(_) => continue,
                };

                if *previous == hovered_label {
                    continue;
                }

                std::mem::replace(&mut *previous, hovered_label)
            };

            if let Some(previous_label) = previous_label {
                if let Some(previous_window) = app.get_webview_window(&previous_label) {
                    let _ = previous_window.emit("mouse-leave", ());
                }
            }

            for (window_label, window) in app.webview_windows() {
                if is_app_window_label(&window_label) {
                    let _ = window.emit("app-window-hover-changed", hover_payload.clone());
                }
            }

            if let Some((_, hovered_window)) = hovered_window {
                let _ = hovered_window.emit("mouse-enter", ());
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

/// Called by JS `onMoved` on Windows to stamp when the last move event fired.
/// The hover tracker uses this to skip poll cycles during active drags.
#[tauri::command]
fn notify_window_moved(#[allow(unused_variables)] hover_state: State<HoverTrackerState>) {
    #[cfg(target_os = "windows")]
    {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        hover_state.last_move_ms.store(now_ms, Ordering::Relaxed);
    }
}

#[tauri::command]
fn create_app_window(
    app: AppHandle,
    window: WebviewWindow,
    limiter: tauri::State<WindowSpawnLimiter>,
    hover_state: State<HoverTrackerState>,
) -> Result<Option<String>, String> {
    if app_window_count(&app) >= MAX_APP_WINDOWS {
        return Ok(None);
    }

    {
        let mut last_spawn = limiter.last_spawn.lock().map_err(|e| e.to_string())?;
        let now = Instant::now();

        if last_spawn.is_some_and(|last| now.duration_since(last) < MIN_WINDOW_SPAWN_INTERVAL) {
            return Ok(None);
        }

        *last_spawn = Some(now);
    }

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
    remember_app_window_order(&hover_state, &label)?;

    #[cfg(target_os = "windows")]
    suppress_aero_snap(&new_window);

    Ok(Some(label))
}

#[tauri::command]
fn mark_app_window_active(
    app: AppHandle,
    window: WebviewWindow,
    hover_state: State<HoverTrackerState>,
) -> Result<(), String> {
    set_active_app_window(&app, &hover_state, window.label())
}

#[tauri::command]
fn close_app_window(app: AppHandle, window: WebviewWindow) -> Result<bool, String> {
    if !is_app_window_label(window.label()) || app_window_count(&app) <= 1 {
        return Ok(false);
    }

    window.close().map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(WindowSpawnLimiter::default())
        .manage(HoverTrackerState::default())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let hover_state = app.state::<HoverTrackerState>();
            remember_app_window_order(&hover_state, window.label())?;

            // Windows: remove WS_THICKFRAME to suppress AeroSnap (Windows Snap Assist).
            // FlowPane manages its own edge-snap; letting the OS also snap creates a
            // feedback loop between onMoved events and the AeroSnap position/resize that
            // spikes CPU. decorations:false removes the caption but not WS_THICKFRAME on
            // all WebView2 versions, so we clear it explicitly.
            #[cfg(target_os = "windows")]
            suppress_aero_snap(&window);

            // WINDOWS-COMPAT: transparent:true alone gives opaque white on WebView2.
            // apply_acrylic enables DWM composition so the glass blur is visible.
            // None = let the system pick the tint colour; works on Win10 and Win11.
            #[cfg(target_os = "windows")]
            let _ = apply_acrylic(&window, None);

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
            #[cfg(target_os = "windows")]
            let _ = apply_acrylic(&bubble_window, None);
            let _ = bubble_window.set_ignore_cursor_events(true);

            // Background task to track mouse hover for inactive windows.
            spawn_hover_tracker(app.handle().clone());

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
                        if let Some(window) = app
                            .webview_windows()
                            .into_iter()
                            .find_map(|(label, window)| is_app_window_label(&label).then_some(window))
                        {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            show_eye_bubble_overlay,
            hide_eye_bubble_overlay,
            get_app_version,
            notify_window_moved,
            create_app_window,
            mark_app_window_active,
            close_app_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
