const { LogicalSize } = window.__TAURI__.window;

export const ALL_WINDOWS_SIZE = new LogicalSize(335, 385);
export const PEEK_SIZE_Y = new LogicalSize(335, 280);
export const PEEK_SIZE_X = new LogicalSize(280, 335);
export const COLLAPSED_SIZE_Y = new LogicalSize(335, 42); // Match CSS height for bar
export const COLLAPSED_REMINDER_SIZE_Y = new LogicalSize(335, 112);
export const COLLAPSED_SIZE_X = new LogicalSize(42, 310); // Match CSS dimensions
export const COLLAPSED_SIZE_Y_BUBBLE = new LogicalSize(335, 180);
export const COLLAPSED_SIZE_X_BUBBLE = new LogicalSize(310, 310);
export const SIDE_NOTIFICATION_BUBBLE_DURATION_MS = 12000;
export const BOTTOM_DOCK_MINIMIZE_THRESHOLD = 0;
export const HOVER_PEEK_DELAY_MS = 150;
export const HOVER_PEEK_RETRY_MS = 80;
export const MANUAL_DRAG_EXPAND_DURATION_MS = 420;
export const NATIVE_EDGE_SNAP_THRESHOLD = 14;
export const NATIVE_SIDE_SNAP_MIN_WIDTH_RATIO = 0.42;
export const NATIVE_TOP_SNAP_MIN_WIDTH_RATIO = 0.9;
export const NATIVE_EDGE_SNAP_MIN_HEIGHT_RATIO = 0.72;
export const DRAG_GESTURE_IDLE_END_MS = 120;

export const SNAP_THRESHOLD = 30;

export const DUE_BLOCKS = [
  { start: 0, end: 2, type: 'day', length: 2 },
  { start: 3, end: 5, type: 'month', length: 2 },
  { start: 6, end: 10, type: 'year', length: 4 },
  { start: 12, end: 14, type: 'hour', length: 2 },
  { start: 15, end: 17, type: 'minute', length: 2 },
  { start: 18, end: 20, type: 'period', length: 2 }
];

export const quotes = [
  "Flow with the moment, focus on the task.",
  "Your focus determines your reality.",
  "One task at a time, one step closer.",
  "Stay in the flow, the rest will follow.",
  "Focus is the art of knowing what to ignore.",
  "Deep work is the superpower of the 21st century.",
  "The secret to getting ahead is getting started.",
  "Don't stop until you're proud.",
  "Small steps lead to big results.",
  "Flow is the state of effortless action."
];

export const congratsMessages = [
  "Great focus. Keep this momentum going.",
  "One step closer to your goals. Well done.",
  "Consistent effort pays off. Take a moment to appreciate your work.",
  "Task completed successfully. You're doing great.",
  "Outstanding focus session. Ready for the next challenge?",
  "Consistency is key. Excellent job staying on track.",
  "Progress is made one task at a time. Keep it up."
];
