const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();

// State management
let tasks = JSON.parse(localStorage.getItem('tasks')) || [];

const appElement = document.getElementById('app');

const ALL_WINDOWS_SIZE = { width: 300, height: 500 };
const COLLAPSED_SIZE_Y = { width: 300, height: 28 }; // Match CSS height for bar
const COLLAPSED_SIZE_X = { width: 28, height: 140 }; // Match CSS dimensions

async function toggleCollapseY() {
  appElement.classList.remove('collapsed-x');
  const isCollapsed = appElement.classList.toggle('collapsed-y');

  if (isCollapsed) {
    setTimeout(async () => await appWindow.setSize(COLLAPSED_SIZE_Y), 50);
  } else {
    await appWindow.setSize(ALL_WINDOWS_SIZE);
  }
}

async function toggleCollapseX() {
  appElement.classList.remove('collapsed-y');
  const isCollapsed = appElement.classList.toggle('collapsed-x');

  if (isCollapsed) {
    setTimeout(async () => await appWindow.setSize(COLLAPSED_SIZE_X), 50);
  } else {
    await appWindow.setSize(ALL_WINDOWS_SIZE);
  }
}

// Window controls
document.getElementById('close-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  appWindow.close();
});

document.getElementById('minimize-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  isMinimizing = true;
  appWindow.minimize();
  // Reset after animation finishes
  setTimeout(() => { isMinimizing = false; }, 1000);
});

document.getElementById('maximize-btn').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (await appWindow.isMaximized()) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }
});

document.getElementById('fold-y-btn').addEventListener('click', async (e) => {
  e.stopPropagation();
  await toggleCollapseY();
});

document.getElementById('fold-x-btn').addEventListener('click', async (e) => {
  e.stopPropagation();
  await toggleCollapseX();
});

// Double click defaults to vertical collapse
document.querySelector('.title-bar').addEventListener('dblclick', async () => {
  await toggleCollapseY();
});

// No manual drag listener needed when using data-tauri-drag-region


// Task functions
function saveTasks() {
  localStorage.setItem('tasks', JSON.stringify(tasks));
}

function renderTasks() {
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';

  tasks.sort((a, b) => new Date(a.due) - new Date(b.due)).forEach((task, index) => {
    const li = document.createElement('li');
    li.className = `task-item ${task.urgent ? 'urgent' : ''} ${task.completed ? 'completed' : ''}`;

    const dueDate = new Date(task.due);
    const now = new Date();
    const isOverdue = dueDate < now && !task.completed;

    let dueText = '';
    if (task.completed) {
      dueText = 'Completed';
    } else {
      const diffMs = dueDate - now;
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHrs = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHrs / 24);

      if (diffMs < 0) dueText = 'Overdue';
      else if (diffDays > 0) dueText = `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
      else if (diffHrs > 0) dueText = `Due in ${diffHrs} hour${diffHrs > 1 ? 's' : ''}`;
      else if (diffMins > 0) dueText = `Due in ${diffMins} min${diffMins > 1 ? 's' : ''}`;
      else dueText = 'Due now';
    }

    li.innerHTML = `
      <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} />
      <div class="task-info">
        <div class="task-title">${task.title}</div>
        <div class="task-due">${dueText}</div>
      </div>
      <button class="delete-task-btn" title="Delete task">×</button>
    `;

    li.querySelector('.task-checkbox').addEventListener('change', (e) => {
      tasks[index].completed = e.target.checked;
      saveTasks();
      renderTasks();
    });

    li.querySelector('.delete-task-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      tasks.splice(index, 1);
      saveTasks();
      renderTasks();
    });

    // Right click to delete
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      tasks.splice(index, 1);
      saveTasks();
      renderTasks();
    });

    // Double click to enter focus mode
    li.addEventListener('dblclick', () => {
      enterFocusMode(task);
    });

    taskList.appendChild(li);
  });

  if (tasks.length === 0) {
    taskList.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 32px; margin-bottom: 10px; opacity: 0.3;">✨</div>
        <p>No tasks left!</p>
        <p style="font-size: 11px; opacity: 0.6; margin-top: 4px;">Time to flow into something new.</p>
      </div>
    `;
  }
}

// Event Listeners
const taskInput = document.getElementById('task-input');
const dueInput = document.getElementById('due-input');
const inputArea = document.querySelector('.input-area');

function getDefaultDueDate() {
  const date = new Date();
  date.setHours(date.getHours() + 1);
  return date;
}

// Initialize default date
dueInput.value = formatDateTimeHuman(getDefaultDueDate());

taskInput.addEventListener('focus', () => {
  inputArea.classList.add('expanded');
});

dueInput.addEventListener('focus', () => {
  // Select first block on focus
  setTimeout(() => dueInput.setSelectionRange(0, 2), 10);
});

inputArea.addEventListener('focusout', (e) => {
  setTimeout(() => {
    if (!inputArea.contains(document.activeElement) && !taskInput.value.trim()) {
      inputArea.classList.remove('expanded');
    }
  }, 100);
});

taskInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addTask();
    inputArea.classList.remove('expanded');
    taskInput.blur();
  }
});

dueInput.addEventListener('keydown', (e) => {
  // Navigation & special keys
  if (['ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Shift'].includes(e.key)) return;

  const cursor = dueInput.selectionStart;
  const val = dueInput.value;

  // Handle Backspace
  if (e.key === 'Backspace') {
    e.preventDefault();
    let pos = cursor - 1;
    // Skip separators backwards
    while (pos >= 0 && /[^\dAPM]/.test(val[pos])) {
      pos--;
    }
    if (pos >= 0) {
      if (/\d/.test(val[pos])) {
        dueInput.value = val.substring(0, pos) + '0' + val.substring(pos + 1);
      }
      dueInput.setSelectionRange(pos, pos);
    }
    return;
  }

  // Handle Numbers
  if (/\d/.test(e.key)) {
    e.preventDefault();
    let pos = cursor;
    // If it's on a separator, jump to next digit
    while (pos < 17 && /[^\d]/.test(val[pos])) {
      pos++;
    }
    if (pos < 17) {
      dueInput.value = val.substring(0, pos) + e.key + val.substring(pos + 1);
      let nextPos = pos + 1;
      // Skip separators for next cursor position
      while (nextPos < 17 && /[^\d]/.test(dueInput.value[nextPos])) {
        nextPos++;
      }
      dueInput.setSelectionRange(nextPos, nextPos);
    }
    return;
  }

  // Handle AM/PM
  if (/[apAP]/.test(e.key)) {
    e.preventDefault();
    const period = e.key.toUpperCase() === 'A' ? 'AM' : 'PM';
    dueInput.value = val.substring(0, 18) + period;
    dueInput.setSelectionRange(18, 20);
    return;
  }

  // Block all other keys (like letters or excess slashes)
  e.preventDefault();
});

// Simple click selection logic remains
dueInput.addEventListener('click', () => {
  const cursor = dueInput.selectionStart;
  const blocks = [[0, 2], [3, 5], [6, 10], [12, 14], [15, 17], [18, 20]];
  for (const [start, end] of blocks) {
    if (cursor >= start && cursor <= end) {
      dueInput.setSelectionRange(start, end);
      break;
    }
  }
});

// Auto-focus the next block on click
dueInput.addEventListener('click', () => {
  const cursor = dueInput.selectionStart;
  const blocks = [[0, 2], [3, 5], [6, 10], [12, 14], [15, 17]];
  for (const [start, end] of blocks) {
    if (cursor >= start && cursor <= end) {
      dueInput.setSelectionRange(start, end);
      break;
    }
  }
});

function parseMaskedDate(str) {
  // Format: DD/MM/YYYY, HH:MM AM/PM
  const regex = /(\d{2})\/(\d{2})\/(\d{4}),\s(\d{2}):(\d{2})\s(AM|PM)/;
  const match = str.match(regex);
  if (!match) return null;

  let [_, day, month, year, hour, min, period] = match;
  hour = parseInt(hour);
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;

  const date = new Date(year, month - 1, day, hour, min);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateTimeHuman(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  let h = date.getHours();
  const min = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const hh = String(h).padStart(2, '0');

  return `${d}/${m}/${y}, ${hh}:${min} ${ampm}`;
}

function addTask() {
  const titleInput = document.getElementById('task-input');
  const dueInput = document.getElementById('due-input');

  if (!titleInput.value.trim()) return;

  let dueDate = parseMaskedDate(dueInput.value);
  if (!dueDate) {
    dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    dueDate.setHours(12, 0, 0, 0);
  }

  const newTask = {
    title: titleInput.value.trim(),
    due: dueDate.toISOString(),
    completed: false,
    urgent: false
  };

  const diffHrs = (new Date(newTask.due) - new Date()) / (1000 * 60 * 60);
  if (diffHrs < 5) newTask.urgent = true;

  tasks.push(newTask);
  saveTasks();
  renderTasks();

  titleInput.value = '';

  // Reset date input to next default
  dueInput.value = formatDateTimeHuman(getDefaultDueDate());
}

// Resize logic
const dirMap = {
  n: 'Top',
  s: 'Bottom',
  e: 'Right',
  w: 'Left',
  nw: 'TopLeft',
  ne: 'TopRight',
  sw: 'BottomLeft',
  se: 'BottomRight'
};

Object.entries(dirMap).forEach(([dir, tauriDir]) => {
  const handle = document.querySelector(`.resize-handle.${dir}`);
  if (handle) {
    handle.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      await appWindow.startResizeDragging(tauriDir);
    });
  }
});

// Update countdowns every minute
setInterval(renderTasks, 60000);

// Edge Snapping Logic
const SNAP_THRESHOLD = 30;

// State for preventing snap during specific actions
let isMinimizing = false;

async function snapToEdges() {
  if (isMinimizing) return;

  const monitor = await appWindow.currentMonitor();
  if (!monitor) return;

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { width: scrW, height: scrH } = monitor.size;
  const { x: offsetX, y: offsetY } = monitor.position;

  let newX = winX;
  let newY = winY;

  // Horizontal Snapping
  if (Math.abs(winX - offsetX) < SNAP_THRESHOLD) newX = offsetX;
  else if (Math.abs(winX + winW - (offsetX + scrW)) < SNAP_THRESHOLD) newX = offsetX + scrW - winW;

  // Vertical Snapping
  if (Math.abs(winY - offsetY) < SNAP_THRESHOLD) newY = offsetY;
  else if (Math.abs(winY + winH - (offsetY + scrH)) < SNAP_THRESHOLD) newY = offsetY + scrH - winH;

  if (newX !== winX || newY !== winY) {
    await appWindow.setPosition({ x: newX, y: newY });
  }
}

// Listen for move events to trigger snapping
let moveTimeout;
appWindow.onMoved(() => {
  if (isMinimizing) return;
  clearTimeout(moveTimeout);
  moveTimeout = setTimeout(snapToEdges, 1000); // 1 second after stop to ensure no lag during drag
});

// Focus Mode Logic
let focusTimerInterval = null;
let focusSeconds = 0;
let currentFocusTask = null;

function enterFocusMode(task) {
  currentFocusTask = task;

  document.getElementById('focus-task-name').textContent = task.title;
  document.getElementById('focus-mode').classList.remove('hidden');

  // Reset timer
  stopTimer();
  focusSeconds = 0;
  updateTimerDisplay();

  // Auto-start
  toggleTimer();
}

function exitFocusMode() {
  stopTimer();
  document.getElementById('focus-mode').classList.add('hidden');
  currentFocusTask = null;
}

function toggleTimer() {
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');

  if (focusTimerInterval) {
    stopTimer();
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
  } else {
    focusTimerInterval = setInterval(() => {
      focusSeconds++;
      updateTimerDisplay();
    }, 1000);
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
  }
}

function resetTimer() {
  stopTimer();
  focusSeconds = 0;
  updateTimerDisplay();
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
}

function stopTimer() {
  if (focusTimerInterval) {
    clearInterval(focusTimerInterval);
    focusTimerInterval = null;
  }
}

function updateTimerDisplay() {
  const hrs = Math.floor(focusSeconds / 3600);
  const mins = Math.floor((focusSeconds % 3600) / 60);
  const secs = focusSeconds % 60;

  const display = [hrs, mins, secs]
    .map(v => String(v).padStart(2, '0'))
    .join(':');

  document.getElementById('timer-display').textContent = display;
}

// Event Listeners for Focus Mode
document.getElementById('timer-toggle-btn').addEventListener('click', toggleTimer);
document.getElementById('timer-reset-btn').addEventListener('click', resetTimer);

// Focus Mode Window Controls
document.getElementById('focus-close-btn').addEventListener('click', () => appWindow.close());
document.getElementById('focus-minimize-btn').addEventListener('click', () => appWindow.minimize());
document.getElementById('focus-maximize-btn').addEventListener('click', () => appWindow.toggleMaximize());

document.getElementById('focus-complete-btn').addEventListener('click', () => {
  if (currentFocusTask) {
    currentFocusTask.completed = true;
    saveTasks();
    renderTasks();
    exitFocusMode();
  }
});

document.getElementById('focus-exit-btn').addEventListener('click', exitFocusMode);

// Initialize
renderTasks();
console.log('FlowPane initialized');
