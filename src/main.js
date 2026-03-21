const { getCurrentWindow, currentMonitor, LogicalSize } = window.__TAURI__.window;

const appWindow = getCurrentWindow();

// State management
let tasks = [];
let store = null;
let isInFocusMode = false;
let lastNormalPosition = null;
let isAnimating = false;
let lastExpandTime = 0;
let isPeeking = false;
let peekTimeout = null;
let peekMode = null;

const appElement = document.getElementById('app');

const ALL_WINDOWS_SIZE = new LogicalSize(325, 375);
const PEEK_SIZE_Y = new LogicalSize(325, 270);
const PEEK_SIZE_X = new LogicalSize(270, 325);
const COLLAPSED_SIZE_Y = new LogicalSize(325, 38); // Match CSS height for bar
const COLLAPSED_SIZE_X = new LogicalSize(38, 375); // Match CSS dimensions

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

    if (isManualDrag) {
      isPeeking = false;
      appElement.classList.remove('peeking');
    }

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

          // Calculate distances to top edge from current position
          const newY = offsetY;
          const newX = currentPos.x;

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
          await appWindow.setSize(ALL_WINDOWS_SIZE);
          lastExpandTime = Date.now();
          return;
        }

        const monitor = await currentMonitor();
        if (monitor) {
          const currentPos = await appWindow.outerPosition();
          const currentSize = await appWindow.outerSize();
          const { height: scrH } = monitor.size;
          const { y: offsetY } = monitor.position;
          const scale = monitor.scaleFactor;
          
          const targetSize = isPeeking ? PEEK_SIZE_Y : ALL_WINDOWS_SIZE;
          const expandedPhysicalH = targetSize.height * scale;

          // Growing DOWNWARDS from top
          let endY = offsetY;
          if (lastNormalPosition && !isPeeking) {
            endY = lastNormalPosition.y;
          }

          const endPos = { x: currentPos.x, y: Math.round(endY) };

          await animateWindowTransform(
            currentPos,
            endPos,
            currentSize,
            targetSize,
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

    if (isManualDrag) {
      isPeeking = false;
      appElement.classList.remove('peeking');
    }

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
          const { width: scrW } = monitor.size;
          const { x: offsetX } = monitor.position;
          const scale = monitor.scaleFactor;
          
          const targetSize = isPeeking ? PEEK_SIZE_X : ALL_WINDOWS_SIZE;
          const expandedPhysicalW = targetSize.width * scale;

          // Smart position: if at right, grow LEFTWARDS; if at left, grow RIGHTWARDS
          let endX = currentPos.x;
          const isNearRight = Math.abs((offsetX + scrW) - (currentPos.x + currentSize.width)) < 25;
          if (isNearRight) {
            endX = (offsetX + scrW) - expandedPhysicalW;
          } else if (Math.abs(currentPos.x - offsetX) < 25) {
            endX = offsetX;
          } else if (lastNormalPosition && !isPeeking) {
            endX = lastNormalPosition.x;
          }

          const endPos = { x: Math.round(endX), y: currentPos.y };

          await animateWindowTransform(
            currentPos,
            endPos,
            currentSize,
            targetSize,
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
async function initStore() {
  try {
    const tauri = window.__TAURI__;
    const StoreClass = (tauri.store && tauri.store.Store) ||
      (tauri.plugins && tauri.plugins.store && tauri.plugins.store.Store);
    if (!StoreClass) throw new Error('Store plugin not found on window.__TAURI__');

    store = new StoreClass('tasks.json');
    const saved = await store.get('tasks');
    if (saved) {
      tasks = saved;
    }
    const savedNotes = await store.get('notesDrafts');
    if (savedNotes && typeof savedNotes === 'object') {
      noteDrafts = Object.fromEntries(
        Object.entries(savedNotes).map(([noteId, entry]) => [noteId, normalizeNoteEntry(entry)])
      );
    }
    const savedSkipDeleteConfirm = await store.get('skipDeleteConfirm');
    if (typeof savedSkipDeleteConfirm === 'boolean') {
      skipDeleteConfirm = savedSkipDeleteConfirm;
    }
  } catch (e) {
    console.error('Failed to load store, falling back to localStorage:', e);
    tasks = JSON.parse(localStorage.getItem('tasks')) || [];
    try {
      const localNotes = JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY)) || {};
      noteDrafts = Object.fromEntries(
        Object.entries(localNotes).map(([noteId, entry]) => [noteId, normalizeNoteEntry(entry)])
      );
    } catch (err) {
      noteDrafts = {};
    }
    try {
      skipDeleteConfirm = JSON.parse(localStorage.getItem(DELETE_CONFIRM_PREF_KEY)) === true;
    } catch (err) {
      skipDeleteConfirm = false;
    }
  }
  renderTasks();
}

async function saveTasks() {
  if (store) {
    try {
      await store.set('tasks', tasks);
      await store.save();
    } catch (e) {
      console.error('Failed to save to store:', e);
      localStorage.setItem('tasks', JSON.stringify(tasks));
    }
  } else {
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }
}

async function persistNotesDrafts() {
  if (store) {
    try {
      await store.set('notesDrafts', noteDrafts);
      await store.save();
      return;
    } catch (e) {
      console.error('Failed to save notes to store, falling back to localStorage:', e);
    }
  }

  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(noteDrafts));
}

async function persistSkipDeleteConfirmSetting() {
  if (store) {
    try {
      await store.set('skipDeleteConfirm', skipDeleteConfirm);
      await store.save();
      return;
    } catch (e) {
      console.error('Failed to save delete confirm preference to store, falling back to localStorage:', e);
    }
  }

  localStorage.setItem(DELETE_CONFIRM_PREF_KEY, JSON.stringify(skipDeleteConfirm));
}

async function requestDeleteConfirmation(itemType) {
  if (skipDeleteConfirm) return true;

  if (!deleteConfirmModal || !deleteConfirmTitle || !deleteConfirmText || !deleteConfirmNeverAgain || !deleteConfirmCancel || !deleteConfirmYes) {
    return window.confirm(`Delete this ${itemType}?`);
  }

  deleteConfirmTitle.textContent = `Delete ${itemType}?`;
  deleteConfirmText.textContent = `Are you sure you want to remove this ${itemType}?`;
  deleteConfirmNeverAgain.checked = false;
  deleteConfirmModal.classList.remove('hidden');
  deleteConfirmModal.setAttribute('aria-hidden', 'false');

  return new Promise(resolve => {
    const close = (confirmed) => {
      deleteConfirmModal.classList.add('hidden');
      deleteConfirmModal.setAttribute('aria-hidden', 'true');
      deleteConfirmCancel.removeEventListener('click', onCancel);
      deleteConfirmYes.removeEventListener('click', onConfirm);
      deleteConfirmModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onEscape);
      resolve(confirmed);
    };

    const onCancel = (e) => {
      e.stopPropagation();
      close(false);
    };

    const onConfirm = async (e) => {
      e.stopPropagation();
      if (deleteConfirmNeverAgain.checked) {
        skipDeleteConfirm = true;
        await persistSkipDeleteConfirmSetting();
      }
      close(true);
    };

    const onBackdrop = (e) => {
      if (e.target === deleteConfirmModal) {
        close(false);
      }
    };

    const onEscape = (e) => {
      if (e.key === 'Escape') {
        close(false);
      }
    };

    deleteConfirmCancel.addEventListener('click', onCancel);
    deleteConfirmYes.addEventListener('click', onConfirm);
    deleteConfirmModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEscape);
  });
}

function renderTasks() {
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';
  const savedNotes = Object.entries(noteDrafts || {})
    .map(([noteId, entry]) => [noteId, normalizeNoteEntry(entry)])
    .filter(([noteId, note]) => ['1', '2', '3', '4'].includes(String(noteId)) && hasNoteContent(note))
    .sort((a, b) => Number(a[0]) - Number(b[0]));

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

    li.querySelector('.delete-task-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const shouldDelete = await requestDeleteConfirmation('task');
      if (!shouldDelete) return;
      tasks.splice(index, 1);
      saveTasks();
      renderTasks();
    });

    // Right click to delete
    li.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const shouldDelete = await requestDeleteConfirmation('task');
      if (!shouldDelete) return;
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

  savedNotes.forEach(([noteId, note]) => {
    const li = document.createElement('li');
    li.className = `task-item note-entry note-entry-${noteId}`;

    const swatch = document.createElement('span');
    swatch.className = 'note-entry-swatch';

    const info = document.createElement('div');
    info.className = 'task-info';

    const title = document.createElement('div');
    title.className = 'task-title note-entry-title';
    title.textContent = (note.title.trim() || 'Untitled note').replace(/\s+/g, ' ').slice(0, 72);

    const subtitle = document.createElement('div');
    subtitle.className = 'task-due note-entry-subtitle';
    subtitle.textContent = 'Saved note';

    const deleteNoteBtn = document.createElement('button');
    deleteNoteBtn.className = 'delete-note-btn';
    deleteNoteBtn.title = 'Delete note';
    deleteNoteBtn.textContent = '×';

    info.appendChild(title);
    info.appendChild(subtitle);
    li.appendChild(swatch);
    li.appendChild(info);
    li.appendChild(deleteNoteBtn);

    deleteNoteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const shouldDelete = await requestDeleteConfirmation('note');
      if (!shouldDelete) return;
      delete noteDrafts[noteId];
      await persistNotesDrafts();
      renderTasks();
    });

    li.addEventListener('click', () => {
      const noteTab = document.querySelector(`.task-note-tab.note-${noteId}`);
      if (noteTab) {
        openNote(noteTab, noteId);
      }
    });

    taskList.appendChild(li);
  });

  if (tasks.length === 0 && savedNotes.length === 0) {
    taskList.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 32px; margin-bottom: 10px; opacity: 0.3;">✨</div>
        <p>No tasks or notes yet.</p>
        <p style="font-size: 11px; opacity: 0.6; margin-top: 4px;">Time to flow into something new.</p>
      </div>
    `;
  }
}

// Event Listeners
const taskInput = document.getElementById('task-input');
const dueInput = document.getElementById('due-input');
const inputArea = document.querySelector('.input-area');
const homeNavLinks = document.querySelectorAll('.navbar-home-link');
const noteTabs = document.querySelectorAll('.task-note-tab');
const notesWorkspace = document.getElementById('notes-workspace');
const notesTitleInput = document.getElementById('notes-title-input');
const notesBodyEditor = document.getElementById('notes-body-editor');
const notesExitBtn = document.getElementById('notes-nav-exit-btn');
const deleteConfirmModal = document.getElementById('delete-confirm-modal');
const deleteConfirmTitle = document.getElementById('delete-confirm-title');
const deleteConfirmText = document.getElementById('delete-confirm-text');
const deleteConfirmNeverAgain = document.getElementById('delete-confirm-never-again');
const deleteConfirmCancel = document.getElementById('delete-confirm-cancel');
const deleteConfirmYes = document.getElementById('delete-confirm-yes');

const NOTES_STORAGE_KEY = 'flowpane-notes-drafts';
const DELETE_CONFIRM_PREF_KEY = 'flowpane-skip-delete-confirm';
let activeNoteId = null;
let noteDrafts = {};
let skipDeleteConfirm = false;

function extractNoteId(tab) {
  const noteClass = [...tab.classList].find(c => /^note-\d+$/.test(c));
  return noteClass ? noteClass.split('-')[1] : null;
}

function setNotesRevealOrigin(tab) {
  if (!tab || !notesWorkspace) return;
  const tabRect = tab.getBoundingClientRect();
  const workspaceRect = notesWorkspace.getBoundingClientRect();
  const x = Math.round(tabRect.left + tabRect.width / 2 - workspaceRect.left);
  const y = Math.round(tabRect.top + tabRect.height / 2 - workspaceRect.top);
  notesWorkspace.style.setProperty('--reveal-x', `${x}px`);
  notesWorkspace.style.setProperty('--reveal-y', `${y}px`);
}

function normalizeNoteEntry(rawEntry) {
  if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)) {
    return {
      title: typeof rawEntry.title === 'string' ? rawEntry.title : '',
      body: typeof rawEntry.body === 'string' ? rawEntry.body : ''
    };
  }

  if (typeof rawEntry === 'string') {
    const lines = rawEntry.split(/\r?\n/);
    const title = lines[0] || '';
    const body = lines.slice(1).join('\n');
    return { title, body };
  }

  return { title: '', body: '' };
}

function hasNoteContent(note) {
  if (!note) return false;
  return note.title.trim().length > 0 || note.body.trim().length > 0;
}

function clearActiveTabState() {
  noteTabs.forEach(tab => tab.classList.remove('note-active'));
}

function getActiveNoteTab() {
  if (!activeNoteId) return null;
  return document.querySelector(`.task-note-tab.note-${activeNoteId}`);
}

function openNote(tab, noteId) {
  if (!notesWorkspace || !notesTitleInput || !notesBodyEditor) return;

  notesWorkspace.classList.remove('theme-1', 'theme-2', 'theme-3', 'theme-4');
  notesWorkspace.classList.add(`theme-${noteId}`);
  notesWorkspace.classList.remove('hidden');
  setNotesRevealOrigin(tab);

  requestAnimationFrame(() => {
    notesWorkspace.classList.add('active');
  });
  appElement.classList.add('notes-active');

  activeNoteId = noteId;
  clearActiveTabState();
  tab.classList.add('note-active');
  const note = normalizeNoteEntry(noteDrafts[noteId]);
  noteDrafts[noteId] = note;
  notesTitleInput.value = note.title;
  notesBodyEditor.value = note.body;

  if (note.title.trim().length === 0) {
    notesTitleInput.focus();
    const titleEnd = notesTitleInput.value.length;
    notesTitleInput.setSelectionRange(titleEnd, titleEnd);
  } else {
    notesBodyEditor.focus();
    const bodyEnd = notesBodyEditor.value.length;
    notesBodyEditor.setSelectionRange(bodyEnd, bodyEnd);
  }
}

function closeNote(tab) {
  if (!notesWorkspace) return;
  setNotesRevealOrigin(tab);
  activeNoteId = null;
  clearActiveTabState();
  notesWorkspace.classList.remove('active');
  appElement.classList.remove('notes-active');
}

function closeActiveNote() {
  const activeTab = getActiveNoteTab();
  if (activeTab) closeNote(activeTab);
}

let noteAutoSaveTimeout = null;
function autoSaveActiveNote() {
  if (!activeNoteId || !notesTitleInput || !notesBodyEditor) return;
  const title = notesTitleInput.value;
  const body = notesBodyEditor.value;

  if (title.trim().length === 0 && body.trim().length === 0) {
    delete noteDrafts[activeNoteId];
  } else {
    noteDrafts[activeNoteId] = {
      title,
      body
    };
  }
  
  renderTasks();

  if (noteAutoSaveTimeout) clearTimeout(noteAutoSaveTimeout);
  noteAutoSaveTimeout = setTimeout(async () => {
    await persistNotesDrafts();
  }, 500);
}

function goToHomeView() {
  if (activeNoteId && notesWorkspace && notesWorkspace.classList.contains('active')) {
    closeActiveNote();
  }

  if (isInFocusMode) {
    exitFocusMode();
  }
}

if (notesWorkspace) {
  notesWorkspace.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'clip-path') return;
    if (!notesWorkspace.classList.contains('active')) {
      notesWorkspace.classList.add('hidden');
    }
  });
}

noteTabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    e.stopPropagation();
    const noteId = extractNoteId(tab);
    if (!noteId) return;

    if (activeNoteId === noteId && notesWorkspace.classList.contains('active')) {
      closeNote(tab);
      return;
    }

    openNote(tab, noteId);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !activeNoteId || !notesWorkspace.classList.contains('active')) return;
  if (deleteConfirmModal && !deleteConfirmModal.classList.contains('hidden')) return;
  closeActiveNote();
});

if (notesExitBtn) {
  notesExitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeActiveNote();
  });
}

if (notesTitleInput && notesBodyEditor) {
  notesTitleInput.addEventListener('input', autoSaveActiveNote);
  notesBodyEditor.addEventListener('input', autoSaveActiveNote);

  notesTitleInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    notesBodyEditor.focus();
    notesBodyEditor.setSelectionRange(0, 0);
  });
}

homeNavLinks.forEach(link => {
  let suppressNextClick = false;

  link.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let didStartDrag = false;

    const onMove = async (moveEvent) => {
      if (didStartDrag) return;

      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);
      if (dx + dy < 4) return;

      didStartDrag = true;
      suppressNextClick = true;
      cleanup();

      try {
        await appWindow.startDragging();
      } catch (err) {
        console.error('Failed to start dragging from title link:', err);
      }
    };

    const onUp = () => {
      cleanup();
    };

    function cleanup() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
  });

  link.addEventListener('click', (e) => {
    e.stopPropagation();
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    goToHomeView();
  });

  link.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    goToHomeView();
  });
});

// Hover peek logic for collapsed windows - bridges from Rust polling for inactive window support
appWindow.listen('mouse-enter', () => {
  if (isAnimating) return;
  const isCollapsedY = appElement.classList.contains('collapsed-y');
  const isCollapsedX = appElement.classList.contains('collapsed-x');

  if ((isCollapsedY || isCollapsedX) && !isPeeking) {
    peekTimeout = setTimeout(() => {
      // Re-verify after timeout
      if (isAnimating) return;
      const stillCollapsedY = appElement.classList.contains('collapsed-y');
      const stillCollapsedX = appElement.classList.contains('collapsed-x');

      if (stillCollapsedY || stillCollapsedX) {
        isPeeking = true;
        peekMode = stillCollapsedY ? 'y' : 'x';
        appElement.classList.add('peeking');
        if (peekMode === 'y') toggleCollapseY();
        else toggleCollapseX();
      }
    }, 150); // Slight delay for intentional hover
  }
});

appWindow.listen('mouse-leave', () => {
  clearTimeout(peekTimeout);
  if (isPeeking) {
    if (!isAnimating) {
      isPeeking = false;
      appElement.classList.remove('peeking');
      if (peekMode === 'y') toggleCollapseY();
      else toggleCollapseX();
    }
  }
});

function getDefaultDueDate() {
  return new Date();
}

const quotes = [
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

// Initialize default date
dueInput.value = formatDateTimeHuman(getDefaultDueDate());

document.querySelectorAll('.quick-time-btn').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    // Prevent focus from shifting away from the inputs so the form stays expanded
    e.preventDefault();
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (btn.classList.contains('success-active')) return;
    
    const minutes = parseInt(btn.getAttribute('data-minutes'), 10);
    
    let currentDate = parseMaskedDate(dueInput.value);
    // If not a valid date in the input, start from now
    if (!currentDate || isNaN(currentDate.getTime())) {
      currentDate = new Date();
    }
    
    currentDate.setMinutes(currentDate.getMinutes() + minutes);
    dueInput.value = formatDateTimeHuman(currentDate);

    // Trigger visual feedback animations
    btn.classList.remove('success-exit');
    btn.classList.add('success-active');

    setTimeout(() => {
      btn.classList.remove('success-active');
      btn.classList.add('success-exit');
      
      // Clean up exit animation class after it finishes
      setTimeout(() => {
        btn.classList.remove('success-exit');
      }, 400); // 400ms matches the animation duration
    }, 1000);
  });
});

taskInput.addEventListener('focus', () => {
  inputArea.classList.add('expanded');
  // Refresh the due input with current live time when user starts adding a task
  if (!taskInput.value.trim()) {
    dueInput.value = formatDateTimeHuman(new Date());
  }
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

  const dTop = Math.abs(winY - offsetY);
  const dLeft = Math.abs(winX - offsetX);
  const dRight = Math.abs((offsetX + scrW) - (winX + winW));

  if (dTop < TRIGGER_TOP_SIDES) {
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
  const dLeft = Math.abs(winX - offsetX);
  const dRight = Math.abs((offsetX + scrW) - (winX + winW));

  if (isCollapsedY && dTop > EXPAND_THRESHOLD) {
    toggleCollapseY(true); // true = isManualDrag
  } else if (isCollapsedX && dLeft > EXPAND_THRESHOLD && dRight > EXPAND_THRESHOLD) {
    toggleCollapseX(true); // true = isManualDrag
  }
}

// Listen for move events to trigger snapping and icon updates
let moveTimeout;
appWindow.onMoved(async () => {
  if (isMinimizing || isAnimating) return;

  // If the window is moved manually while peeking (expanding via hover),
  // end the peek state and force it to full size.
  if (isPeeking) {
    isPeeking = false;
    appElement.classList.remove('peeking');
    
    // Force instant full size expansion when starting to drag a peeked window
    const monitor = await currentMonitor();
    if (monitor) {
      await appWindow.setSize(ALL_WINDOWS_SIZE);
    }
  }

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

  // Set a random quote
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById('focus-quote').textContent = `"${randomQuote}"`;

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
initStore();
console.log('FlowPane initialized');
