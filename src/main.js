const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();

// Window controls
document.getElementById('minimize-btn').addEventListener('click', () => {
  // We'll implement collapse logic later, for now just use standard minimize
  appWindow.minimize();
});

document.getElementById('close-btn').addEventListener('click', () => {
  appWindow.close();
});

// Drag region handled by data-tauri-drag-region in HTML

// UI Interactions
document.getElementById('add-task-btn').addEventListener('click', () => {
  console.log('Add task clicked');
  // TODO: Show add task modal/input
});

// Initialize
console.log('FlowPane initialized');
