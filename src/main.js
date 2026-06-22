const { getCurrentWindow, currentMonitor, LogicalSize } = window.__TAURI__.window;

const appWindow = getCurrentWindow();
const appWindowLabel = appWindow.label;
const APP_WINDOW_SHORTCUT_COOLDOWN_MS = 700;
let isCreatingAppWindow = false;

async function createAppWindowFromShortcut(event) {
  const key = event.key?.toLowerCase();
  const isNewWindowShortcut = key === 'n' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;

  if (!isNewWindowShortcut || event.repeat || isCreatingAppWindow) return;

  event.preventDefault();
  isCreatingAppWindow = true;

  try {
    await window.__TAURI__.core.invoke('create_app_window');
  } catch (error) {
    console.error('Failed to create app window:', error);
  } finally {
    setTimeout(() => {
      isCreatingAppWindow = false;
    }, APP_WINDOW_SHORTCUT_COOLDOWN_MS);
  }
}

async function closeWindowFromShortcut(event) {
  const key = event.key?.toLowerCase();
  const isCloseWindowShortcut = key === 'w' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;

  if (!isCloseWindowShortcut || event.repeat) return;

  event.preventDefault();
  try {
    await window.__TAURI__.core.invoke('close_app_window');
  } catch (error) {
    console.error('Failed to close window:', error);
  }
}

document.addEventListener('keydown', createAppWindowFromShortcut, true);
document.addEventListener('keydown', closeWindowFromShortcut, true);

// State management
let tasks = [];
let store = null;
let isInFocusMode = false;
let collapseModeAfterCongrats = null; // Stores 'x' or 'y' to know where to collapse back to
let lastNormalPosition = null;
let isAnimating = false;
let lastExpandTime = 0;
let isPeeking = false;
let peekTimeout = null;
let peekMode = null;
let isNotificationActive = false; // Track if ANY notification is currently active

function showSideNotification() {
  isNotificationActive = true; // Mark as active regardless of current mode
  
  // We only apply the visual class if we are in collapsed-x mode.
  // If we are expanded, the class will be applied later when toggleCollapseX runs.
  if (appElement.classList.contains('collapsed-x')) {
    appElement.classList.add('side-notification-active');
  }
}

function clearSideNotification() {
  isNotificationActive = false;
  appElement.classList.remove('side-notification-active');
}
let eyeMessageScheduleTimer = null;
let eyeMessageRevealTimer = null;
let eyeMessageDismissTimer = null;
let eyeMessageDismissFadeTimer = null;
let eyeMessageTypeTimer = null;
let isHistoryOpen = false;
let hasUserModifiedDate = false;
let selectedReminderMinutes = null;
let dueInputFocusFromPointer = false;
let collapseTimer = null;

function updateReminderBtnState() {
  if (!taskReminderBtn) return;
  if (hasUserModifiedDate) {
    taskReminderBtn.title = "Add reminder";
    taskReminderBtn.style.opacity = "1";
    taskReminderBtn.style.cursor = "pointer";
  } else {
    taskReminderBtn.title = "Set a deadline first";
    taskReminderBtn.style.opacity = "0.5";
    taskReminderBtn.style.cursor = "default";
  }
}




const appElement = document.getElementById('app');
let isWindowFocused = false;
let isMouseInside = false;
let isActiveWindow = false;
let hoveredWindowLabel = '';

function updateFocusState() {
  const isHoveredWindow = hoveredWindowLabel === appWindowLabel;
  const hasHoveredWindow = hoveredWindowLabel !== '';

  if (isHoveredWindow || (!hasHoveredWindow && isActiveWindow)) {
    appElement.classList.add('focused');
  } else {
    appElement.classList.remove('focused');
  }
}

appWindow.onFocusChanged(({ payload: focused }) => {
  isWindowFocused = focused;
  if (!focused) {
    isActiveWindow = false;
  }
  if (focused && isMouseInside) {
    window.__TAURI__.core.invoke('mark_app_window_active').catch(error => {
      console.error('Failed to mark app window active:', error);
    });
  }
  updateFocusState();
});

appWindow.listen('app-window-active-changed', ({ payload: activeLabel }) => {
  isActiveWindow = activeLabel === appWindowLabel;
  updateFocusState();
});

appWindow.listen('app-window-hover-changed', ({ payload: hoverLabel }) => {
  hoveredWindowLabel = typeof hoverLabel === 'string' ? hoverLabel : '';
  isMouseInside = hoveredWindowLabel === appWindowLabel;
  updateFocusState();
});

appElement.addEventListener('pointerdown', () => {
  isWindowFocused = true;
  isActiveWindow = true;
  updateFocusState();
  window.__TAURI__.core.invoke('mark_app_window_active').catch(error => {
    console.error('Failed to mark app window active:', error);
  });
}, { capture: true });

// Initial check
appWindow.isFocused().then(focused => {
  isWindowFocused = focused;
  updateFocusState();
});

const ALL_WINDOWS_SIZE = new LogicalSize(325, 375);
const PEEK_SIZE_Y = new LogicalSize(325, 270);
const PEEK_SIZE_X = new LogicalSize(270, 325);
const COLLAPSED_SIZE_Y = new LogicalSize(325, 42); // Match CSS height for bar
const COLLAPSED_REMINDER_SIZE_Y = new LogicalSize(325, 112);
const COLLAPSED_SIZE_X = new LogicalSize(42, 300); // Match CSS dimensions
const COLLAPSED_SIZE_Y_BUBBLE = new LogicalSize(325, 180); 
const COLLAPSED_SIZE_X_BUBBLE = new LogicalSize(300, 300); 
const SIDE_NOTIFICATION_BUBBLE_DURATION_MS = 12000;
const BOTTOM_DOCK_MINIMIZE_THRESHOLD = 0;
const HOVER_PEEK_DELAY_MS = 150;
const HOVER_PEEK_RETRY_MS = 80;
const MANUAL_DRAG_EXPAND_DURATION_MS = 420;
const NATIVE_EDGE_SNAP_THRESHOLD = 14;
const NATIVE_SIDE_SNAP_MIN_WIDTH_RATIO = 0.42;
const NATIVE_TOP_SNAP_MIN_WIDTH_RATIO = 0.9;
const NATIVE_EDGE_SNAP_MIN_HEIGHT_RATIO = 0.72;
const DRAG_GESTURE_IDLE_END_MS = 120;

let isWindowDragGesture = false;
let isDockMinimizing = false;
let windowDragGestureExpiresAt = 0;
let isRestoringFromDock = false;
let dragGestureIdleTimer = null;

// Listen for window becoming visible or focused to handle "safe" restoration
appWindow.onFocusChanged(async ({ payload: focused }) => {
  if (focused && !isDockMinimizing && !isAnimating) {
    // If the window was just restored, move it to a safe position if it's too close to the bottom
    const monitor = await currentMonitor();
    if (!monitor) return;
    
    const winPos = await appWindow.outerPosition();
    const winSize = await appWindow.outerSize();
    const { work } = getMonitorBounds(monitor);
    const workBottom = work.y + work.height;
    const windowBottom = winPos.y + winSize.height;

    // If resting on the bottom edge (common after restoration), move it up slightly
    if (windowBottom >= workBottom - 2) {
      isRestoringFromDock = true;
      const safeY = workBottom - winSize.height - 20; // 20px "safety" gap above dock
      await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(winPos.x, Math.round(safeY)));
      
      // Briefly ignore move events to avoid immediate re-minimization
      setTimeout(() => {
        isRestoringFromDock = false;
      }, 500);
    }
  }
});

function getMonitorBounds(monitor) {
  const workArea = monitor.workArea ?? {
    position: monitor.position,
    size: monitor.size
  };

  return {
    full: {
      x: monitor.position.x,
      y: monitor.position.y,
      width: monitor.size.width,
      height: monitor.size.height
    },
    work: {
      x: workArea.position.x,
      y: workArea.position.y,
      width: workArea.size.width,
      height: workArea.size.height
    }
  };
}

let dragStartMonitor = null;
let dragStartSize = null;

async function beginWindowDragGesture() {
  isWindowDragGesture = true;
  windowDragGestureExpiresAt = Date.now() + DRAG_GESTURE_IDLE_END_MS;
  if (dragGestureIdleTimer != null) {
    clearTimeout(dragGestureIdleTimer);
    dragGestureIdleTimer = null;
  }
  void suppressEyeMessageBubble();
  
  try {
    dragStartMonitor = await currentMonitor();
    dragStartSize = await appWindow.outerSize();
  } catch (e) {
    console.error('Failed to cache drag state:', e);
  }
}

function endWindowDragGesture() {
  if (dragGestureIdleTimer != null) {
    clearTimeout(dragGestureIdleTimer);
    dragGestureIdleTimer = null;
  }
  isWindowDragGesture = false;
  windowDragGestureExpiresAt = 0;
  dragStartMonitor = null;
  dragStartSize = null;
}

function refreshWindowDragGesture() {
  if (!isWindowDragGesture) return;
  windowDragGestureExpiresAt = Date.now() + DRAG_GESTURE_IDLE_END_MS;
  if (dragGestureIdleTimer != null) {
    clearTimeout(dragGestureIdleTimer);
  }
  dragGestureIdleTimer = setTimeout(() => {
    dragGestureIdleTimer = null;
    endWindowDragGesture();
  }, DRAG_GESTURE_IDLE_END_MS);
}

function isNativeEdgeSnapActive(monitor, winPos, winSize) {
  if (!monitor || !winPos || !winSize) return false;

  const { full, work } = getMonitorBounds(monitor);
  const topGap = Math.abs(winPos.y - full.y);
  const leftGap = Math.abs(winPos.x - full.x);
  const rightGap = Math.abs((full.x + full.width) - (winPos.x + winSize.width));
  const widthRatio = work.width > 0 ? winSize.width / work.width : 0;
  const heightRatio = work.height > 0 ? winSize.height / work.height : 0;

  const isTopSnap =
    topGap <= NATIVE_EDGE_SNAP_THRESHOLD &&
    widthRatio >= NATIVE_TOP_SNAP_MIN_WIDTH_RATIO &&
    heightRatio >= NATIVE_EDGE_SNAP_MIN_HEIGHT_RATIO;

  const isSideSnap =
    (leftGap <= NATIVE_EDGE_SNAP_THRESHOLD || rightGap <= NATIVE_EDGE_SNAP_THRESHOLD) &&
    widthRatio >= NATIVE_SIDE_SNAP_MIN_WIDTH_RATIO &&
    heightRatio >= NATIVE_EDGE_SNAP_MIN_HEIGHT_RATIO;

  return isTopSnap || isSideSnap;
}

async function restoreExpandedStateFromNativeEdgeSnap() {
  clearTimeout(collapseTimer);

  const wasCollapsed = appElement.classList.contains('collapsed-y') || appElement.classList.contains('collapsed-x');
  if (!wasCollapsed) return;

  playCollapseExpandSound();

  isPeeking = false;
  appElement.classList.remove('peeking', 'peeking-y', 'peeking-x');
  clearTimeout(peekTimeout);

  clearEyeMessageAnimationTimers();
  await hideEyeMessageOverlay();

  document.querySelectorAll('.eye-bubble').forEach((bubble) => {
    bubble.classList.remove('visible', 'burst-out');
    bubble.classList.add('hidden');
  });

  appElement.classList.remove('bubble-active', 'collapsed-y', 'collapsed-x', 'collapsed-left', 'collapsed-right');
  updateNavbarTitle(getCurrentViewTitle());
  if (isInFocusMode) showNavbarTimer();
  else hideNavbarTimer();

  lastExpandTime = Date.now();
}

async function moveWindowIntoVisibleWorkArea(providedMonitor, providedPos, providedSize) {
  const monitor = providedMonitor || await currentMonitor();
  if (!monitor) return null;

  const { work } = getMonitorBounds(monitor);
  const currentPos = providedPos || await appWindow.outerPosition();
  const currentSize = providedSize || await appWindow.outerSize();

  const maxX = work.x + Math.max(0, work.width - currentSize.width);
  const maxY = work.y + Math.max(0, work.height - currentSize.height);

  const newX = Math.min(Math.max(currentPos.x, work.x), maxX);
  const newY = Math.min(Math.max(currentPos.y, work.y), maxY);

  if (newX !== currentPos.x || newY !== currentPos.y) {
    await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(newX, newY));
  }

  lastNormalPosition = { x: newX, y: newY };

  return {
    x: newX,
    y: newY,
    width: currentSize.width,
    height: currentSize.height,
    workBottom: work.y + work.height
  };
}

async function minimizeIntoDockFromBottomEdge(providedMonitor, providedPos, providedSize) {
  if (isDockMinimizing || isAnimating) return false;
  if (await appWindow.isMinimized()) return true;

  isDockMinimizing = true;
  endWindowDragGesture();

  try {
    isPeeking = false;
    appElement.classList.remove('peeking', 'peeking-y', 'peeking-x');
    clearTimeout(peekTimeout);

    // Removed moveWindowIntoVisibleWorkArea to allow native macOS genie effect to trigger correctly
    // from the window's actual position towards the dock.
    await appWindow.minimize();
    return true;
  } catch (error) {
    console.error('Failed to minimize window into dock:', error);
    return false;
  } finally {
    setTimeout(() => {
      isDockMinimizing = false;
    }, 250);
  }
}

// Animation Helper - Animates both position and size simultaneously
async function animateWindowTransform(startPos, endPos, startSize, endSize, duration = 350) {
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
    let lastW = Math.round(pStartSize.width);
    let lastH = Math.round(pStartSize.height);
    let lastX = Math.round(startPos.x);
    let lastY = Math.round(startPos.y);
    let isApplying = false;

    function step() {
      const now = performance.now();
      const progress = Math.min((now - startTime) / duration, 1);

      if (progress < 1) {
        requestAnimationFrame(step);
        
        if (isApplying) return; // Drop frame to prevent IPC stuttering

        // Quartic ease out for a much smoother, snappier feel
        const ease = 1 - Math.pow(1 - progress, 4);

        const targetW = Math.round(pStartSize.width + (pEndSize.width - pStartSize.width) * ease);
        const targetH = Math.round(pStartSize.height + (pEndSize.height - pStartSize.height) * ease);
        const targetX = Math.round(startPos.x + (endPos.x - startPos.x) * ease);
        const targetY = Math.round(startPos.y + (endPos.y - startPos.y) * ease);

        const promises = [];
        if (targetW !== lastW || targetH !== lastH) {
          promises.push(appWindow.setSize(new PhysicalSize(targetW, targetH)));
          lastW = targetW;
          lastH = targetH;
        }
        if (targetX !== lastX || targetY !== lastY) {
          promises.push(appWindow.setPosition(new PhysicalPosition(targetX, targetY)));
          lastX = targetX;
          lastY = targetY;
        }

        if (promises.length > 0) {
          isApplying = true;
          Promise.all(promises).finally(() => {
            isApplying = false;
          });
        }
      } else {
        // Final frame guarantee
        Promise.all([
          appWindow.setSize(new PhysicalSize(Math.round(pEndSize.width), Math.round(pEndSize.height))),
          appWindow.setPosition(new PhysicalPosition(Math.round(endPos.x), Math.round(endPos.y)))
        ]).finally(() => {
          isAnimating = false;
          resolve();
        });
      }
    }
    requestAnimationFrame(step);
  });
}

async function animateWindowSize(startSize, endSize, duration = 350) {
  isAnimating = true;
  const startTime = performance.now();
  const { LogicalSize, PhysicalSize } = window.__TAURI__.window;

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
    let lastW = Math.round(pStartSize.width);
    let lastH = Math.round(pStartSize.height);
    let isApplying = false;

    function step() {
      const now = performance.now();
      const progress = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4);
      const targetW = Math.round(pStartSize.width + (pEndSize.width - pStartSize.width) * ease);
      const targetH = Math.round(pStartSize.height + (pEndSize.height - pStartSize.height) * ease);

      if (progress < 1) {
        requestAnimationFrame(step);
        if (isApplying || (targetW === lastW && targetH === lastH)) return;

        isApplying = true;
        lastW = targetW;
        lastH = targetH;
        appWindow.setSize(new PhysicalSize(targetW, targetH)).finally(() => {
          isApplying = false;
        });
      } else {
        appWindow.setSize(new PhysicalSize(Math.round(pEndSize.width), Math.round(pEndSize.height))).finally(() => {
          isAnimating = false;
          resolve();
        });
      }
    }

    requestAnimationFrame(step);
  });
}

async function toggleCollapseY(isManualDrag = false) {
  if (isAnimating) return;
  playCollapseExpandSound();
  isAnimating = true;
  try {
    const isCurrentlyCollapsed = appElement.classList.contains('collapsed-y') || appElement.classList.contains('collapsed-x');
    const isCollapsing = !appElement.classList.contains('collapsed-y');

    if (isManualDrag) {
      isPeeking = false;
      appElement.classList.remove('peeking', 'peeking-y', 'peeking-x');
    }

    if (isCollapsing) {
      // COLLAPSE FLOW
      appElement.classList.remove('collapsed-reminder-active');

      try {
        if (!isCurrentlyCollapsed) {
          lastNormalPosition = await appWindow.outerPosition();
        }
      } catch (e) {
        console.error('Failed to capture position:', e);
      }

      appElement.classList.remove('collapsed-x', 'collapsed-left', 'collapsed-right');
      appElement.classList.add('collapsed-y');

      // Update UI immediately (fade out content, show title)
      updateNavbarTitle(getCurrentViewTitle());
      if (isInFocusMode) {
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
            500
          );
          
          // Trigger the "I see you" bubble shortly after collapsing (only if still collapsed; cancelled on hover/drag/expand)
          eyeMessageScheduleTimer = setTimeout(() => {
            eyeMessageScheduleTimer = null;
            showEyeMessage();
          }, 600);
        }
      } catch (error) {
        console.error('Failed to transform window vertically:', error);
      }
    } else {
      // EXPAND FLOW
      try {
        await suppressEyeMessageBubble();
        // 1. Reveal content immediately
        appElement.classList.remove('collapsed-y', 'collapsed-left', 'collapsed-right');
        updateNavbarTitle(getCurrentViewTitle());
        hideNavbarTimer();

        if (isManualDrag) {
          const monitor = await currentMonitor();
          if (monitor) {
            const currentPos = await appWindow.outerPosition();
            const currentSize = await appWindow.outerSize();
            
            // Growing DOWNWARDS from top
            let endY = offsetY;
            if (lastNormalPosition && !isPeeking) {
              endY = lastNormalPosition.y;
            }

            const endPos = { x: currentPos.x, y: Math.round(endY) };

            // Use a faster animation for manual drag (150ms) instead of a jump for seamless flow
            await animateWindowTransform(currentPos, endPos, currentSize, ALL_WINDOWS_SIZE, 250);
            lastExpandTime = Date.now();
            return;
          }
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
            500
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
  playCollapseExpandSound();
  isAnimating = true;
  try {
    const isCurrentlyCollapsed = appElement.classList.contains('collapsed-y') || appElement.classList.contains('collapsed-x');
    const isCollapsing = !appElement.classList.contains('collapsed-x');

    if (isManualDrag) {
      isPeeking = false;
      appElement.classList.remove('peeking', 'peeking-y', 'peeking-x');
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

      updateNavbarTitle(getCurrentViewTitle());
      if (isInFocusMode) {
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

          // Track which side we are collapsed to for UI adjustments (like title orientation)
          if (distLeft < distRight) {
            appElement.classList.add('collapsed-left');
            appElement.classList.remove('collapsed-right');
          } else {
            appElement.classList.add('collapsed-right');
            appElement.classList.remove('collapsed-left');
          }

          // Animate both size and position simultaneously
          await animateWindowTransform(
            currentPos,
            { x: newX, y: currentPos.y },
            currentSize,
            COLLAPSED_SIZE_X,
            500
          );

          // Trigger the "I see you" bubble shortly after collapsing (only if still collapsed; cancelled on hover/drag/expand)
          eyeMessageScheduleTimer = setTimeout(() => {
            eyeMessageScheduleTimer = null;
            showEyeMessage();
          }, 600);

          if (isNotificationActive) {
            showSideNotification();
          }
        }
      } catch (error) {
        console.error('Failed to transform window to side:', error);
      }
    } else {
      // EXPAND FLOW
      try {
        await suppressEyeMessageBubble();
        appElement.classList.remove('collapsed-x', 'collapsed-left', 'collapsed-right');
        updateNavbarTitle(getCurrentViewTitle());
        hideNavbarTimer();

        if (isManualDrag) {
          try {
            const monitor = await currentMonitor();
            if (monitor) {
              const currentPos = await appWindow.outerPosition();
              const currentSize = await appWindow.outerSize();
              const { width: scrW } = monitor.size;
              const { x: offsetX } = monitor.position;
              const scale = monitor.scaleFactor;
              const expandedPhysicalW = ALL_WINDOWS_SIZE.width * scale;

              // Smart position: if at right, grow LEFTWARDS; if at left, grow RIGHTWARDS
              const isNearRight = Math.abs((offsetX + scrW) - (currentPos.x + currentSize.width)) < 25;
              let endX = currentPos.x;
              if (isNearRight) {
                endX = (offsetX + scrW) - expandedPhysicalW;
              } else if (Math.abs(currentPos.x - offsetX) < 25) {
                endX = offsetX;
              }

              const endPos = { x: Math.round(endX), y: currentPos.y };
              // Use a faster animation for manual drag (150ms) instead of a jump for seamless flow
              await animateWindowTransform(currentPos, endPos, currentSize, ALL_WINDOWS_SIZE, 250);
            }
          } catch (e) {
            await appWindow.setSize(ALL_WINDOWS_SIZE);
          }
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
            500
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
    .filter(([noteId, note]) => hasNoteContent(note))
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt); // Newest first

  const activeTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed)
                              .sort((a, b) => b.completedAt - a.completedAt);

  renderHistory(completedTasks);

  let renderedCount = 0;

  // Prepare a unified list for the 'all' filter, or specific lists for others
  let displayItems = [];

  if (currentFilter === 'tasks') {
    activeTasks.sort((a, b) => {
      if (a.due === null && b.due === null) return 0;
      if (a.due === null) return 1;
      if (b.due === null) return -1;
      return new Date(a.due) - new Date(b.due);
    });
    displayItems = activeTasks.map(t => ({ type: 'task', data: t }));
  } else if (currentFilter === 'notes') {
    displayItems = savedNotes.map(n => ({ 
      type: 'note', 
      data: n[1], 
      id: n[0],
      timestamp: n[1].updatedAt || 0 
    }));
  } else {
    // 'all' filter: merge and sort by the most recent timestamp
    const taskItems = activeTasks.map(t => ({ 
      type: 'task', 
      data: t, 
      timestamp: t.createdAt || 0 
    }));
    const noteItems = savedNotes.map(n => ({ 
      type: 'note', 
      data: n[1], 
      id: n[0],
      timestamp: n[1].updatedAt || 0 
    }));
    
    displayItems = [...taskItems, ...noteItems].sort((a, b) => b.timestamp - a.timestamp);
  }

  displayItems.forEach((item) => {
    if (item.type === 'task') {
      const task = item.data;
      const taskIndex = tasks.indexOf(task);
      const li = document.createElement('li');
      const hasDeadline = task.due !== null;
      const dueDate = hasDeadline ? new Date(task.due) : null;
      const now = new Date();
      const isUrgent = !task.completed && hasDeadline && (dueDate - now < 10 * 60 * 1000);
      li.className = `task-item ${isUrgent ? 'urgent' : ''}`;

      let dueText = '';
      if (task.completed) {
        dueText = 'Completed';
      } else if (!hasDeadline) {
        dueText = '<span style="font-size: 1.4em; line-height: 1; margin-right: 2px;">∞</span> Plenty of time';
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

      const stopBubbling = (e) => e.stopPropagation();
      li.querySelector('.task-checkbox').addEventListener('click', stopBubbling);
      li.querySelector('.task-checkbox').addEventListener('dblclick', stopBubbling);
      li.querySelector('.delete-task-btn').addEventListener('dblclick', stopBubbling);

      li.querySelector('.task-checkbox').addEventListener('change', async (e) => {
        if (e.target.checked) {
          li.classList.add('task-completing');
          setTimeout(() => showCongrats(task.totalWorkTime || 0), 500);
          setTimeout(async () => {
            task.completed = true;
            task.completedAt = Date.now();
            await saveTasks();
            renderTasks();
            const historyBtn = document.getElementById('history-btn');
            if (historyBtn) {
              setTimeout(() => {
                historyBtn.classList.add('history-uplift');
                setTimeout(() => historyBtn.classList.remove('history-uplift'), 600);
              }, 50);
            }
          }, 700);
        }
      });

      li.querySelector('.delete-task-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const shouldDelete = await requestDeleteConfirmation('task');
        if (!shouldDelete) return;
        tasks.splice(taskIndex, 1);
        saveTasks();
        renderTasks();
      });

      // Right click to delete
      li.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const shouldDelete = await requestDeleteConfirmation('task');
        if (!shouldDelete) return;
        tasks.splice(taskIndex, 1);
        saveTasks();
        renderTasks();
      });

      li.addEventListener('click', () => {
        if (!task.completed) {
          enterFocusMode(task);
        }
      });

      taskList.appendChild(li);
    } else {
      // Note item
      const noteId = item.id;
      const note = item.data;
      const li = document.createElement('li');
      li.className = `task-item note-entry note-entry-${note.theme || 1}`;

      const swatch = document.createElement('span');
      swatch.className = 'note-entry-swatch';

      const info = document.createElement('div');
      info.className = 'task-info';

      const title = document.createElement('div');
      title.className = 'task-title note-entry-title';
      title.textContent = (note.title.trim() || 'Untitled note').replace(/\s+/g, ' ').slice(0, 72);

      const subtitle = document.createElement('div');
      subtitle.className = 'task-due note-entry-subtitle';
      const bodyPreview = (note.body || '').trim().split('\n')[0];
      subtitle.textContent = bodyPreview || 'Click to start writing... ✍️';

      const deleteNoteBtn = document.createElement('button');
      deleteNoteBtn.className = 'delete-note-btn';
      deleteNoteBtn.title = 'Delete note';
      deleteNoteBtn.textContent = '×';

      info.appendChild(title);
      info.appendChild(subtitle);
      li.appendChild(swatch);
      li.appendChild(info);
      li.appendChild(deleteNoteBtn);

      const stopBubbling = (e) => e.stopPropagation();
      deleteNoteBtn.addEventListener('dblclick', stopBubbling);

      deleteNoteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const shouldDelete = await requestDeleteConfirmation('note');
        if (!shouldDelete) return;
        delete noteDrafts[noteId];
        await persistNotesDrafts();
        renderTasks();
      });

      li.addEventListener('click', () => {
        const themeId = note.theme || 1;
        const noteTab = document.querySelector(`.task-note-tab.note-${themeId}`);
        if (noteTab) openNote(noteTab, noteId);
      });

      taskList.appendChild(li);
    }
    renderedCount++;
  });

  if (renderedCount === 0) {
    let emptyText = 'No tasks or notes yet.';
    if (currentFilter === 'tasks') emptyText = 'No tasks yet.';
    else if (currentFilter === 'notes') emptyText = 'No saved notes yet.';

    taskList.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 32px; margin-bottom: 10px; opacity: 0.3;">✨</div>
        <p>${emptyText}</p>
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
const filterBtns = document.querySelectorAll('.filter-btn');
const filterPill = document.getElementById('filter-pill');
const taskReminderBtn = document.getElementById('task-reminder-btn');
const reminderDropdown = document.getElementById('reminder-dropdown');

const NOTES_STORAGE_KEY = 'flowpane-notes-drafts';
const DELETE_CONFIRM_PREF_KEY = 'flowpane-skip-delete-confirm';
let activeNoteId = null;
let currentFilter = 'all';
let noteDrafts = {};
let skipDeleteConfirm = false;

function extractNoteId(tab) {
  const noteClass = [...tab.classList].find(c => /^note-\d+$/.test(c));
  return noteClass ? noteClass.split('-')[1] : null;
}

if (taskReminderBtn && reminderDropdown) {
  taskReminderBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    // Restriction: Cannot add reminder without a deadline
    if (!hasUserModifiedDate) {
      inputArea.classList.add('expanded'); // Ensure deadline area is visible
      taskReminderBtn.classList.add('shake');
      const warning = document.getElementById('reminder-warning');
      const dueContainer = document.getElementById('due-container');

      
      if (warning) {
        warning.classList.remove('hidden');
        if (dueContainer) dueContainer.classList.add('warning');
        
        setTimeout(() => {
          warning.classList.add('hidden');
          if (dueContainer) dueContainer.classList.remove('warning');
        }, 2000);
      }
      setTimeout(() => taskReminderBtn.classList.remove('shake'), 400);
      return;
    }



    const isHidden = reminderDropdown.classList.contains('hidden');
    if (isHidden) {
      reminderDropdown.classList.remove('hidden');
      taskReminderBtn.classList.add('active');
    } else {
      reminderDropdown.classList.add('hidden');
      taskReminderBtn.classList.remove('active');
    }
  });


  document.addEventListener('click', (e) => {
    if (!reminderDropdown.classList.contains('hidden') && 
        !reminderDropdown.contains(e.target) && 
        e.target !== taskReminderBtn && 
        !taskReminderBtn.contains(e.target)) {
      reminderDropdown.classList.add('hidden');
      taskReminderBtn.classList.remove('active');
      const unitMenu = document.getElementById('reminder-unit-menu');
      if (unitMenu) unitMenu.classList.add('hidden');
    }
  });

  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !reminderDropdown.classList.contains('hidden')) {
      reminderDropdown.classList.add('hidden');
      taskReminderBtn.classList.remove('active');
    }
  });

  // Handle reminder option clicks
  reminderDropdown.querySelectorAll('.reminder-option:not(.custom-trigger)').forEach(option => {
    option.addEventListener('click', () => {
      const minutes = parseInt(option.dataset.value);
      selectedReminderMinutes = minutes;
      
      // Update visual state
      reminderDropdown.querySelectorAll('.reminder-option').forEach(btn => btn.classList.remove('active'));
      option.classList.add('active');
      
      // Close dropdown
      setTimeout(() => {
        reminderDropdown.classList.add('hidden');
        taskReminderBtn.classList.remove('active');
        taskReminderBtn.classList.add('has-reminder');
      }, 300);
    });
  });

  // Handle None button
  const noneBtn = document.getElementById('reminder-none-btn');
  if (noneBtn) {
    noneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedReminderMinutes = null;
      taskReminderBtn.classList.remove('has-reminder');
      reminderDropdown.querySelectorAll('.reminder-option').forEach(btn => btn.classList.remove('active'));
      reminderDropdown.classList.add('hidden');
      taskReminderBtn.classList.remove('active');
    });
  }

  // Handle Custom trigger
  const customTrigger = document.getElementById('reminder-custom-trigger');
  const customInputWrap = document.getElementById('reminder-custom-input-wrap');
  if (customTrigger && customInputWrap) {
    customTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      customTrigger.classList.add('hidden');
      customInputWrap.classList.remove('hidden');
      const input = document.getElementById('reminder-custom-input');
      if (input) input.focus();
    });
  }

  // Handle Custom Set
  const customSetBtn = document.getElementById('reminder-custom-set');
  if (customSetBtn) {
    const customInput = document.getElementById('reminder-custom-input');

    if (customInput) {
      customInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        customSetBtn.click();
      });
    }

    customSetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = document.getElementById('reminder-custom-input');
      const val = parseInt(input.value);
      const unit = document.getElementById('reminder-unit-toggle').dataset.unit;
      
      if (val && val > 0) {
        let minutes = val;
        if (unit === 'h') minutes *= 60;
        else if (unit === 'd') minutes *= 1440;
        
        selectedReminderMinutes = minutes;

        taskReminderBtn.classList.add('has-reminder');

        reminderDropdown.classList.add('hidden');
        taskReminderBtn.classList.remove('active');
        // Reset UI for next time
        customTrigger.classList.remove('hidden');
        customInputWrap.classList.add('hidden');
        input.value = '';
        const unitToggle = document.getElementById('reminder-unit-toggle');
        if (unitToggle) {
          unitToggle.dataset.unit = 'm';
          const textSpan = unitToggle.querySelector('.unit-toggle-text');
          if (textSpan) textSpan.textContent = 'min';
        }
        const unitMenu = document.getElementById('reminder-unit-menu');
        if (unitMenu) {
          unitMenu.querySelectorAll('.unit-opt').forEach(btn => btn.classList.remove('active'));
          const defaultOpt = unitMenu.querySelector('[data-unit="m"]');
          if (defaultOpt) defaultOpt.classList.add('active');
        }
        taskInput.focus();
      }
    });
  }

  // Handle Units
  const unitToggle = document.getElementById('reminder-unit-toggle');
  const unitMenu = document.getElementById('reminder-unit-menu');
  if (unitToggle && unitMenu) {
    unitToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      unitMenu.classList.toggle('hidden');
    });

    unitMenu.querySelectorAll('.unit-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const unit = opt.dataset.unit;
        
        // Update selection state
        unitToggle.dataset.unit = unit;
        const textSpan = unitToggle.querySelector('.unit-toggle-text');
        const unitLabel = unit === 'm' ? 'min' : (unit === 'h' ? 'hrs' : 'days');
        if (textSpan) textSpan.textContent = unitLabel;
        
        // Update checkmarks
        unitMenu.querySelectorAll('.unit-opt').forEach(btn => btn.classList.remove('active'));
        opt.classList.add('active');
        
        unitMenu.classList.add('hidden');
      });
    });
  }
}

let reminderPopupAutoCloseTimer = null;
let reminderPopupCloseHandler = null;
let topCollapsedReminderAnimation = Promise.resolve();
const reminderTone = new Audio('assets/due_reminder_tone.mp3');
reminderTone.preload = 'auto';

const collapseExpandTone = new Audio('assets/collapse:expand_tone.mp3');
collapseExpandTone.preload = 'auto';

const taskCreateTone = new Audio('assets/task_create_tone.mp3');
taskCreateTone.preload = 'auto';

const taskActivationTone = new Audio('assets/task_activation.mp3');
taskActivationTone.preload = 'auto';
taskActivationTone.volume = 1.0; // Ensure full volume

const taskDeleteTone = new Audio('assets/task_delete_tone.mp3');
taskDeleteTone.preload = 'auto';

const fallbackDeleteTone = new Audio('assets/fallback_delete_tone.mp3');
fallbackDeleteTone.preload = 'auto';

const timesUpTone = new Audio('assets/times_up_tone.mp3');
timesUpTone.preload = 'auto';

function playReminderTone() {
  reminderTone.currentTime = 0;
  reminderTone.play().catch(() => {});
}

function playCollapseExpandSound() {
  collapseExpandTone.currentTime = 0;
  collapseExpandTone.play().catch(() => {});
}

function playTaskCreateSound() {
  taskCreateTone.currentTime = 0;
  taskCreateTone.play().catch(() => {});
}

function playTaskActivationSound() {
  taskActivationTone.currentTime = 0;
  taskActivationTone.play().catch(() => {});
}

function playTaskDeleteSound() {
  taskDeleteTone.currentTime = 0;
  taskDeleteTone.play().catch(() => {});
}

function playFallbackDeleteSound() {
  fallbackDeleteTone.currentTime = 0;
  fallbackDeleteTone.play().catch(() => {});
}

function playTimesUpSound() {
  timesUpTone.currentTime = 0;
  timesUpTone.play().catch(() => {});
}

function isTopCollapsedReminderMode() {
  return appElement.classList.contains('collapsed-y')
    && !appElement.classList.contains('peeking');
}

function queueTopCollapsedReminderAnimation(action) {
  topCollapsedReminderAnimation = topCollapsedReminderAnimation
    .catch(() => {})
    .then(action);

  return topCollapsedReminderAnimation;
}

async function expandTopCollapsedReminder() {
  if (!isTopCollapsedReminderMode()) return;

  clearTimeout(peekTimeout);
  appElement.classList.remove('collapsed-reminder-revealed');
  appElement.classList.add('collapsed-reminder-active');
  void suppressEyeMessageBubble();

  return queueTopCollapsedReminderAnimation(async () => {
    if (!isTopCollapsedReminderMode()) {
      appElement.classList.remove('collapsed-reminder-active');
      return;
    }

    try {
      const currentSize = await appWindow.outerSize();
      await animateWindowSize(currentSize, COLLAPSED_REMINDER_SIZE_Y, 620);
    } catch (error) {
      console.error('Failed to expand collapsed reminder:', error);
      await appWindow.setSize(COLLAPSED_REMINDER_SIZE_Y);
    }
  });
}

async function restoreTopCollapsedReminder() {
  if (!appElement.classList.contains('collapsed-reminder-active')) return;

  return queueTopCollapsedReminderAnimation(async () => {
    appElement.classList.remove('collapsed-reminder-revealed');
    appElement.classList.remove('collapsed-reminder-active');

    try {
      const currentSize = await appWindow.outerSize();
      await animateWindowSize(currentSize, COLLAPSED_SIZE_Y, 520);
      await appWindow.setSize(COLLAPSED_SIZE_Y);
      const monitor = await currentMonitor();
      if (monitor && appElement.classList.contains('collapsed-y')) {
        const currentPos = await appWindow.outerPosition();
        await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(currentPos.x, monitor.position.y));
      }
    } catch (error) {
      console.error('Failed to collapse reminder notification:', error);
      await appWindow.setSize(COLLAPSED_SIZE_Y);
    }
  });
}

function showReminderPopup(task, minutesBefore) {
  const popup = document.getElementById('reminder-popup');
  const title = document.getElementById('reminder-task-title');
  const timeText = document.getElementById('reminder-task-time');
  const closeBtn = document.getElementById('reminder-close-btn');

  if (!popup || !title || !timeText || !closeBtn) return;

  title.textContent = task.title;
  
  let timeDesc = '';
  if (minutesBefore >= 1440) {
    const days = Math.floor(minutesBefore / 1440);
    timeDesc = `${days} day${days > 1 ? 's' : ''}`;
  } else if (minutesBefore >= 60) {
    const hrs = Math.floor(minutesBefore / 60);
    timeDesc = `${hrs} hour${hrs > 1 ? 's' : ''}`;
  } else {
    timeDesc = `${minutesBefore} minute${minutesBefore > 1 ? 's' : ''}`;
  }
  
  timeText.textContent = `Only ${timeDesc} left`;
  suppressEyeMessageBubble(); // Hide any active eye guide bubble

  const shouldUseTopCollapsedReminder = isTopCollapsedReminderMode();
  if (shouldUseTopCollapsedReminder) {
    void expandTopCollapsedReminder().then(() => {
      if (!popup.classList.contains('hidden') && appElement.classList.contains('collapsed-reminder-active')) {
        appElement.classList.add('collapsed-reminder-revealed');
      }
    });
  } else if (appElement.classList.contains('collapsed-x')) {
    showSideNotification();
    showSideNotificationBubble('task due<br>soon');
  }

  popup.classList.remove('hidden');
  popup.setAttribute('aria-hidden', 'false');
  playReminderTone();

  if (reminderPopupCloseHandler) {
    closeBtn.removeEventListener('click', reminderPopupCloseHandler);
  }
  if (reminderPopupAutoCloseTimer != null) {
    clearTimeout(reminderPopupAutoCloseTimer);
    reminderPopupAutoCloseTimer = null;
  }

  const closePopup = () => {
    popup.classList.add('hidden');
    popup.setAttribute('aria-hidden', 'true');
    closeBtn.removeEventListener('click', closePopup);
    reminderPopupCloseHandler = null;
    clearSideNotification(); // Clear bell and glow when dismissed
    if (shouldUseTopCollapsedReminder) {
      appElement.classList.remove('collapsed-reminder-revealed');
      setTimeout(() => {
        void restoreTopCollapsedReminder();
      }, 240);
    }
    if (reminderPopupAutoCloseTimer != null) {
      clearTimeout(reminderPopupAutoCloseTimer);
      reminderPopupAutoCloseTimer = null;
    }
  };

  reminderPopupCloseHandler = closePopup;
  closeBtn.addEventListener('click', closePopup);
  
  // Auto-close after 5 minutes if not clicked.
  reminderPopupAutoCloseTimer = setTimeout(closePopup, 300000);
}

function checkReminders() {
  const now = Date.now();
  let changed = false;

  tasks.forEach(task => {
    if (task.completed || !task.due || task.reminded || !task.reminderMinutes) return;

    const dueDate = new Date(task.due).getTime();
    const reminderTime = dueDate - (task.reminderMinutes * 60 * 1000);

    if (now >= reminderTime) {
      showReminderPopup(task, task.reminderMinutes);
      task.reminded = true;
      changed = true;
    }
  });

  if (changed) {
    saveTasks();
  }
}

// Check reminders every 1 second (increased from 10s for maximum precision)
setInterval(checkReminders, 1000);


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
      body: typeof rawEntry.body === 'string' ? rawEntry.body : '',
      theme: rawEntry.theme || 1,
      updatedAt: rawEntry.updatedAt || Date.now()
    };
  }

  if (typeof rawEntry === 'string') {
    const lines = rawEntry.split(/\r?\n/);
    const title = lines[0] || '';
    const body = lines.slice(1).join('\n');
    return { title, body, theme: 1, updatedAt: Date.now() };
  }

  return { title: '', body: '', theme: 1, updatedAt: Date.now() };
}

function hasNoteContent(note) {
  if (!note) return false;
  return note.title.trim().length > 0 || note.body.trim().length > 0;
}

function clearActiveTabState() {
  noteTabs.forEach(tab => tab.classList.remove('note-active'));
}

function getActiveNoteTab() {
  if (!activeNoteId || !noteDrafts[activeNoteId]) return null;
  const themeId = noteDrafts[activeNoteId].theme || 1;
  return document.querySelector(`.task-note-tab.note-${themeId}`);
}

function openNote(tab, noteId, themeIdSuggestion) {
  if (!notesWorkspace || !notesTitleInput || !notesBodyEditor) return;

  const note = normalizeNoteEntry(noteDrafts[noteId]);
  if (themeIdSuggestion) note.theme = themeIdSuggestion;
  
  const themeId = note.theme || 1;

  notesWorkspace.classList.remove('theme-1', 'theme-2', 'theme-3', 'theme-4');
  notesWorkspace.classList.add(`theme-${themeId}`);
  appElement.classList.remove('theme-1', 'theme-2', 'theme-3', 'theme-4');
  appElement.classList.add(`theme-${themeId}`);
  notesWorkspace.classList.remove('hidden');
  setNotesRevealOrigin(tab);

  requestAnimationFrame(() => {
    notesWorkspace.classList.add('active');
  });
  appElement.classList.add('notes-active');

  activeNoteId = noteId;
  clearActiveTabState();
  tab.classList.add('note-active');
  
  noteDrafts[noteId] = note; // Ensure theme and updatedAt are stored
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

  // Sync navbar title immediately when opening note
  updateNavbarTitle(getCurrentViewTitle());
}

function closeNote(tab) {
  if (!notesWorkspace) return;
  setNotesRevealOrigin(tab);
  activeNoteId = null;
  clearActiveTabState();
  notesWorkspace.classList.remove('active');
  appElement.classList.remove('notes-active');
  appElement.classList.remove('theme-1', 'theme-2', 'theme-3', 'theme-4');

  // Reset title to FlowPane when closing note
  updateNavbarTitle('FlowPane');
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
  const currentTheme = noteDrafts[activeNoteId] ? noteDrafts[activeNoteId].theme : 1;

  if (title.trim().length === 0 && body.trim().length === 0) {
    delete noteDrafts[activeNoteId];
  } else {
    noteDrafts[activeNoteId] = {
      title,
      body,
      theme: currentTheme,
      updatedAt: Date.now()
    };
  }
  
  renderTasks();

  // Sync navbar title in real-time
  updateNavbarTitle(getCurrentViewTitle());

  if (noteAutoSaveTimeout) clearTimeout(noteAutoSaveTimeout);
  noteAutoSaveTimeout = setTimeout(async () => {
    await persistNotesDrafts();
  }, 500);
}

function goToHomeView() {
  if (activeNoteId) closeActiveNote();
  if (isInFocusMode) exitFocusMode();
  if (isHistoryOpen) toggleHistory();
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
    const themeId = extractNoteId(tab);
    if (!themeId) return;

    if (activeNoteId && noteDrafts[activeNoteId]) {
      if (String(noteDrafts[activeNoteId].theme) === String(themeId) && notesWorkspace.classList.contains('active')) {
        closeNote(tab);
        return;
      }
    }

    // Always create a new unique ID for tab clicks to start fresh
    const newNoteId = 'note_' + Date.now();
    openNote(tab, newNoteId, themeId);
  });
});

function capitalizeFirstLetter(e) {
  const input = e.target;
  const val = input.value;
  // Only auto-capitalize when typing the very first character of an empty field
  if (val && val.length === 1 && val[0] !== val[0].toUpperCase()) {
    input.value = val[0].toUpperCase();
  }
}

if (taskInput) {
  taskInput.addEventListener('input', capitalizeFirstLetter);
}

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

function updateFilterPill() {
  const activeBtn = document.querySelector('.filter-btn.active');
  if (activeBtn && filterPill) {
    filterPill.style.width = `${activeBtn.offsetWidth}px`;
    filterPill.style.transform = `translateX(${activeBtn.offsetLeft - 3}px)`; 
  }
}

function updateFilterUI(filterValue) {
  filterBtns.forEach(btn => {
    if (btn.getAttribute('data-filter') === filterValue) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  updateFilterPill();
}

filterBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentFilter = btn.getAttribute('data-filter');
    updateFilterUI(currentFilter);
    renderTasks();
  });
});

if (notesTitleInput && notesBodyEditor) {
  notesTitleInput.addEventListener('input', (e) => {
    capitalizeFirstLetter(e);
    autoSaveActiveNote();
  });
  notesBodyEditor.addEventListener('input', (e) => {
    capitalizeFirstLetter(e);
    autoSaveActiveNote();
  });

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
    // Prevent redirect to home if in focus/notes mode for better UX
    if (!isInFocusMode && !activeNoteId) {
      goToHomeView();
    }
  });

  link.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    // Same guard for key navigation
    if (!isInFocusMode && !activeNoteId) {
      goToHomeView();
    }
  });
});

document.querySelectorAll('.title-bar').forEach(titleBar => {
  titleBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, textarea, select, a')) return;
    beginWindowDragGesture();
  });
});

window.addEventListener('mouseup', endWindowDragGesture);
window.addEventListener('blur', endWindowDragGesture);

function scheduleHoverPeek(delay = HOVER_PEEK_DELAY_MS) {
  if (appElement.classList.contains('collapsed-reminder-active')) return;

  clearTimeout(peekTimeout);
  peekTimeout = setTimeout(async () => {
    if (appElement.classList.contains('collapsed-reminder-active')) return;
    if (isAnimating) {
      scheduleHoverPeek(HOVER_PEEK_RETRY_MS);
      return;
    }

    const isCollapsedY = appElement.classList.contains('collapsed-y');
    const isCollapsedX = appElement.classList.contains('collapsed-x');
    if ((!isCollapsedY && !isCollapsedX) || isPeeking) return;

    await suppressEyeMessageBubble();

    if (isAnimating) {
      scheduleHoverPeek(HOVER_PEEK_RETRY_MS);
      return;
    }

    const stillCollapsedY = appElement.classList.contains('collapsed-y');
    const stillCollapsedX = appElement.classList.contains('collapsed-x');
    if (!stillCollapsedY && !stillCollapsedX) return;

    isPeeking = true;
    peekMode = stillCollapsedY ? 'y' : 'x';
    appElement.classList.add('peeking', peekMode === 'y' ? 'peeking-y' : 'peeking-x');
    if (peekMode === 'y') toggleCollapseY();
    else toggleCollapseX();
  }, delay);
}

// Hover peek logic for collapsed windows - bridges from Rust polling for inactive window support
appWindow.listen('mouse-enter', () => {
  if (appElement.classList.contains('collapsed-reminder-active')) return;

  const isCollapsedY = appElement.classList.contains('collapsed-y');
  const isCollapsedX = appElement.classList.contains('collapsed-x');

  if ((isCollapsedY || isCollapsedX) && !isPeeking) {
    scheduleHoverPeek();
  }
});

appWindow.listen('mouse-leave', () => {
  clearTimeout(peekTimeout);
  
  const congratsModal = document.getElementById('congrats-modal');
  if (congratsModal && !congratsModal.classList.contains('hidden')) {
    congratsModal.classList.add('hidden');
    if (confettiAnimationId) {
      cancelAnimationFrame(confettiAnimationId);
    }
    const canvas = document.getElementById('confetti-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const inputArea = document.querySelector('.input-area');
    const notesIcons = document.querySelector('.task-notes-icons');
    if (inputArea) inputArea.classList.remove('hidden');
    if (notesIcons) notesIcons.classList.remove('hidden');
  }

  if (isPeeking) {
    if (!isAnimating) {
      isPeeking = false;
      appElement.classList.remove('peeking', 'peeking-y', 'peeking-x');
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
    hasUserModifiedDate = true;
    updateReminderBtnState();

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
  if (!taskInput.value.trim() && !hasUserModifiedDate) {
    dueInput.value = formatDateTimeHuman(new Date());
    hasUserModifiedDate = false;
    updateReminderBtnState();

  }
});

const DUE_BLOCKS = [
  { start: 0, end: 2, type: 'day', length: 2 },
  { start: 3, end: 5, type: 'month', length: 2 },
  { start: 6, end: 10, type: 'year', length: 4 },
  { start: 12, end: 14, type: 'hour', length: 2 },
  { start: 15, end: 17, type: 'minute', length: 2 },
  { start: 18, end: 20, type: 'period', length: 2 }
];

let activeDueBlockEdit = null;

function setDueSelection(block) {
  if (!block) return;
  dueInput.setSelectionRange(block.start, block.end);
}

function getDueBlockFromCursor(cursor) {
  return DUE_BLOCKS.find(({ start, end }) => cursor >= start && cursor <= end)
    || DUE_BLOCKS.find(({ start }) => cursor < start)
    || DUE_BLOCKS[DUE_BLOCKS.length - 1];
}

document.addEventListener('mousedown', (e) => {
  if (inputArea.classList.contains('expanded') && !taskInput.value.trim()) {
    const isTopSection = inputArea.contains(e.target) || e.target.closest('.title-bar');
    if (!isTopSection) {
      inputArea.classList.remove('expanded');
    }
  }
});

inputArea.addEventListener('focusout', (e) => {
  setTimeout(() => {
    if (!inputArea.contains(document.activeElement) && document.activeElement !== document.body && !taskInput.value.trim()) {
      inputArea.classList.remove('expanded');
    }
  }, 100);
});

taskInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    if (!taskInput.value.trim()) {
      const nameWarning = document.getElementById('name-warning');
      const inputShell = document.querySelector('.task-input-shell');

      if (nameWarning) {
        nameWarning.classList.remove('hidden');
        if (inputShell) inputShell.classList.add('warning');
        
        setTimeout(() => {
          nameWarning.classList.add('hidden');
          if (inputShell) inputShell.classList.remove('warning');
        }, 2000);
      }
      return;
    }
    addTask();
    inputArea.classList.remove('expanded');
    taskInput.blur();
  }
});

dueInput.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') return;
  hasUserModifiedDate = true;
  updateReminderBtnState();

  const cursor = dueInput.selectionStart;
  const selectionEnd = dueInput.selectionEnd;
  const val = dueInput.value;
  const block = getDueBlockFromSelection(cursor, selectionEnd);

  if (['ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(e.key)) {
    commitActiveDueBlockEdit();
    return;
  }

  // Handle Backspace
  if (e.key === 'Backspace') {
    e.preventDefault();

    if (activeDueBlockEdit && block && activeDueBlockEdit.block.type === block.type) {
      activeDueBlockEdit.raw = activeDueBlockEdit.raw.slice(0, -1);
      dueInput.value = setDueBlockValue(
        dueInput.value,
        block,
        formatDueBlockForEditing(block, activeDueBlockEdit.raw)
      );
      dueInput.setSelectionRange(block.start, block.end);
      return;
    }

    let pos = cursor - 1;
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

    if (!block || block.type === 'period') return;

    if (!activeDueBlockEdit || activeDueBlockEdit.block.type !== block.type) {
      commitActiveDueBlockEdit();
      activeDueBlockEdit = { block, raw: '' };
    }

    activeDueBlockEdit.raw = (activeDueBlockEdit.raw + e.key).slice(0, block.length);
    dueInput.value = setDueBlockValue(
      dueInput.value,
      block,
      formatDueBlockForEditing(block, activeDueBlockEdit.raw)
    );

    if (activeDueBlockEdit.raw.length >= block.length) {
      commitActiveDueBlockEdit();
      selectNextDueBlock(block);
    } else {
      dueInput.setSelectionRange(block.start, block.end);
    }

    return;
  }

  // Handle AM/PM
  if (/[apAP]/.test(e.key)) {
    e.preventDefault();
    commitActiveDueBlockEdit();
    const period = e.key.toUpperCase() === 'A' ? 'AM' : 'PM';
    dueInput.value = val.substring(0, 18) + period;
    dueInput.setSelectionRange(18, 20);
    return;
  }

  // Block all other keys (like letters or excess slashes)
  e.preventDefault();
});

dueInput.addEventListener('blur', () => {
  dueInputFocusFromPointer = false;
  commitActiveDueBlockEdit();
  dueInput.value = normalizeDueInputValue(dueInput.value, { enforceFuture: true });
});

dueInput.addEventListener('pointerdown', () => {
  dueInputFocusFromPointer = true;
  commitActiveDueBlockEdit();
});

dueInput.addEventListener('focus', () => {
  if (dueInputFocusFromPointer) {
    dueInputFocusFromPointer = false;
    return;
  }

  requestAnimationFrame(() => {
    setDueSelection(getDueBlockFromCursor(dueInput.selectionStart ?? 0));
  });
});

dueInput.addEventListener('click', () => {
  dueInputFocusFromPointer = false;
  commitActiveDueBlockEdit();
  setDueSelection(getDueBlockFromCursor(dueInput.selectionStart ?? 0));
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getDueBlockFromSelection(cursor, selectionEnd = cursor) {
  return DUE_BLOCKS.find(({ start, end }) => cursor >= start && selectionEnd <= end) || null;
}

function setDueBlockValue(value, block, nextBlockValue) {
  return value.substring(0, block.start) + nextBlockValue + value.substring(block.end);
}

function formatDueBlockForEditing(block, rawValue) {
  const padded = rawValue.padStart(block.length, '0');
  return padded.slice(-block.length);
}

function selectNextDueBlock(block) {
  const nextBlock = DUE_BLOCKS.find(({ start, type }) => start > block.start && type !== 'period');
  if (!nextBlock) return;
  setDueSelection(nextBlock);
}

function normalizeDueBlockValue(type, rawValue, fullValue) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const currentYear = now.getFullYear();
  const currentHour = now.getHours() % 12 || 12;
  const currentMinute = now.getMinutes();
  const parsedRaw = parseInt(rawValue, 10);

  if (type === 'day') {
    const fullYear = parseInt(fullValue.substring(6, 10), 10);
    const fullMonth = parseInt(fullValue.substring(3, 5), 10);
    const year = Math.max(Number.isNaN(fullYear) ? currentYear : fullYear, currentYear);
    const month = clamp(Number.isNaN(fullMonth) ? currentMonth : fullMonth, 1, 12);
    const maxDay = new Date(year, month, 0).getDate();
    const dayValue = Number.isNaN(parsedRaw) ? currentDay : parsedRaw;
    return String(clamp(dayValue, 1, maxDay)).padStart(2, '0');
  }

  if (type === 'month') {
    const monthValue = Number.isNaN(parsedRaw) ? currentMonth : parsedRaw;
    return String(clamp(monthValue, 1, 12)).padStart(2, '0');
  }

  if (type === 'year') {
    const yearValue = Number.isNaN(parsedRaw) ? currentYear : parsedRaw;
    return String(Math.max(yearValue, currentYear)).padStart(4, '0');
  }

  if (type === 'hour') {
    const hourValue = Number.isNaN(parsedRaw) ? currentHour : parsedRaw;
    return String(clamp(hourValue, 1, 12)).padStart(2, '0');
  }

  if (type === 'minute') {
    const minuteValue = Number.isNaN(parsedRaw) ? currentMinute : parsedRaw;
    return String(clamp(minuteValue, 0, 59)).padStart(2, '0');
  }

  return rawValue;
}

function commitActiveDueBlockEdit() {
  if (!activeDueBlockEdit) return;

  const { block, raw } = activeDueBlockEdit;
  dueInput.value = setDueBlockValue(
    dueInput.value,
    block,
    normalizeDueBlockValue(block.type, raw, dueInput.value)
  );
  activeDueBlockEdit = null;
}

function normalizeDueInputValue(value, { enforceFuture = false } = {}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const currentHour = now.getHours() % 12 || 12;
  const currentMinute = now.getMinutes();

  const parsedMonth = parseInt(value.substring(3, 5), 10);
  const parsedYear = parseInt(value.substring(6, 10), 10);
  const parsedDay = parseInt(value.substring(0, 2), 10);
  const parsedHour = parseInt(value.substring(12, 14), 10);
  const parsedMinute = parseInt(value.substring(15, 17), 10);

  const month = clamp(Number.isNaN(parsedMonth) ? currentMonth : parsedMonth, 1, 12);
  const year = Math.max(Number.isNaN(parsedYear) ? currentYear : parsedYear, currentYear);
  const maxDay = new Date(year, month, 0).getDate();
  const day = clamp(Number.isNaN(parsedDay) ? currentDay : parsedDay, 1, maxDay);
  const hour = clamp(Number.isNaN(parsedHour) ? currentHour : parsedHour, 1, 12);
  const minute = clamp(Number.isNaN(parsedMinute) ? currentMinute : parsedMinute, 0, 59);
  const period = value.substring(18, 20).toUpperCase() === 'PM' ? 'PM' : 'AM';

  const normalized = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`;
  if (!enforceFuture) return normalized;

  const parsed = parseMaskedDate(normalized);
  if (!parsed || parsed.getTime() <= now.getTime()) {
    const future = new Date(now.getTime() + 60 * 1000);
    return formatDateTimeHuman(future);
  }

  return normalized;
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

  playTaskCreateSound();

  commitActiveDueBlockEdit();
  dueInput.value = normalizeDueInputValue(dueInput.value, { enforceFuture: true });
  let dueDate = parseMaskedDate(dueInput.value);
  const finalDue = (hasUserModifiedDate && dueDate) ? dueDate.toISOString() : null;

  const newTask = {
    title: titleInput.value.trim(),
    due: finalDue,
    completed: false,
    urgent: false,
    reminderMinutes: selectedReminderMinutes,
    reminded: false,
    createdAt: Date.now(),
    totalWorkTime: 0,
    elapsedSeconds: 0,
    isCountdownSession: false
  };

  if (finalDue) {
    const diffHrs = (new Date(finalDue) - new Date()) / (1000 * 60 * 60);
    if (diffHrs < 0.1667) newTask.urgent = true; // 10 minutes ≈ 0.1667 hours
  }

  tasks.push(newTask);
  saveTasks();

  // If user is on another filter (like Notes), switch to 'All' so they see the new task
  if (currentFilter !== 'all') {
    currentFilter = 'all';
    updateFilterUI('all');
  }

  renderTasks();

  titleInput.value = '';
  
  // Immediately check for reminders in case one was set for 'now'
  checkReminders();

  // Reset date input and reminder state
  dueInput.value = formatDateTimeHuman(getDefaultDueDate());
  hasUserModifiedDate = false;
  updateReminderBtnState();
  selectedReminderMinutes = null;

  taskReminderBtn.classList.remove('has-reminder');
  reminderDropdown.querySelectorAll('.reminder-option').forEach(btn => btn.classList.remove('active'));

  // Reset custom area if open
  const customTrigger = document.getElementById('reminder-custom-trigger');
  const customInputWrap = document.getElementById('reminder-custom-input-wrap');
  if (customTrigger) customTrigger.classList.remove('hidden');
  if (customInputWrap) customInputWrap.classList.add('hidden');
  const unitToggle = document.getElementById('reminder-unit-toggle');
  if (unitToggle) {
    unitToggle.dataset.unit = 'm';
    const textSpan = unitToggle.querySelector('.unit-toggle-text');
    if (textSpan) textSpan.textContent = 'min';
  }
  const unitMenu = document.getElementById('reminder-unit-menu');
  if (unitMenu) {
    unitMenu.querySelectorAll('.unit-opt').forEach(btn => btn.classList.remove('active'));
    const defaultOpt = unitMenu.querySelector('[data-unit="m"]');
    if (defaultOpt) defaultOpt.classList.add('active');
  }
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
let moveTimeout;

async function snapToEdges() {
  if (isAnimating || isDockMinimizing) return;

  const monitor = await currentMonitor();
  if (!monitor) return;

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { full } = getMonitorBounds(monitor);
  const { x: offsetX, y: offsetY, width: scrW } = full;

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
  if (isAnimating || isDockMinimizing) return;
  const monitor = await currentMonitor();
  if (!monitor) return;

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { full } = getMonitorBounds(monitor);
  const { x: offsetX, y: offsetY, width: scrW } = full;

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
  if (isAnimating || isDockMinimizing) {
    clearTimeout(collapseTimer);
    return;
  }
  if (Date.now() - lastExpandTime < 800) {
    clearTimeout(collapseTimer);
    return; // Prevent flip-flop right after expansion
  }
  const isCollapsed = appElement.classList.contains('collapsed-y') || appElement.classList.contains('collapsed-x');
  if (isCollapsed) {
    clearTimeout(collapseTimer);
    return;
  }

  const monitor = await currentMonitor();
  if (!monitor) {
    clearTimeout(collapseTimer);
    return;
  }

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { width: scrW, height: scrH } = monitor.size;
  const { x: offsetX, y: offsetY } = monitor.position;

  // Optimized trigger for instant "genie" capture
  const TRIGGER_TOP_SIDES = 6; // Reduced from 8 to prevent accidental triggers

  const dTop = Math.abs(winY - offsetY);
  const dLeft = Math.abs(winX - offsetX);
  const dRight = Math.abs((offsetX + scrW) - (winX + winW));

  if (isNativeEdgeSnapActive(monitor, { x: winX, y: winY }, { width: winW, height: winH })) {
    clearTimeout(collapseTimer);
    return;
  }

  if (dTop < TRIGGER_TOP_SIDES) {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      toggleCollapseY();
    }, 150);
  } else if (dLeft < TRIGGER_TOP_SIDES || dRight < TRIGGER_TOP_SIDES) {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      toggleCollapseX();
    }, 150);
  } else {
    clearTimeout(collapseTimer);
  }
}

async function checkInstantExpand() {
  if (isAnimating || isDockMinimizing) return;
  const isCollapsedY = appElement.classList.contains('collapsed-y');
  const isCollapsedX = appElement.classList.contains('collapsed-x');
  if (!isCollapsedY && !isCollapsedX) return;

  const monitor = await currentMonitor();
  if (!monitor) return;

  const { x: winX, y: winY } = await appWindow.outerPosition();
  const { width: winW, height: winH } = await appWindow.outerSize();
  const { width: scrW, height: scrH } = monitor.size;
  const { x: offsetX, y: offsetY } = monitor.position;

  const EXPAND_THRESHOLD = 30; // Increased from 12 to provide stable "buffer" and prevent flickering
  const dTop = Math.abs(winY - offsetY);
  const dLeft = Math.abs(winX - offsetX);
  const dRight = Math.abs((offsetX + scrW) - (winX + winW));

  if (isCollapsedY && dTop > EXPAND_THRESHOLD) {
    toggleCollapseY(true); // true = isManualDrag
  } else if (isCollapsedX && dLeft > EXPAND_THRESHOLD && dRight > EXPAND_THRESHOLD) {
    toggleCollapseX(true); // true = isManualDrag
  }
}

let isMovedProcessing = false;
let moveProcessingPending = false;
let moveProcessingLastPos = null;

appWindow.onMoved(async (event) => {
  if (isAnimating || isDockMinimizing || isRestoringFromDock) return;

  refreshWindowDragGesture();

  // If the window is moved manually while peeking (expanding via hover),
  // end the peek state and force it to full size.
  if (isPeeking) {
    isPeeking = false;
    appElement.classList.remove('peeking', 'peeking-y', 'peeking-x');
    await suppressEyeMessageBubble();
    const monitor = await currentMonitor();
    if (monitor) {
      const currentSize = await appWindow.outerSize();
      await animateWindowSize(
        currentSize,
        ALL_WINDOWS_SIZE,
        MANUAL_DRAG_EXPAND_DURATION_MS
      );
    }
  }

  moveProcessingLastPos = event.payload;

  if (isMovedProcessing) {
    moveProcessingPending = true;
    return;
  }
  isMovedProcessing = true;

  const processMoves = async () => {
    try {
      if (isAnimating || isDockMinimizing) return;
      
      const monitor = dragStartMonitor || await currentMonitor();
      if (!monitor) return;
      
      const winPos = moveProcessingLastPos || await appWindow.outerPosition();
      const winSize = await appWindow.outerSize();

      const { full, work } = getMonitorBounds(monitor);
      const { x: offsetX, y: offsetY, width: scrW } = full;

      const isCollapsedY = appElement.classList.contains('collapsed-y');
      const isCollapsedX = appElement.classList.contains('collapsed-x');
      const dTop = winPos.y - offsetY;
      const dLeft = winPos.x - offsetX;
      const dRight = (offsetX + scrW) - (winPos.x + winSize.width);
      const windowBottom = winPos.y + winSize.height;
      const workBottom = work.y + work.height;
      const nativeEdgeSnapActive = isNativeEdgeSnapActive(monitor, winPos, winSize);

      if (nativeEdgeSnapActive) {
        await restoreExpandedStateFromNativeEdgeSnap();
        clearTimeout(collapseTimer);
        return;
      }

      if (isCollapsedY || isCollapsedX) {
        const EXPAND_THRESHOLD = 30;
        if (isCollapsedY && dTop > EXPAND_THRESHOLD) {
          toggleCollapseY(true);
        } else if (isCollapsedX && dLeft > EXPAND_THRESHOLD && dRight > EXPAND_THRESHOLD) {
          toggleCollapseX(true);
        }
      } else {
        if (Date.now() - lastExpandTime >= 800) {
          const TRIGGER_TOP_SIDES = 6;
          
          if (dTop < TRIGGER_TOP_SIDES) {
            clearTimeout(collapseTimer);
            collapseTimer = setTimeout(() => { toggleCollapseY(); }, 150);
          } else if (dLeft < TRIGGER_TOP_SIDES || dRight < TRIGGER_TOP_SIDES) {
            clearTimeout(collapseTimer);
            collapseTimer = setTimeout(() => { toggleCollapseX(); }, 150);
          } else if (isWindowDragGesture && Date.now() <= windowDragGestureExpiresAt && windowBottom > workBottom) {
            clearTimeout(collapseTimer);
            // Increased delay to 150ms to prevent accidental triggers during fast movement
            collapseTimer = setTimeout(() => {
              minimizeIntoDockFromBottomEdge(monitor, winPos, winSize);
            }, 150);
          } else {
            clearTimeout(collapseTimer);
          }
        }
      }
    } finally {
      if (moveProcessingPending) {
        moveProcessingPending = false;
        requestAnimationFrame(() => processMoves());
      } else {
        isMovedProcessing = false;
      }
    }
  };

  processMoves();
});

// Focus Mode Logic
let focusTimerInterval = null;
let focusSeconds = 0;
let currentFocusTask = null;

const congratsMessages = [
  "Great focus. Keep this momentum going.",
  "One step closer to your goals. Well done.",
  "Consistent effort pays off. Take a moment to appreciate your work.",
  "Task completed successfully. You're doing great.",
  "Outstanding focus session. Ready for the next challenge?",
  "Consistency is key. Excellent job staying on track.",
  "Progress is made one task at a time. Keep it up."
];

let confettiAnimationId = null;

function playVictorySound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  
  const playNote = (freq, startTime, duration) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
    
    gain.gain.setValueAtTime(0, ctx.currentTime + startTime);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + startTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + startTime + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(ctx.currentTime + startTime);
    osc.stop(ctx.currentTime + startTime + duration);
  };
  
  // Triumphant fast arpeggio
  playNote(523.25, 0.0, 0.15); // C5
  playNote(659.25, 0.1, 0.15); // E5
  playNote(783.99, 0.2, 0.15); // G5
  playNote(1046.50, 0.3, 0.5); // C6
}

function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = [];
  const colors = ['#eff226', '#ffc928', '#ace322', '#f3a8d5', '#007aff', '#ff3b30'];

  // Start explosion from center-bottom
  for (let i = 0; i < 150; i++) {
    pieces.push({
      x: canvas.width / 2,
      y: canvas.height * 0.8,
      vx: (Math.random() - 0.5) * 35, // Wide horizontal spread
      vy: (Math.random() - 1) * 20 - 15, // Powerful upward burst
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rs: (Math.random() - 0.5) * 15 // Spin speed
    });
  }

  function update() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;
    
    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.6; // Gravity
      p.rotation += p.rs;
      
      if (p.y < canvas.height + 20) active = true;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.5);
      ctx.restore();
    });

    if (active) {
      confettiAnimationId = requestAnimationFrame(update);
    }
  }
  
  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  update();
}

function showCongrats(seconds) {
  if (seconds <= 0) return;
  
  const modal = document.getElementById('congrats-modal');
  const timerVal = document.getElementById('congrats-timer-val');
  const funText = document.getElementById('congrats-fun-text');
  
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  
  if (timerVal) timerVal.textContent = `${m}:${s}`;
  if (funText) funText.textContent = congratsMessages[Math.floor(Math.random() * congratsMessages.length)];
  
  modal.classList.remove('hidden');
  // Hide task input and notes icons during congrats modal
  const inputArea = document.querySelector('.input-area');
  const notesIcons = document.querySelector('.task-notes-icons');
  if (inputArea) inputArea.classList.add('hidden');
  if (notesIcons) notesIcons.classList.add('hidden');
  
  playVictorySound();
  startConfetti();
}
let isCountdown = false;

function enterFocusMode(task) {
  // If there's saved progress, ask them what to do
  if (task.elapsedSeconds && task.elapsedSeconds > 0) {
    showResumeModal(task);
    return;
  }
  
  startFocusSession(task, false);
}

function startFocusSession(task, resume = false) {
  currentFocusTask = task;
  isInFocusMode = true;

  document.getElementById('focus-task-name').textContent = task.title;
  document.getElementById('focus-mode').classList.remove('hidden');
  appElement.classList.add('focus-mode-active');

  // Set a random quote
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById('focus-quote').textContent = `"${randomQuote}"`;

  // Update navbar title to task name immediately
  updateNavbarTitle(task.title);

  // Reset timer
  stopTimer();
  focusSeconds = resume ? task.elapsedSeconds : 0;
  isCountdown = resume ? (task.isCountdownSession || false) : false;
  updateTimerDisplay();

  // If starting over, clear the saved time
  if (!resume) {
    task.elapsedSeconds = 0;
    task.totalWorkTime = 0;
    saveTasks();
  }

  // Play sound immediately upon entering focus mode
  playTaskActivationSound();

  // Start timer after a short delay for better transition
  setTimeout(() => {
    toggleTimer();
  }, 1000);
}

let taskToResume = null;
function showResumeModal(task) {
  taskToResume = task;
  const modal = document.getElementById('resume-modal');
  const timerVal = document.getElementById('resume-time-val');
  
  const hrs = Math.floor(task.elapsedSeconds / 3600);
  const mins = Math.floor((task.elapsedSeconds % 3600) / 60);
  const secs = task.elapsedSeconds % 60;
  timerVal.textContent = [hrs, mins, secs].map(v => String(v).padStart(2, '0')).join(':');
  
  modal.classList.remove('hidden');
}

function hideResumeModal() {
  document.getElementById('resume-modal').classList.add('hidden');
  taskToResume = null;
}

// Resume Modal Event Listeners
document.getElementById('resume-continue-btn').addEventListener('click', () => {
  if (taskToResume) {
    const task = taskToResume;
    hideResumeModal();
    startFocusSession(task, true);
  }
});

document.getElementById('resume-start-over-btn').addEventListener('click', () => {
  if (taskToResume) {
    const task = taskToResume;
    hideResumeModal();
    startFocusSession(task, false);
  }
});

document.getElementById('resume-cancel-btn').addEventListener('click', hideResumeModal);


async function exitFocusMode() {
  stopTimer();
  
  // Save progress if session was active AND task not completed
  if (currentFocusTask) {
    if (currentFocusTask.completed) {
      currentFocusTask.elapsedSeconds = 0;
      currentFocusTask.isCountdownSession = false;
    } else if (focusSeconds > 0) {
      currentFocusTask.elapsedSeconds = focusSeconds;
      currentFocusTask.isCountdownSession = isCountdown;
    }
    await saveTasks();
  }

  document.getElementById('focus-mode').classList.add('hidden');
  appElement.classList.remove('focus-mode-active');
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
          playIcon.classList.remove('hidden');
          pauseIcon.classList.add('hidden');
          isCountdown = false;
          showTimesUpModal(); // Show completion options
        }
      } else {
        focusSeconds++;
        updateTimerDisplay();
      }

      // Track total work time across sessions
      if (currentFocusTask) {
        currentFocusTask.totalWorkTime = (currentFocusTask.totalWorkTime || 0) + 1;
      }
    }, 1000);
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
  }
}

let sessionOriginalDuration = 0;

function showTimesUpModal() {
  playTimesUpSound();
  const modal = document.getElementById('times-up-modal');
  modal.classList.remove('hidden');
  appElement.classList.add('times-up-active');
  suppressEyeMessageBubble(); // Hide any active eye guide bubble

  const shouldUseTopCollapsedReminder = isTopCollapsedReminderMode();
  if (shouldUseTopCollapsedReminder) {
    const popup = document.getElementById('collapsed-times-up-popup');
    const title = document.getElementById('collapsed-times-up-title');
    if (popup && title) {
      title.textContent = currentFocusTask ? currentFocusTask.title : 'Task';
      popup.classList.remove('hidden');
      popup.setAttribute('aria-hidden', 'false');
      
      void expandTopCollapsedReminder().then(() => {
        // Text is revealed earlier via the reveal class
      });
      
      // Reveal text almost immediately after starting expansion for better sync
      setTimeout(() => {
        if (!popup.classList.contains('hidden') && appElement.classList.contains('collapsed-reminder-active')) {
          appElement.classList.add('collapsed-reminder-revealed');
        }
      }, 40);
    }
  } else if (appElement.classList.contains('collapsed-x')) {
    showSideNotification();
    showSideNotificationBubble("time's<br>up");
  }
}

function hideTimesUpModal() {
  document.getElementById('times-up-modal').classList.add('hidden');
  appElement.classList.remove('times-up-active');
  clearSideNotification(); // Clear bell and glow when dismissed

  const popup = document.getElementById('collapsed-times-up-popup');
  if (popup && !popup.classList.contains('hidden')) {
    popup.classList.add('hidden');
    popup.setAttribute('aria-hidden', 'true');
    appElement.classList.remove('collapsed-reminder-revealed');
    setTimeout(() => {
      void restoreTopCollapsedReminder();
    }, 240);
  }
}

// Time's Up Modal Handlers
document.getElementById('times-up-complete-btn').addEventListener('click', handleTimesUpComplete);
document.getElementById('times-up-not-done-btn').addEventListener('click', handleTimesUpNotDone);

// Dynamic Island Style Time's Up Buttons
const islandCompleteBtn = document.getElementById('collapsed-times-up-complete-btn-island');
if (islandCompleteBtn) islandCompleteBtn.addEventListener('click', handleTimesUpComplete);

const islandNotDoneBtn = document.getElementById('collapsed-times-up-not-done-btn-island');
if (islandNotDoneBtn) islandNotDoneBtn.addEventListener('click', handleTimesUpNotDone);

async function handleTimesUpComplete() {
  if (currentFocusTask) {
    const totalTime = currentFocusTask.totalWorkTime || 0;
    currentFocusTask.completed = true;
    currentFocusTask.completedAt = Date.now();
    currentFocusTask.elapsedSeconds = 0;

    await saveTasks();
    renderTasks();

    const isCollapsedY = appElement.classList.contains('collapsed-y');
    const isCollapsedX = appElement.classList.contains('collapsed-x');

    if (isCollapsedY || isCollapsedX) {
      // Clear any pending animations or flags that might block expansion
      isAnimating = false;
      collapseModeAfterCongrats = isCollapsedY ? 'y' : 'x';

      // Manually clean up the island popup state before expanding
      const popup = document.getElementById('collapsed-times-up-popup');
      if (popup) {
        popup.classList.add('hidden');
        popup.setAttribute('aria-hidden', 'true');
      }
      appElement.classList.remove('collapsed-reminder-revealed', 'collapsed-reminder-active');
      
      // Now hide the main modal (without triggering automatic restoration)
      document.getElementById('times-up-modal').classList.add('hidden');
      appElement.classList.remove('times-up-active');
      clearSideNotification();

      // Hide focus mode screen to prevent it from overlaying the congrats modal
      document.getElementById('focus-mode').classList.add('hidden');
      appElement.classList.remove('focus-mode-active');

      // Expand the app fully
      if (isCollapsedY) {
        await toggleCollapseY();
      } else {
        await toggleCollapseX();
      }

      // Show the full congrats modal
      showCongrats(totalTime);
    } else {
      hideTimesUpModal();
      // Hide focus mode screen
      document.getElementById('focus-mode').classList.add('hidden');
      appElement.classList.remove('focus-mode-active');
      showCongrats(totalTime);
    }
  }
}

// Add listener for the new island "Let's Go" button
document.getElementById('island-lets-go-btn').addEventListener('click', () => {
  hideTimesUpModal();
  exitFocusMode();

  // Reset island state for next time
  const mainInfo = document.getElementById('island-info-main');
  const completeInfo = document.getElementById('island-info-complete');
  if (mainInfo && completeInfo) {
    mainInfo.classList.remove('hidden');
    completeInfo.classList.add('hidden');
  }
});
function handleTimesUpNotDone() {
  hideTimesUpModal();
  // Optionally reset to 0 or leave at 0 so they can start a new timer/stopwatch
  resetTimer();
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
    sessionOriginalDuration = focusSeconds;
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

// Fold buttons removed from Focus mode


function renderHistory(completedTasks) {
  const historyList = document.getElementById('history-list');
  const emptyState = document.getElementById('history-empty-state');
  if (!historyList || !emptyState) return;

  historyList.innerHTML = '';
  
  if (completedTasks.length === 0) {
    emptyState.classList.remove('hidden');
    historyList.classList.add('hidden');
  } else {
    emptyState.classList.add('hidden');
    historyList.classList.remove('hidden');
    completedTasks.forEach(task => {
      const li = document.createElement('li');
      li.className = 'history-item';
      
      const date = new Date(task.completedAt || Date.now());
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

      li.innerHTML = `
        <div class="history-item-content">
          <div class="history-item-title">${task.title}</div>
          <div class="history-item-meta">Completed ${dateStr} at ${timeStr}</div>
        </div>
        <button class="delete-history-item" title="Delete from history">×</button>
      `;

      li.querySelector('.delete-history-item').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = document.getElementById('clear-history-btn');
        
        // Trigger bin animation
        li.classList.add('swallowing');
        if (btn) btn.classList.add('animating');
        
        setTimeout(async () => {
          const index = tasks.indexOf(task);
          if (index !== -1) {
            tasks.splice(index, 1);
            await saveTasks();
            renderTasks();
          }
          if (btn) btn.classList.remove('animating');
        }, 600);
      });

      li.addEventListener('click', () => {
        showRestoreModal(task);
      });

      historyList.appendChild(li);
    });
  }
}

let taskToRestore = null;
function showRestoreModal(task) {
  taskToRestore = task;
  document.getElementById('restore-modal').classList.remove('hidden');
}

function hideRestoreModal() {
  document.getElementById('restore-modal').classList.add('hidden');
  taskToRestore = null;
}

// Restore Modal Event Listeners
document.getElementById('restore-yes-btn').addEventListener('click', async () => {
  if (taskToRestore) {
    taskToRestore.completed = false;
    taskToRestore.completedAt = null;
    await saveTasks();
    renderTasks();
    hideRestoreModal();
  }
});

document.getElementById('restore-no-btn').addEventListener('click', hideRestoreModal);


function toggleHistory() {
  const historyWorkspace = document.getElementById('history-workspace');
  if (!historyWorkspace) return;
  
  isHistoryOpen = !isHistoryOpen;
  
  if (isHistoryOpen) {
    historyWorkspace.classList.remove('hidden');
    historyWorkspace.setAttribute('aria-hidden', 'false');
    appElement.classList.add('history-active');
    // Ensure notes are closed when opening history
    if (activeNoteId) closeActiveNote();
  } else {
    historyWorkspace.classList.add('hidden');
    historyWorkspace.setAttribute('aria-hidden', 'true');
    appElement.classList.remove('history-active');
  }
}

// History Event Listeners
document.getElementById('history-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleHistory();
});

document.getElementById('history-back-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  goToHomeView();
});

document.getElementById('clear-history-btn').addEventListener('click', async (e) => {
  e.stopPropagation();

  const completedTasksCount = tasks.filter(t => t.completed).length;
  if (completedTasksCount === 0) {
    playFallbackDeleteSound();
    const btn = document.getElementById('clear-history-btn');
    btn.classList.add('shake');
    
    const warning = document.getElementById('history-clear-warning');
    if (warning) {
      warning.classList.remove('hidden');
      setTimeout(() => {
        warning.classList.add('hidden');
      }, 2000);
    }
    
    setTimeout(() => btn.classList.remove('shake'), 500);
    return;
  }

  playTaskDeleteSound();

  const shouldClear = await requestDeleteConfirmation('entire history');
  if (shouldClear) {
    const btn = document.getElementById('clear-history-btn');
    const items = document.querySelectorAll('.history-item');
    
    // Play swallow animation with staggered delay
    if (btn) btn.classList.add('animating');
    items.forEach((li, index) => {
      // Add a small delay for each subsequent item for a staggered effect
      li.style.animationDelay = `${index * 50}ms`;
      li.classList.add('swallowing');
    });
    
    // Adjust timeout based on the number of items to ensure all animations finish
    const totalDuration = 600 + (items.length * 50);
    
    setTimeout(async () => {
      tasks = tasks.filter(t => !t.completed);
      await saveTasks();
      renderTasks();
      if (btn) btn.classList.remove('animating');
    }, Math.max(600, totalDuration));
  }
});

// Redundant main-home-link listener removed; it is now handled by homeNavLinks.forEach

// Update focus mode complete to handle animation/delay if needed
document.getElementById('focus-nav-complete-btn').addEventListener('click', async () => {
  if (currentFocusTask) {
    currentFocusTask.completed = true;
    currentFocusTask.completedAt = Date.now();
    currentFocusTask.elapsedSeconds = 0;
    await saveTasks();
    renderTasks();

    stopTimer();
    if (appElement.classList.contains('times-up-active')) {
      hideTimesUpModal();
    }

    // Stop the timer and show congrats before exiting
    const finalSeconds = currentFocusTask.totalWorkTime || 0;
    const isCollapsed = appElement.classList.contains('collapsed-y') || appElement.classList.contains('collapsed-x');
    if (!isCollapsed && !isPeeking) {
      document.getElementById('focus-mode').classList.add('hidden');
      appElement.classList.remove('focus-mode-active');
    }
    showCongrats(finalSeconds);
  }
});

document.getElementById('congrats-done-btn').addEventListener('click', async () => {
  document.getElementById('congrats-modal').classList.add('hidden');
  // Restore task input and notes icons
  const inputArea = document.querySelector('.input-area');
  const notesIcons = document.querySelector('.task-notes-icons');
  if (inputArea) inputArea.classList.remove('hidden');
  if (notesIcons) notesIcons.classList.remove('hidden');
  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  exitFocusMode();

  if (collapseModeAfterCongrats) {
    const mode = collapseModeAfterCongrats;
    collapseModeAfterCongrats = null;
    
    // Collapse back to exactly where it was (top or side)
    if (mode === 'y') {
      await toggleCollapseY();
    } else {
      await toggleCollapseX();
    }
  }
});

document.getElementById('focus-nav-exit-btn').addEventListener('click', exitFocusMode);

// Helper function to get current title based on view
function getCurrentViewTitle() {
  if (isInFocusMode && currentFocusTask) {
    return currentFocusTask.title;
  } else if (activeNoteId) {
    const rawTitle = notesTitleInput ? notesTitleInput.value.trim() : '';
    return rawTitle || 'Untitled Note';
  }
  return 'FlowPane';
}

// Helper function to update navbar title
function updateNavbarTitle(title) {
  // Update both main navbar and focus mode navbar
  const mainTitle = document.getElementById('main-home-link');
  const focusTitle = document.getElementById('focus-home-link');

  const setNodeText = (element, text) => {
    if (!element) return;
    
    let titleTextSpan = element.querySelector('.navbar-title-text');
    if (!titleTextSpan) {
      titleTextSpan = document.createElement('span');
      titleTextSpan.className = 'navbar-title-text';
      element.prepend(titleTextSpan);
      
      // Clean up any stray text nodes that might have been there
      for (let node of [...element.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE) {
          element.removeChild(node);
        }
      }
    }
    
    if (titleTextSpan.textContent === text) return;
    titleTextSpan.textContent = text;
  };

  setNodeText(mainTitle, title);
  setNodeText(focusTitle, title);
}

// Helper function to update navbar timer
function updateNavbarTimer(timeString) {
  const navbarTimers = document.querySelectorAll('.navbar-timer');
  const [h, m, s] = timeString.split(':');

  navbarTimers.forEach(timer => {
    if (h === '00') {
      timer.innerHTML = `
        <span class="t-unit">${m}</span>
        <span class="t-sep">:</span>
        <span class="t-unit">${s}</span>
      `;
      timer.classList.add('short-timer');
    } else {
      timer.innerHTML = `
        <span class="t-unit">${h}</span>
        <span class="t-sep">:</span>
        <span class="t-unit">${m}</span>
        <span class="t-sep">:</span>
        <span class="t-unit">${s}</span>
      `;
      timer.classList.remove('short-timer');
    }
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
// Use staggered timeouts to ensure layout is truly settled (catch font loads etc.)
updateFilterPill(); // Instant
setTimeout(updateFilterPill, 50); 
setTimeout(updateFilterPill, 300);
window.addEventListener('load', updateFilterPill);
window.addEventListener('resize', updateFilterPill);

// Googly Eyes Cursor Tracking
// Clean up previous event listener if it still exists (not really needed since we replace the code, but conceptually)
let globalEyeRafId = null;

async function trackCursorGlobally() {
  try {
    // Fetch physical cursor position from the Rust backend (returns [x, y])
    const pos = await window.__TAURI__.core.invoke("get_cursor_position"); 
    
    // Fetch physical window position (inner window)
    const winPos = await appWindow.innerPosition(); 
    const scale = await appWindow.scaleFactor();

    // Convert to logical (CSS) coordinates relative to the webview
    const logicalX = (pos[0] - winPos.x) / scale;
    const logicalY = (pos[1] - winPos.y) / scale;

    // Pseudo-hover detection for unfocused states
    const hoveredEl = document.elementFromPoint(logicalX, logicalY);
    const prevHovers = document.querySelectorAll('.pseudo-hover');
    prevHovers.forEach(el => {
      if (!hoveredEl || !el.contains(hoveredEl)) {
        el.classList.remove('pseudo-hover');
      }
    });

    if (hoveredEl) {
      let curr = hoveredEl;
      while (curr && curr !== document.body) {
        if (curr.classList.contains('task-note-tab') || 
            curr.classList.contains('task-item') || 
            curr.classList.contains('control-btn') ||
            curr.classList.contains('filter-btn') ||
            curr.classList.contains('task-reminder-btn')) {
          curr.classList.add('pseudo-hover');
        }
        curr = curr.parentElement;
      }
    }

    const eyes = document.querySelectorAll('.eye');
    eyes.forEach(eye => {
      const pupil = eye.querySelector('.pupil');
      if (!pupil) return;

      const rect = eye.getBoundingClientRect();
      const eyeCenterX = rect.left + rect.width / 2;
      const eyeCenterY = rect.top + rect.height / 2;

      const dx = logicalX - eyeCenterX;
      const dy = logicalY - eyeCenterY;
      const angle = Math.atan2(dy, dx);
      
      const maxBound = 4.0;
      const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxBound);

      const pupilX = Math.cos(angle) * dist;
      const pupilY = Math.sin(angle) * dist;

      pupil.style.transform = `translate(${pupilX}px, ${pupilY}px)`;
    });
  } catch (err) {
    // Silently continue if something temporarily fails
  }
  
  // Continuously track on every frame
  globalEyeRafId = requestAnimationFrame(trackCursorGlobally);
}

// Start tracking immediately
trackCursorGlobally();

function clearEyeMessageAnimationTimers() {
  if (eyeMessageRevealTimer != null) {
    clearTimeout(eyeMessageRevealTimer);
    eyeMessageRevealTimer = null;
  }
  if (eyeMessageDismissTimer != null) {
    clearTimeout(eyeMessageDismissTimer);
    eyeMessageDismissTimer = null;
  }
  if (eyeMessageDismissFadeTimer != null) {
    clearTimeout(eyeMessageDismissFadeTimer);
    eyeMessageDismissFadeTimer = null;
  }
  if (eyeMessageTypeTimer != null) {
    clearInterval(eyeMessageTypeTimer);
    eyeMessageTypeTimer = null;
  }
}

async function hideEyeMessageOverlay() {
  try {
    await window.__TAURI__.core.invoke('hide_eye_bubble_overlay');
  } catch (e) {
    console.error('Failed to hide eye message overlay:', e);
  }
}

async function showRightEyeMessageOverlay() {
  return showRightBubbleMessage('i got my<br>eyes on you', 3000);
}

function tokenizeBubbleHTML(fullHTML) {
  const tokens = [];
  for (let i = 0; i < fullHTML.length; i++) {
    if (fullHTML.startsWith('<br>', i)) {
      tokens.push('<br>');
      i += 3;
    } else {
      tokens.push(fullHTML[i]);
    }
  }
  return tokens;
}

function renderBubbleTokens(tokens, count) {
  return tokens.slice(0, count).join('');
}

async function showRightBubbleMessage(fullHTML, durationMs = 3000) {
  clearEyeMessageAnimationTimers();

  try {
    const monitor = await currentMonitor();
    if (!monitor) return;

    const currentPos = await appWindow.outerPosition();
    const currentSize = await appWindow.outerSize();
    const scale = monitor.scaleFactor;
    const overlayWidth = COLLAPSED_SIZE_X_BUBBLE.width * scale;
    const overlayX = (currentPos.x + currentSize.width) - overlayWidth;

    if (!appElement.classList.contains('collapsed-x') || !appElement.classList.contains('collapsed-right')) return;
    if (isPeeking || appElement.classList.contains('peeking')) return;

    await window.__TAURI__.core.invoke('show_eye_bubble_overlay', {
      x: Math.round(overlayX),
      y: Math.round(currentPos.y)
    });
    const payload = JSON.stringify({ html: fullHTML, durationMs });
    await appWindow.eval(`window.showEyeBubbleFromHost && window.showEyeBubbleFromHost(${payload})`);

    eyeMessageDismissFadeTimer = setTimeout(() => {
      eyeMessageDismissFadeTimer = null;
      hideEyeMessageOverlay();
    }, durationMs + 1300);
  } catch (e) {
    console.error('Failed to show right-side eye message overlay:', e);
  }
}

async function showCollapsedBubbleMessage(fullHTML, durationMs = 3000) {
  const isCollapsedY = appElement.classList.contains('collapsed-y');
  const isCollapsedX = appElement.classList.contains('collapsed-x');
  if (!isCollapsedY && !isCollapsedX) return;
  if (isPeeking || appElement.classList.contains('peeking')) return;

  if (isCollapsedX && appElement.classList.contains('collapsed-right')) {
    await showRightBubbleMessage(fullHTML, durationMs);
    return;
  }

  const activeHeader = isInFocusMode ? document.querySelector('.focus-header-bar') : document.querySelector('.title-bar:not(.focus-header-bar)');
  const bubble = activeHeader ? activeHeader.querySelector('.eye-bubble') : null;
  if (!bubble) return;

  try {
    const monitor = await currentMonitor();
    if (!monitor) return;

    const currentPos = await appWindow.outerPosition();
    const currentSize = await appWindow.outerSize();
    const scale = monitor.scaleFactor;
    const { width: scrW } = monitor.size;
    const { x: offsetX } = monitor.position;

    if (!appElement.classList.contains('collapsed-y') && !appElement.classList.contains('collapsed-x')) return;
    if (isPeeking || appElement.classList.contains('peeking')) return;

    const targetSize = isCollapsedY ? COLLAPSED_SIZE_Y_BUBBLE : COLLAPSED_SIZE_X_BUBBLE;
    const pTargetW = targetSize.width * scale;

    let newX = currentPos.x;
    const isRight = appElement.classList.contains('collapsed-right');
    if (isCollapsedX && isRight) {
      newX = (currentPos.x + currentSize.width) - pTargetW;
    }

    appElement.classList.add('bubble-active');
    clearEyeMessageAnimationTimers();
    bubble.classList.remove('hidden', 'burst-out');

    if (Math.round(newX) !== currentPos.x || currentSize.width !== pTargetW) {
      if (isRight) {
        await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(Math.round(newX), currentPos.y));
        await appWindow.setSize(targetSize);
      } else {
        await animateWindowTransform(
          currentPos,
          { x: Math.round(newX), y: currentPos.y },
          currentSize,
          targetSize,
          100
        );
      }
    } else {
      await appWindow.setSize(targetSize);
    }

    if (!appElement.classList.contains('collapsed-y') && !appElement.classList.contains('collapsed-x')) return;
    if (isPeeking || appElement.classList.contains('peeking')) return;

    const bubbleText = bubble.querySelector('.bubble-text');
    const tokens = tokenizeBubbleHTML(fullHTML);
    if (bubbleText) bubbleText.innerHTML = '';

    eyeMessageRevealTimer = setTimeout(() => {
      eyeMessageRevealTimer = null;
      bubble.classList.add('visible');

      if (bubbleText) {
        let typeIndex = 0;

        setTimeout(() => {
          eyeMessageTypeTimer = setInterval(() => {
            if (!bubble.classList.contains('visible')) {
              clearInterval(eyeMessageTypeTimer);
              eyeMessageTypeTimer = null;
              return;
            }

            typeIndex++;
            bubbleText.innerHTML = renderBubbleTokens(tokens, typeIndex);

            if (typeIndex >= tokens.length) {
              clearInterval(eyeMessageTypeTimer);
              eyeMessageTypeTimer = null;
            }
          }, 30);
        }, 350);
      }
    }, 50);

    eyeMessageDismissTimer = setTimeout(() => {
      eyeMessageDismissTimer = null;

      if (bubbleText) {
        let currentLen = tokens.length;

        if (eyeMessageTypeTimer) clearInterval(eyeMessageTypeTimer);

        eyeMessageTypeTimer = setInterval(() => {
          currentLen--;
          if (currentLen < 0) {
            clearInterval(eyeMessageTypeTimer);
            eyeMessageTypeTimer = null;

            bubble.classList.remove('visible');
            bubble.classList.add('burst-out');

            eyeMessageDismissFadeTimer = setTimeout(async () => {
              eyeMessageDismissFadeTimer = null;
              bubble.classList.add('hidden');
              bubble.classList.remove('burst-out');
              appElement.classList.remove('bubble-active');

              const stillCollapsedY = appElement.classList.contains('collapsed-y');
              const stillCollapsedX = appElement.classList.contains('collapsed-x');
              if (stillCollapsedY || stillCollapsedX) {
                const restoredSize = stillCollapsedY ? COLLAPSED_SIZE_Y : COLLAPSED_SIZE_X;
                const restoreMonitor = await currentMonitor();
                const restoreScale = restoreMonitor ? restoreMonitor.scaleFactor : 1;

                const actualPos = await appWindow.outerPosition();
                const actualSize = await appWindow.outerSize();
                let endX = actualPos.x;

                if (stillCollapsedX) {
                  const isRightSnap = appElement.classList.contains('collapsed-right');
                  if (isRightSnap && restoreMonitor) {
                    const pRestoredW = restoredSize.width * restoreScale;
                    endX = (offsetX + scrW) - pRestoredW;
                  }
                }

                if (stillCollapsedX && appElement.classList.contains('collapsed-right')) {
                  await appWindow.setSize(restoredSize);
                  await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(Math.round(endX), actualPos.y));
                } else {
                  await animateWindowTransform(
                    actualPos,
                    { x: Math.round(endX), y: actualPos.y },
                    actualSize,
                    restoredSize,
                    100
                  );
                }
              }
            }, 400);
            return;
          }

          bubbleText.innerHTML = renderBubbleTokens(tokens, currentLen);
        }, 30);
      }
    }, durationMs);
  } catch (e) {
    console.error('Failed to show collapsed bubble message:', e);
  }
}

function showSideNotificationBubble(fullHTML) {
  if (!appElement.classList.contains('collapsed-x')) return;
  void showCollapsedBubbleMessage(fullHTML, SIDE_NOTIFICATION_BUBBLE_DURATION_MS);
}

async function suppressEyeMessageBubble() {
  if (eyeMessageScheduleTimer != null) {
    clearTimeout(eyeMessageScheduleTimer);
    eyeMessageScheduleTimer = null;
  }
  clearEyeMessageAnimationTimers();
  await hideEyeMessageOverlay();

  const wasBubbleActive = appElement.classList.contains('bubble-active');
  document.querySelectorAll('.eye-bubble').forEach((b) => {
    b.classList.remove('visible');
    b.classList.add('hidden');
  });
  appElement.classList.remove('bubble-active');

  if (!wasBubbleActive) return;

  const stillCollapsedY = appElement.classList.contains('collapsed-y');
  const stillCollapsedX = appElement.classList.contains('collapsed-x');
  if (!stillCollapsedY && !stillCollapsedX) return;

  try {
    const monitor = await currentMonitor();
    const currentPos = await appWindow.outerPosition();
    const currentSize = await appWindow.outerSize();
    if (!monitor) {
      if (stillCollapsedY) await appWindow.setSize(COLLAPSED_SIZE_Y);
      else await appWindow.setSize(COLLAPSED_SIZE_X);
      return;
    }
    const scale = monitor.scaleFactor;
    const { width: scrW } = monitor.size;
    const { x: offsetX } = monitor.position;
    const distRight = Math.abs((offsetX + scrW) - (currentPos.x + currentSize.width));

    if (stillCollapsedY) {
      await appWindow.setSize(COLLAPSED_SIZE_Y);
    } else {
      let endX = currentPos.x;
      if (distRight < 10) {
        const pRestoredW = COLLAPSED_SIZE_X.width * scale;
        endX = (offsetX + scrW) - pRestoredW;
      }

      const isRight = appElement.classList.contains('collapsed-right');
      if (isRight) {
        // Instant snap for right side to avoid IPC wobble
        await appWindow.setSize(COLLAPSED_SIZE_X);
        await appWindow.setPosition(new window.__TAURI__.window.PhysicalPosition(Math.round(endX), currentPos.y));
      } else {
        await animateWindowTransform(
          currentPos,
          { x: Math.round(endX), y: currentPos.y },
          currentSize,
          COLLAPSED_SIZE_X,
          100
        );
      }
    }
  } catch (e) {
    console.error('Failed to suppress eye message bubble:', e);
  }
}

async function showEyeMessage() {
  if (isNotificationActive) return;
  await showCollapsedBubbleMessage('i got my<br>eyes on you', 3000);
}

console.log('FlowPane initialized');

// Production Release UX Polish
(function() {
  const contextMenu = document.getElementById('context-menu');
  const aboutModal = document.getElementById('about-modal');
  const aboutVersion = document.getElementById('about-version');
  const aboutCloseBtn = document.getElementById('about-close-btn');
  const menuAbout = document.getElementById('menu-about');
  const menuPrivacy = document.getElementById('menu-privacy');
  const menuQuit = document.getElementById('menu-quit');

  if (contextMenu) {
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu.style.top = `${e.clientY}px`;
      contextMenu.style.left = `${e.clientX}px`;
      contextMenu.classList.remove('hidden');
    });

    document.addEventListener('click', () => {
      contextMenu.classList.add('hidden');
    });
  }

  if (menuAbout) {
    menuAbout.addEventListener('click', async () => {
      try {
        const version = await window.__TAURI__.core.invoke("get_app_version");
        if (aboutVersion) aboutVersion.textContent = `Version ${version}`;
        if (aboutModal) aboutModal.classList.remove('hidden');
      } catch (e) {
        console.error('Failed to get app version:', e);
      }
    });
  }

  if (menuPrivacy) {
    menuPrivacy.addEventListener('click', () => {
      // Open privacy policy in a new window or default browser
      // For simplicity, we use the opener plugin to open the GitHub link or local file
      // Since it's production prep, let's try to open the local file in a new window
      try {
        const { WebviewWindow } = window.__TAURI__.window;
        new WebviewWindow('privacy-policy', {
          url: 'assets/privacy_policy.html',
          title: 'FlowPane - Privacy Policy',
          width: 600,
          height: 800,
          resizable: true
        });
      } catch (e) {
        console.error('Failed to open privacy policy window:', e);
      }
    });
  }

  if (menuQuit) {
    menuQuit.addEventListener('click', () => {
      window.__TAURI__.process.exit(0);
    });
  }

  if (aboutCloseBtn) {
    aboutCloseBtn.addEventListener('click', () => {
      if (aboutModal) aboutModal.classList.add('hidden');
    });
  }

  // Onboarding Logic
  async function initOnboarding() {
    // Wait for store to be ready
    const checkStore = setInterval(async () => {
      if (typeof store !== 'undefined' && store !== null) {
        clearInterval(checkStore);
        try {
          const hasSeen = await store.get('hasSeenOnboarding');
          if (!hasSeen) {
            console.log('First launch detected. Showing onboarding...');
            // In a real app, we would show a nice overlay here.
            // For now, we'll just set the flag.
            await store.set('hasSeenOnboarding', true);
            await store.save();
          }
        } catch (e) {
          console.error('Onboarding check failed:', e);
        }
      }
    }, 500);
  }

  initOnboarding();
})();
