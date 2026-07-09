# FlowPane — File Structure Refactor Design

**Date:** 2026-07-09  
**Scope:** Pure structural reorganization. Zero behavior, logic, styling, or functionality changes.

---

## Prime Directive

The app must behave identically after this refactor. No variable may be renamed. No logic may be reordered. No CSS rule may be removed or altered. Every file must be properly linked/imported. `bubble.html` is out of scope — do not touch it.

**Forbidden:**
- Renaming any variable, function, constant, or CSS class
- Rewriting, simplifying, or "cleaning up" any logic
- Changing CSS values, selectors, or rule order within a file
- Adding/removing/modifying HTML attributes, IDs, or class names
- New dependencies, build tools, bundlers, or transpilers
- Converting `var` to `const/let` or ES syntax upgrades
- Touching `src-tauri/` directory
- Splitting a JS module if doing so requires passing shared state through parameters that didn't exist before

---

## Problem

Three monolithic files: `src/index.html` (559 lines), `src/main.js` (4510 lines), `src/styles.css` (4601 lines). Hard to navigate; no logical grouping.

---

## Target File Structure

```
src/
├── index.html              ← one change only: script src="/js/main.js"
├── styles.css              ← 16 @import lines + eye-bubble CSS inline
├── bubble.html             ← untouched
├── css/
│   ├── variables.css
│   ├── reset.css
│   ├── collapsed.css
│   ├── titlebar.css
│   ├── input.css
│   ├── notes.css
│   ├── tasks.css
│   ├── focus-mode.css
│   ├── history.css
│   ├── modals.css
│   ├── reminder-popup.css
│   ├── context-menu.css
│   ├── resize-handles.css
│   ├── stars.css
│   ├── task-timer.css
│   └── onboarding.css
└── js/
    ├── constants.js
    ├── utils.js
    ├── audio.js
    └── main.js
```

---

## CSS Split

### Import order in `styles.css`

The import order mirrors the original cascade order exactly to prevent any specificity changes.

```css
@import 'css/variables.css';
@import 'css/reset.css';
@import 'css/collapsed.css';
@import 'css/titlebar.css';
@import 'css/input.css';
@import 'css/notes.css';
@import 'css/tasks.css';
@import 'css/focus-mode.css';
@import 'css/history.css';
@import 'css/modals.css';
@import 'css/reminder-popup.css';
@import 'css/context-menu.css';
@import 'css/resize-handles.css';
@import 'css/stars.css';
@import 'css/task-timer.css';
@import 'css/onboarding.css';

/* Eye bubble — stays inline in styles.css */
.eye-bubble.v3 { ... }
...
```

### CSS partial contents

| File | Contents |
|---|---|
| `variables.css` | `:root` CSS custom properties, light-mode `:root` overrides, star color vars + light-mode star overrides |
| `reset.css` | `*` reset, `html`, `body`, `#app` base + glassmorphism |
| `collapsed.css` | `.collapsed-y`/`.collapsed-x` states, peek classes, side notification, collapsed times-up ICE alert (all alarm/vibrate/glow keyframes), `#island-info-main`/`#island-info-complete` |
| `titlebar.css` | `.title-bar`, navbar, window controls, googly-eyes, fold guide, action controls, navbar timer |
| `input.css` | `.input-area`, `.task-input-shell`, due input, reminder dropdown, unit selector |
| `notes.css` | Note tabs (note-1–4), notes workspace, all 4 theme variable overrides (`#app.theme-1` through `#app.theme-4`) |
| `tasks.css` | `.task-container`, `.task-list`, `.task-item`, `.delete-task-btn`, `.urgent` + pulse keyframe |
| `focus-mode.css` | `.focus-mode`, `.focus-header-bar`, `.focus-content`, `.focus-timer`, `.focus-quote`, `.focus-bottom-controls`, `.round-btn`, `.timer-modal`, all focus entry/exit keyframes |
| `history.css` | `.history-workspace`, `.history-header`, `.history-back-btn`, `.clear-history-btn`, trash bin animations (wiggle/shake/lid/swallow keyframes), `.history-item`, `.history-empty-state` |
| `modals.css` | `.congrats-modal` + float keyframe, `.delete-confirm-card`, `.modal-overlay`, `.resume-card`, `.times-up-card`, restore modal, `.about-card` |
| `reminder-popup.css` | `.reminder-popup`, `.reminder-popup-card`, collapsed-y reminder reveal states, light-mode reminder overrides |
| `context-menu.css` | `.context-menu`, `.context-item`, `.context-divider` |
| `resize-handles.css` | `.resize-handle.*` (n/s/e/w/nw/ne/sw/se) |
| `stars.css` | `.navbar-stars-container`, `::before` static stars, `@keyframes pulse-sky`, `.star`, `.star-1`–`.star-8`, `@keyframes shoot-diag-a/b` |
| `task-timer.css` | `.task-timer-card`, unit selector inside card, `.task-timer-modal` |
| `onboarding.css` | `.onboarding-overlay`, `.onboarding-backdrop`, `.onboarding-welcome-card`, `.onboarding-highlight-box`, `.onboarding-tooltip`, `.onboarding-cursor-tooltip`, `.onboarding-arrow`, all onboarding keyframes |

**Rule:** Each file owns its own `@keyframes`. No shared animations file — component-specific keyframes stay co-located with the rules that use them.

**Eye-bubble exception:** The `.eye-bubble.v3` rules (and all orientation overrides for `#app.collapsed-y`/`#app.collapsed-x`) stay inline in `styles.css` after the last `@import`, not in a css/ partial.

---

## JS Split

### Why splitting is constrained

`main.js` uses ~35 variables that get reassigned (not just mutated): `isAnimating`, `isPeeking`, `tasks`, `currentFocusTask`, `focusSeconds`, `activeNoteId`, etc. ES module imported bindings are read-only — reassigning an imported primitive binding throws `TypeError`. Any function that _writes_ to a shared mutable variable must live in the same module scope as its declaration.

This means JS splitting is limited to extracting things with **zero shared mutable state dependencies**.

### Module dependency graph (no cycles)

```
constants.js  ←── utils.js
                      ↑
audio.js  ────────────┤
                      ↓
                   main.js
```

### `js/constants.js`

Exports all named constants. Zero logic.

- `DUE_BLOCKS` — array of `{ type, start, end, length }` objects for the masked date input
- `quotes` — motivational quotes array used in focus mode
- `congratsMessages` — congrats screen messages array
- Window size objects (using `window.__TAURI__.window.LogicalSize` / `PhysicalSize`): `ALL_WINDOWS_SIZE`, `PEEK_SIZE_Y`, `PEEK_SIZE_X`, `COLLAPSED_SIZE_Y`, `COLLAPSED_REMINDER_SIZE_Y`, `COLLAPSED_SIZE_X`, `COLLAPSED_SIZE_Y_BUBBLE`, `COLLAPSED_SIZE_X_BUBBLE`
- Numeric thresholds: `HOVER_PEEK_DELAY_MS`, `NATIVE_EDGE_SNAP_THRESHOLD`, `DRAG_GESTURE_IDLE_END_MS`, `MANUAL_DRAG_EXPAND_DURATION_MS`, `SIDE_NOTIFICATION_BUBBLE_DURATION_MS`, `SNAP_THRESHOLD`

### `js/utils.js`

Imports `DUE_BLOCKS` from `constants.js`. Exports pure functions only (no shared state reads or writes, no DOM access).

| Function | Notes |
|---|---|
| `clamp(value, min, max)` | pure math |
| `parseMaskedDate(str)` | parses `DD/MM/YYYY, HH:MM AM/PM` |
| `formatDateTimeHuman(date)` | formats Date → masked string |
| `normalizeDueInputValue(value, opts)` | calls parseMaskedDate + formatDateTimeHuman |
| `normalizeDueBlockValue(type, rawValue, fullValue)` | clamps individual date blocks |
| `getDueBlockFromSelection(cursor, selectionEnd)` | looks up block from DUE_BLOCKS |
| `setDueBlockValue(value, block, nextBlockValue)` | string splice |
| `formatDueBlockForEditing(block, rawValue)` | zero-pad raw string |
| `capitalizeFirstLetter(str)` | pure string |
| `tokenizeBubbleHTML(fullHTML)` | split on `<br>` tokens |
| `renderBubbleTokens(tokens, count)` | slice + join |

Note: `selectNextDueBlock()` and `commitActiveDueBlockEdit()` are NOT extracted — they call `setDueSelection()` and read/write `activeDueBlockEdit` (shared mutable state).

### `js/audio.js`

No imports. Exports Audio objects (declared `const`, never reassigned) and all sound-playing functions.

**Exports:**
- `reminderTone`, `collapseExpandTone`, `taskCreateTone`, `taskActivationTone`, `taskDeleteTone`, `fallbackDeleteTone`, `timesUpTone`
- `playReminderSound()`, `playCollapseExpandSound()`, `playTaskCreateSound()`, `playTaskActivationSound()`, `playTaskDeleteSound()`, `playFallbackDeleteSound()`, `playTimesUpSound()`
- `playVictorySound()` — uses AudioContext directly (no shared state)

### `js/main.js`

Three import lines added at the top. All existing code below the imports is **unchanged** — same variable names, same function bodies, same ordering.

```js
import { DUE_BLOCKS, quotes, congratsMessages, ALL_WINDOWS_SIZE, PEEK_SIZE_Y, PEEK_SIZE_X, COLLAPSED_SIZE_Y, COLLAPSED_REMINDER_SIZE_Y, COLLAPSED_SIZE_X, COLLAPSED_SIZE_Y_BUBBLE, COLLAPSED_SIZE_X_BUBBLE, HOVER_PEEK_DELAY_MS, NATIVE_EDGE_SNAP_THRESHOLD, DRAG_GESTURE_IDLE_END_MS, MANUAL_DRAG_EXPAND_DURATION_MS, SIDE_NOTIFICATION_BUBBLE_DURATION_MS, SNAP_THRESHOLD } from './constants.js';
import { clamp, parseMaskedDate, formatDateTimeHuman, normalizeDueInputValue, normalizeDueBlockValue, getDueBlockFromSelection, setDueBlockValue, formatDueBlockForEditing, capitalizeFirstLetter, tokenizeBubbleHTML, renderBubbleTokens } from './utils.js';
import { reminderTone, collapseExpandTone, taskCreateTone, taskActivationTone, taskDeleteTone, fallbackDeleteTone, timesUpTone, playReminderSound, playCollapseExpandSound, playTaskCreateSound, playTaskActivationSound, playTaskDeleteSound, playFallbackDeleteSound, playTimesUpSound, playVictorySound } from './audio.js';
```

Everything else in `main.js` is moved from the original `src/main.js` verbatim (minus the lines now in the three extracted modules).

---

## `index.html` change

The only change to `index.html`:

```html
<!-- before -->
<script type="module" src="/main.js"></script>

<!-- after -->
<script type="module" src="/js/main.js"></script>
```

The `<link rel="stylesheet" href="styles.css" />` in `<head>` is unchanged — `styles.css` stays at the same path.

---

## Verification checklist (post-implementation)

- [ ] `npm run tauri dev` launches without console errors
- [ ] Tasks can be created, completed, and deleted
- [ ] Focus mode enters and exits; timer counts; congrats modal appears
- [ ] Collapse-Y and collapse-X work; peek-on-hover works
- [ ] Notes open and close; note drafts persist across sessions
- [ ] Reminders fire; reminder popup appears in collapsed mode
- [ ] History view opens; clear history works
- [ ] Context menu appears on right-click
- [ ] Onboarding tour runs on first launch (clear `hasSeenOnboarding` from store to test)
- [ ] Eye bubble appears in collapsed mode
- [ ] All themes (1–4) apply correctly
- [ ] `npm run tauri build` completes without errors
