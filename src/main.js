const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();

// State management
let tasks = JSON.parse(localStorage.getItem('tasks')) || [];

const appElement = document.getElementById('app');

// Window controls
document.getElementById('minimize-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  appElement.classList.toggle('collapsed');
});

document.querySelector('.title-bar').addEventListener('click', () => {
  if (appElement.classList.contains('collapsed')) {
    appElement.classList.remove('collapsed');
  }
});

document.getElementById('close-btn').addEventListener('click', () => {
  appWindow.close();
});

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
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHrs / 24);

      if (diffMs < 0) dueText = 'Overdue';
      else if (diffDays > 0) dueText = `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
      else if (diffHrs > 0) dueText = `Due in ${diffHrs} hour${diffHrs > 1 ? 's' : ''}`;
      else dueText = 'Due soon';
    }

    li.innerHTML = `
      <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} />
      <div class="task-info">
        <div class="task-title">${task.title}</div>
        <div class="task-due">${dueText}</div>
      </div>
    `;

    li.querySelector('.task-checkbox').addEventListener('change', (e) => {
      tasks[index].completed = e.target.checked;
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
const directions = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
directions.forEach(dir => {
  const handle = document.querySelector(`.resize-handle.${dir}`);
  if (handle) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Translate direction string to Tauri's enum if necessary, 
      // but usually the string works or we use the specific side
      // In Tauri 2, startResizing is available on the window
      // For simplicity, we can also use data-tauri-drag-region for dragging
      // and let the CSS cursor provide the visual cue, but we need 
      // actual resize calls for frameless.
      appWindow.startResizing(dir.toUpperCase());
    });
  }
});

// Initialize
renderTasks();
console.log('FlowPane initialized');
