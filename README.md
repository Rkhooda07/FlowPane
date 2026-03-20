# FlowPane

FlowPane is a lightweight desktop task manager built with Tauri. It is designed as a frameless, always-on-top floating pane with fast task capture, edge snapping/collapsing, and a focus mode timer.

## Current Features

- Frameless transparent window with custom window controls
- Drag-to-edge behavior with snap and collapse/peek interactions
- Task list with:
  - quick add
  - due date/time input mask
  - quick time presets (`+15m`, `+30m`, `+1h`)
  - complete, delete, overdue state, and urgency highlighting
- Focus mode with:
  - active task display
  - stopwatch/countdown timer
  - quick timer settings modal
  - motivational quotes
- System tray integration (`Show`, `Quit`)
- Persistent task storage via Tauri Store plugin (with localStorage fallback)

## Tech Stack

- Desktop runtime: Tauri v2
- Frontend: Vanilla HTML, CSS, JavaScript (no framework)
- Backend/runtime logic: Rust
- Storage: `@tauri-apps/plugin-store` + `tauri-plugin-store`
- Window effects support: `window-vibrancy` (currently prepared in Rust code)

## Architecture Notes

- Frontend is loaded directly from `src/` (`frontendDist: "../src"`).
- Tauri APIs are accessed from JS through `window.__TAURI__` (`withGlobalTauri: true`).
- The app uses a polling loop in Rust to detect mouse-over transitions and emits `mouse-enter` / `mouse-leave` events to the frontend.
- Window sizing constants are shared conceptually between JS logic and CSS states; keep them consistent when editing collapse/peek behavior.

## Project Structure

```text
FlowPane/
├── src/
│   ├── index.html        # App layout and UI structure
│   ├── main.js           # App logic (tasks, focus mode, window behavior)
│   ├── styles.css        # Visual design and interaction states
│   └── assets/           # Static assets
├── src-tauri/
│   ├── src/
│   │   ├── main.rs       # Rust binary entry
│   │   └── lib.rs        # Tauri builder, tray, event bridge
│   ├── tauri.conf.json   # Window/bundle config
│   ├── capabilities/
│   │   └── default.json  # Allowed API permissions
│   └── Cargo.toml        # Rust dependencies/config
├── package.json
└── README.md
```

## Prerequisites

Install the standard Tauri prerequisites for your OS:

- Node.js + npm
- Rust toolchain (`rustup`, `cargo`)
- Platform-specific Tauri build dependencies

Reference: https://v2.tauri.app/start/prerequisites/

## Getting Started

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Available npm Script

- `npm run tauri` - forwards args to the Tauri CLI

Examples:

```bash
npm run tauri dev
npm run tauri build
```

## Configuration

Key desktop settings are in `src-tauri/tauri.conf.json`:

- frameless (`decorations: false`)
- transparent (`transparent: true`)
- always on top (`alwaysOnTop: true`)
- initial window size `325x375`

## Notes

- App/window branding in UI uses `FlowPane`, while package metadata still includes template naming (`tauri-app`).
- The current README documents the present codebase behavior; add roadmap items separately to avoid mixing planned vs implemented features.
