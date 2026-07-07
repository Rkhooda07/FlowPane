# Onboarding Experience Design Spec

This document outlines the design and implementation details for the additive first-run onboarding experience in FlowPane.

## Features

1. **Welcome Screen**: A glassmorphic centered modal card that introduces the app and offers to start the tour or skip it.
2. **Guided Tour**: A sequence of 10 targeted tooltips with pointers (arrows) highlighting key UI features.
3. **Spotlight Effect**: Active elements are visually spotlighted by a dimming backdrop overlay with a clear cutout matching the element's position and border-radius.
4. **Replay Ability**: An option in the right-click context menu allowing users to replay the guide at any time.

## Tour Steps Sequence

| Step | Index | Selector | Description / Copy |
| :--- | :--- | :--- | :--- |
| **Welcome** | 0 | None (Centered) | "Welcome to FlowPane! Your translucent, always-on-top companion designed to keep you in your flow state. Let's take a quick 1-minute tour." |
| **Eyes Logo** | 1 | `.window-controls` | "FlowPane floats above your other windows. These eyes track your cursor to keep your focus centered!" |
| **Drag Snap** | 2 | `.fold-guide` | "Drag the pane to screen edges to snap and collapse it into a minimal floating indicator." |
| **Task Input** | 3 | `#task-input` | "Type a task description or note title here, then press Enter to quickly add it." |
| **Due Date** | 4 | `#task-due-date-btn` | "Click the calendar to set a deadline or due date for the task you are adding." |
| **Reminders** | 5 | `#task-reminder-btn` | "Schedule a reminder notification to alert you before your task deadline." (Triggers temporary expand of `.input-area`) |
| **Timer** | 6 | `#task-timer-btn` | "Set a focus duration to launch a Pomodoro-style timer in Focus Mode." |
| **Note Colors** | 7 | `.task-notes-icons` | "Select a color tab to create separate, color-coded workspaces for notes." |
| **Filter Icon** | 8 | `.filter-icon` | "Click this funnel to toggle the visibility of the filter controls." |
| **Filter Pills** | 9 | `.filter-options` | "Switch between viewing everything, just active tasks, or note pages." (Triggers temporary reveal of `.filter-options`) |
| **History** | 10 | `#history-btn` | "Open the completed tasks history to review your finished items or restore them." |
| **Finish** | 11 | `#task-input` | "You're all set! Start typing your first task above to begin." |

## Technical Implementation Details

### HTML & CSS Additions
- **Markup**: Placed statically at the bottom of the body in `index.html`. Uses `#onboarding-overlay` as the root container.
- **Backdrop & Highlight**: Uses a massive, non-interactive `box-shadow` on a dynamically positioned `.onboarding-highlight-box` to create a viewport-wide dimming effect with a clear cutout matching the targeted element.
- **Pointer-events**: The root overlay, backdrop, and highlight box use `pointer-events: none` to avoid interfering with native title bar dragging or background clicks. The welcome card and tooltip boxes use `pointer-events: auto` to allow button interactions.

### Javascript Tour Engine
- **Persistence**: Checked and saved under the key `hasSeenOnboarding` in Tauri's native JSON store, falling back to `localStorage` if needed.
- **Dynamic Positioning**: A layout calculation retrieves the bounding rectangle of the target element, chooses vertical placement (above/below) based on screen position, clamps horizontal coordinates within the 325x395 bounds, and aligns the arrow caret.
- **Interactive States Cleanups**: 
  - On Step 5 exit, if the input area was expanded by the guide, it is collapsed back.
  - On Step 9 exit, if the filter options were revealed by the guide, they are hidden back.
  - Cleanup is executed on both "Next" transitions and immediate "Skip Guide" triggers.
