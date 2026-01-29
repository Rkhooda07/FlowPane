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

    taskList.appendChild(li);
  });
}

function addTask() {
  const titleInput = document.getElementById('task-input');
  const dueInput = document.getElementById('due-input');

  if (!titleInput.value.trim()) return;

  const newTask = {
    title: titleInput.value.trim(),
    due: dueInput.value || new Date(Date.now() + 86400000).toISOString(), // Default to tomorrow
    completed: false,
    urgent: false // Could be logic driven (e.g. if due in < 3 hours)
  };

  // Simple urgency logic
  const diffHrs = (new Date(newTask.due) - new Date()) / (1000 * 60 * 60);
  if (diffHrs < 5) newTask.urgent = true;

  tasks.push(newTask);
  saveTasks();
  renderTasks();

  titleInput.value = '';
}

// Event Listeners
document.getElementById('task-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addTask();
});

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

// Initialize
renderTasks();
console.log('FlowPane initialized');
