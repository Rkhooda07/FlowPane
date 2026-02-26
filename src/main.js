const { getCurrentWindow, currentMonitor, LogicalSize } = window.__TAURI__.window;

const appWindow = getCurrentWindow();

// State management
let tasks = JSON.parse(localStorage.getItem('tasks')) || [];
let isInFocusMode = false;
let lastNormalPosition = null;
let isAnimating = false;
let lastExpandTime = 0;

const appElement = document.getElementById('app');

const ALL_WINDOWS_SIZE = new LogicalSize(300, 500);
const COLLAPSED_SIZE_Y = new LogicalSize(300, 38); // Match CSS height for bar
const COLLAPSED_SIZE_X = new LogicalSize(38, 250); // Match CSS dimensions

// Animation Helper - Animates both position and size simultaneously
async function animateWindowTransform(startPos, endPos, startSize, endSize, duration = 450) {
  isAnimating = true;
  const startTime = performance.now();
  const { LogicalSize, PhysicalPosition, PhysicalSize } = window.__TAURI__.window;

  // Convert logical sizes to physical if they aren't already for smoother interpolation
  const monitor = await currentMonitor();
  const scale = monitor ? monitor.scaleFactor : 1;

  const pStartSize = {
    width: startSize.width * (startSize instanceof LogicalSize ? scale : 1),
    height: startSize.height * (startSize instanceof LogicalSize ? scale : 1)
  };
  const pEndSize = {
    width: endSize.width * (endSize instanceof LogicalSize ? scale : 1),
    height: endSize.height * (endSize instanceof LogicalSize ? scale : 1)
  };

  return new Promise(resolve => {
    async function step() {
      const now = performance.now();
      const progress = Math.min((now - startTime) / duration, 1);

      // Ease Out Cubic for a natural feel
      const ease = 1 - Math.pow(1 - progress, 3);

      const currentX = startPos.x + (endPos.x - startPos.x) * ease;
      const currentY = startPos.y + (endPos.y - startPos.y) * ease;
      const currentW = pStartSize.width + (pEndSize.width - pStartSize.width) * ease;
      const currentH = pStartSize.height + (pEndSize.height - pStartSize.height) * ease;

      try {
        // Set both size and position in the same frame for sync
        await appWindow.setSize(new PhysicalSize(Math.round(currentW), Math.round(currentH)));
        await appWindow.setPosition(new PhysicalPosition(Math.round(currentX), Math.round(currentY)));
      } catch (e) {
        // Ignore potential errors during rapid movement
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        isAnimating = false;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

async function toggleCollapseY(isManualDrag = false) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const isCurrentlyCollapsed = appElement.classList.contains('collapsed-y') || appElement.classList.contains('collapsed-x');
    const isCollapsing = !appElement.classList.contains('collapsed-y');

    if (isCollapsing) {
      // COLLAPSE FLOW
      try {
        if (!isCurrentlyCollapsed) {
          lastNormalPosition = await appWindow.outerPosition();
        }
      } catch (e) {
        console.error('Failed to capture position:', e);
      }

      appElement.classList.remove('collapsed-x');
      appElement.classList.add('collapsed-y');

      // Update UI immediately (fade out content, show title)
      if (isInFocusMode && currentFocusTask) {
        updateNavbarTitle(currentFocusTask.title);
        showNavbarTimer();
      }

      // Start both animations immediately
      try {
        const monitor = await currentMonitor();
        if (monitor) {
          const currentPos = await appWindow.outerPosition();
          const currentSize = await appWindow.outerSize();
          const { height: scrH } = monitor.size;
          const { y: offsetY } = monitor.position;
          const scaleFactor = monitor.scaleFactor;

          const collapsedPhysicalHeight = COLLAPSED_SIZE_Y.height * scaleFactor;

          // Calculate distances to top and bottom edges from current position
          const distTop = Math.abs(currentPos.y - offsetY);
          const distBottom = Math.abs((offsetY + scrH) - (currentPos.y + currentSize.height));

          let newY = (distTop < distBottom) ? offsetY : (offsetY + scrH - collapsedPhysicalHeight);
          let newX = currentPos.x;

          // If snapping to bottom, also snap to the nearest side to avoid macOS Dock
          if (newY !== offsetY) {
            const { width: scrW } = monitor.size;
            const { x: offsetX } = monitor.position;
            const collapsedPhysicalWidth = COLLAPSED_SIZE_Y.width * scaleFactor;

            // Determine if left side or right side is closer
            const midPoint = offsetX + (scrW / 2);
            const windowMid = currentPos.x + (currentSize.width / 2);

            if (windowMid < midPoint) {
              newX = offsetX;
            } else {
              newX = offsetX + scrW - collapsedPhysicalWidth;
            }
          }

          // Animate both size and position simultaneously
          await animateWindowTransform(
            currentPos,
            { x: newX, y: newY },
            currentSize,
            COLLAPSED_SIZE_Y,
            450
          );
        }
      } catch (error) {
        console.error('Failed to transform window vertically:', error);
      }
    } else {
      // EXPAND FLOW
      try {
        // 1. Reveal content immediately
        appElement.classList.remove('collapsed-y');
        updateNavbarTitle(isInFocusMode && currentFocusTask ? currentFocusTask.title : 'FlowPane');
        hideNavbarTimer();

        if (isManualDrag) {
          // SMART INSTANT EXPANSION: Offset if at bottom to grow UPWARDS
          try {
            const monitor = await currentMonitor();
            const currentPos = await appWindow.outerPosition();
            const { height: winH } = await appWindow.outerSize();
            const scale = monitor ? monitor.scaleFactor : 1;

            if (monitor) {
              const { height: scrH } = monitor.size;
              const { y: offsetY } = monitor.position;
              const expandedPhysicalH = ALL_WINDOWS_SIZE.height * scale;

              // If near bottom, move UP to accommodate new height
              const isNearBottom = Math.abs((offsetY + scrH) - (currentPos.y + winH)) < 20;
              if (isNearBottom) {
                const newY = (offsetY + scrH) - expandedPhysicalH;
                await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(currentPos.x, Math.round(newY)));
              }
            }
          } catch (e) { }

          await appWindow.setSize(ALL_WINDOWS_SIZE);
          lastExpandTime = Date.now();
          return;
        }

        const monitor = await currentMonitor();
        if (monitor) {
          const currentPos = await appWindow.outerPosition();
          const currentSize = await appWindow.outerSize();
          const endPos = lastNormalPosition || currentPos;

          await animateWindowTransform(
            currentPos,
            endPos,
            currentSize,
            ALL_WINDOWS_SIZE,
            450
          );
          lastExpandTime = Date.now();
        }
      } catch (error) {
        await appWindow.setSize(ALL_WINDOWS_SIZE);
        console.error('Failed to expand window vertically:', error);
      }
    }
  } finally {
    isAnimating = false;
  }
}

async function toggleCollapseX(isManualDrag = false) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const isCurrentlyCollapsed = appElement.classList.contains('collapsed-y') || appElement.classList.contains('collapsed-x');
    const isCollapsing = !appElement.classList.contains('collapsed-x');

    if (isCollapsing) {
      // COLLAPSE FLOW
      try {
        if (!isCurrentlyCollapsed) {
          lastNormalPosition = await appWindow.outerPosition();
        }
      } catch (e) {
        console.error('Failed to capture position:', e);
      }

      appElement.classList.remove('collapsed-y');
      appElement.classList.add('collapsed-x');

      if (isInFocusMode && currentFocusTask) {
        updateNavbarTitle(currentFocusTask.title);
        showNavbarTimer();
      }

      try {
        const monitor = await currentMonitor();
        if (monitor) {
          const currentPos = await appWindow.outerPosition();
          const currentSize = await appWindow.outerSize();
          const { width: scrW } = monitor.size;
          const { x: offsetX } = monitor.position;
          const scaleFactor = monitor.scaleFactor;

          const collapsedPhysicalWidth = COLLAPSED_SIZE_X.width * scaleFactor;
          const distLeft = Math.abs(currentPos.x - offsetX);
          const distRight = Math.abs((offsetX + scrW) - (currentPos.x + currentSize.width));

          let newX = (distLeft < distRight) ? offsetX : (offsetX + scrW - collapsedPhysicalWidth);

          // Animate both size and position simultaneously
          await animateWindowTransform(
            currentPos,
            { x: newX, y: currentPos.y },
            currentSize,
            COLLAPSED_SIZE_X,
            450
          );
        }
      } catch (error) {
        console.error('Failed to transform window to side:', error);
      }
    } else {
      // EXPAND FLOW
      try {
        appElement.classList.remove('collapsed-x');
        updateNavbarTitle(isInFocusMode && currentFocusTask ? currentFocusTask.title : 'FlowPane');
        hideNavbarTimer();

        if (isManualDrag) {
          // SMART INSTANT EXPANSION: Offset if at right to grow LEFTWARDS
          try {
            const monitor = await currentMonitor();
            const currentPos = await appWindow.outerPosition();
            const { width: winW } = await appWindow.outerSize();
            const scale = monitor ? monitor.scaleFactor : 1;

            if (monitor) {
              const { width: scrW } = monitor.size;
              const { x: offsetX } = monitor.position;
              const expandedPhysicalW = ALL_WINDOWS_SIZE.width * scale;

              // If near right edge, move LEFT to accommodate new width
              const isNearRight = Math.abs((offsetX + scrW) - (currentPos.x + winW)) < 20;
              if (isNearRight) {
                const newX = (offsetX + scrW) - expandedPhysicalW;
                await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(Math.round(newX), currentPos.y));
              }
            }
          } catch (e) { }

          await appWindow.setSize(ALL_WINDOWS_SIZE);
          lastExpandTime = Date.now();
          return;
        }

        const monitor = await currentMonitor();
        if (monitor) {
          const currentPos = await appWindow.outerPosition();
          const currentSize = await appWindow.outerSize();
          const endPos = lastNormalPosition || currentPos;

          await animateWindowTransform(
            currentPos,
            endPos,
            currentSize,
            ALL_WINDOWS_SIZE,
            450
          );
          lastExpandTime = Date.now();
        }
      } catch (error) {
        await appWindow.setSize(ALL_WINDOWS_SIZE);
        console.error('Failed to expand window horizontally:', error);
      }
    }
  } finally {
    isAnimating = false;
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

// Double click defaults moved to dragging behavior
// (Removed dblclick fold)


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
      let newVal = val.substring(0, pos) + e.key + val.substring(pos + 1);

      // Validation Logic
      const d = parseInt(newVal.substring(0, 2));
      const m = parseInt(newVal.substring(3, 5));
      const y = parseInt(newVal.substring(6, 10));
      const currentYear = new Date().getFullYear();

      // Clamp Day
      if (d > 31) newVal = '31' + newVal.substring(2);
      if (d === 0) newVal = '01' + newVal.substring(2);

      // Clamp Month
      if (m > 12) newVal = newVal.substring(0, 3) + '12' + newVal.substring(5);
      if (m === 0) newVal = newVal.substring(0, 3) + '01' + newVal.substring(5);

      // Clamp Year (if fully formed year < currentYear)
      if (pos >= 6 && pos <= 9) {
        const newY = parseInt(newVal.substring(6, 10));
        if (newY < currentYear) {
          newVal = newVal.substring(0, 6) + currentYear + newVal.substring(10);
        }
      }

      // Clamp Hours (12-hour format)
      const h = parseInt(newVal.substring(12, 14));
      if (h > 12) newVal = newVal.substring(0, 12) + '12' + newVal.substring(14);
      if (h === 0) newVal = newVal.substring(0, 12) + '01' + newVal.substring(14); // Hours 00 is invalid in 12h

      // Clamp Minutes
      const min = parseInt(newVal.substring(15, 17));
      if (min > 59) newVal = newVal.substring(0, 15) + '59' + newVal.substring(17);

      dueInput.value = newVal;

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
  if (diffHrs < 0.25) newTask.urgent = true; // 15 minutes = 0.25 hours

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
  if (isMinimizing || isAnimating) return;

  const monitor = await currentMonitor();
  if (!monitor) return;

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { width: scrW, height: scrH } = monitor.size;
  const { x: offsetX, y: offsetY } = monitor.position;

  const isCollapsedY = appElement.classList.contains('collapsed-y');
  const isCollapsedX = appElement.classList.contains('collapsed-x');

  // 3. Regular Snapping (if not collapsing)
  let newX = winX;
  let newY = winY;

  if (Math.abs(winX - offsetX) < SNAP_THRESHOLD) newX = offsetX;
  else if (Math.abs(winX + winW - (offsetX + scrW)) < SNAP_THRESHOLD) newX = offsetX + scrW - winW;

  if (Math.abs(winY - offsetY) < SNAP_THRESHOLD) newY = offsetY;
  else if (Math.abs(winY + winH - (offsetY + scrH)) < SNAP_THRESHOLD) newY = offsetY + scrH - winH;

  if (newX !== winX || newY !== winY) {
    await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(newX, newY));
  }
}

// updateControlIcons removed as fold buttons are gone


// Listen for move events to trigger snapping and icon updates
async function clampToScreen() {
  if (isAnimating) return;
  const monitor = await currentMonitor();
  if (!monitor) return;

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { width: scrW, height: scrH } = monitor.size;
  const { x: offsetX, y: offsetY } = monitor.position;

  let newX = winX;
  let newY = winY;

  // Clamp Y (The "Wall" effect)
  if (winY < offsetY) newY = offsetY;
  else if (winY + winH > offsetY + scrH) newY = offsetY + scrH - winH;

  // Clamp X
  if (winX < offsetX) newX = offsetX;
  else if (winX + winW > offsetX + scrW) newX = offsetX + scrW - winW;

  if (newX !== winX || newY !== winY) {
    await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(newX, newY));
  }
}

async function checkInstantCollapse() {
  if (isAnimating) return;
  if (Date.now() - lastExpandTime < 800) return; // Prevent flip-flop right after expansion
  const isCollapsed = appElement.classList.contains('collapsed-y') || appElement.classList.contains('collapsed-x');
  if (isCollapsed) return;

  const monitor = await currentMonitor();
  if (!monitor) return;

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { width: scrW, height: scrH } = monitor.size;
  const { x: offsetX, y: offsetY } = monitor.position;

  // Sensitive trigger for instant "genie" capture
  const TRIGGER_TOP_SIDES = 8;
  const TRIGGER_BOTTOM = 2; // decreased to require more drag distance

  const dTop = Math.abs(winY - offsetY);
  const dBottom = Math.abs((offsetY + scrH) - (winY + winH));
  const dLeft = Math.abs(winX - offsetX);
  const dRight = Math.abs((offsetX + scrW) - (winX + winW));

  if (dTop < TRIGGER_TOP_SIDES || dBottom < TRIGGER_BOTTOM) {
    toggleCollapseY();
  } else if (dLeft < TRIGGER_TOP_SIDES || dRight < TRIGGER_TOP_SIDES) {
    toggleCollapseX();
  }
}

async function checkInstantExpand() {
  if (isAnimating) return;
  const isCollapsedY = appElement.classList.contains('collapsed-y');
  const isCollapsedX = appElement.classList.contains('collapsed-x');
  if (!isCollapsedY && !isCollapsedX) return;

  const monitor = await currentMonitor();
  if (!monitor) return;

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { width: scrW, height: scrH } = monitor.size;
  const { x: offsetX, y: offsetY } = monitor.position;

  const EXPAND_THRESHOLD = 12; // Intentional threshold for instant feel
  const dTop = Math.abs(winY - offsetY);
  const dBottom = Math.abs((offsetY + scrH) - (winY + winH));
  const dLeft = Math.abs(winX - offsetX);
  const dRight = Math.abs((offsetX + scrW) - (winX + winW));

  if (isCollapsedY && dTop > EXPAND_THRESHOLD && dBottom > EXPAND_THRESHOLD) {
    toggleCollapseY(true); // true = isManualDrag
  } else if (isCollapsedX && dLeft > EXPAND_THRESHOLD && dRight > EXPAND_THRESHOLD) {
    toggleCollapseX(true); // true = isManualDrag
  }
}

// Listen for move events to trigger snapping and icon updates
let moveTimeout;
appWindow.onMoved(() => {
  if (isMinimizing || isAnimating) return;

  // Instant reaction logic
  clampToScreen();
  checkInstantExpand();
  checkInstantCollapse();

  clearTimeout(moveTimeout);
  moveTimeout = setTimeout(snapToEdges, 200);
});

// Focus Mode Logic
let focusTimerInterval = null;
let focusSeconds = 0;
let currentFocusTask = null;
let isCountdown = false;

function enterFocusMode(task) {
  currentFocusTask = task;
  isInFocusMode = true;

  document.getElementById('focus-task-name').textContent = task.title;
  document.getElementById('focus-mode').classList.remove('hidden');

  // Update navbar title to task name immediately
  updateNavbarTitle(task.title);

  // Reset timer
  stopTimer();
  focusSeconds = 0;
  isCountdown = false;
  updateTimerDisplay();

  // Auto-start
  toggleTimer();
}

function exitFocusMode() {
  stopTimer();
  document.getElementById('focus-mode').classList.add('hidden');
  currentFocusTask = null;
  isInFocusMode = false;
  isCountdown = false;

  // Restore "FlowPane" title when exiting focus mode
  updateNavbarTitle('FlowPane');
  hideNavbarTimer();
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
      if (isCountdown) {
        if (focusSeconds > 0) {
          focusSeconds--;
          updateTimerDisplay();
        } else {
          stopTimer();
          // Optional: Add completion sound or notification here
          playIcon.classList.remove('hidden');
          pauseIcon.classList.add('hidden');
          isCountdown = false;
        }
      } else {
        focusSeconds++;
        updateTimerDisplay();
      }
    }, 1000);
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
  }
}

function resetTimer() {
  stopTimer();
  focusSeconds = 0;
  isCountdown = false;
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

  // Update navbar timer if in focus mode
  if (isInFocusMode) {
    updateNavbarTimer(display);
  }
}

// Timer Settings Modal Logic
const timerModal = document.getElementById('timer-modal');
const timerInput = document.getElementById('timer-input-minutes');

function openTimerSettings() {
  timerModal.classList.remove('hidden');
  timerInput.focus();
}

function closeTimerModal() {
  timerModal.classList.add('hidden');
}

function startCountdown() {
  const mins = parseInt(timerInput.value);
  if (mins && mins > 0) {
    stopTimer();
    focusSeconds = mins * 60;
    isCountdown = true;
    updateTimerDisplay();
    closeTimerModal();
    toggleTimer(); // Start immediately
  }
}

// Event Listeners for Focus Mode
document.getElementById('timer-toggle-btn').addEventListener('click', toggleTimer);
document.getElementById('timer-reset-btn').addEventListener('click', resetTimer);
document.getElementById('timer-settings-btn').addEventListener('click', openTimerSettings);

// Modal Listeners
document.getElementById('timer-cancel-btn').addEventListener('click', closeTimerModal);
document.getElementById('timer-start-btn').addEventListener('click', startCountdown);

// Allow Enter key in input
timerInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') startCountdown();
});

// Focus Mode Window Controls
document.getElementById('focus-close-btn').addEventListener('click', () => appWindow.close());
document.getElementById('focus-minimize-btn').addEventListener('click', () => appWindow.minimize());
document.getElementById('focus-maximize-btn').addEventListener('click', () => appWindow.toggleMaximize());

// Fold buttons removed from Focus mode


document.getElementById('focus-nav-complete-btn').addEventListener('click', () => {
  if (currentFocusTask) {
    currentFocusTask.completed = true;
    saveTasks();
    renderTasks();
    exitFocusMode();
  }
});

document.getElementById('focus-nav-exit-btn').addEventListener('click', exitFocusMode);

// Helper function to update navbar title
function updateNavbarTitle(title) {
  // Update both main navbar and focus mode navbar
  const mainTitle = document.querySelector('.title-bar h1');
  const focusTitle = document.querySelector('.focus-header-bar h1');

  if (mainTitle) {
    // Get the timer span and preserve it
    const timerSpan = mainTitle.querySelector('.navbar-timer');
    mainTitle.childNodes[0].textContent = title;
  }
  if (focusTitle) {
    const timerSpan = focusTitle.querySelector('.navbar-timer');
    focusTitle.childNodes[0].textContent = title;
  }
}

// Helper function to update navbar timer
function updateNavbarTimer(timeString) {
  const navbarTimers = document.querySelectorAll('.navbar-timer');
  const [h, m, s] = timeString.split(':');

  navbarTimers.forEach(timer => {
    // Inject spans for styling control
    timer.innerHTML = `
      <span class="t-unit">${h}</span>
      <span class="t-sep">:</span>
      <span class="t-unit">${m}</span>
      <span class="t-sep">:</span>
      <span class="t-unit">${s}</span>
    `;
  });
}

// Helper function to show navbar timer
function showNavbarTimer() {
  const navbarTimers = document.querySelectorAll('.navbar-timer');
  navbarTimers.forEach(timer => {
    timer.classList.remove('hidden');
  });
}

// Helper function to hide navbar timer
function hideNavbarTimer() {
  const navbarTimers = document.querySelectorAll('.navbar-timer');
  navbarTimers.forEach(timer => {
    timer.classList.add('hidden');
  });
}

// Initialize
renderTasks();
console.log('FlowPane initialized');
