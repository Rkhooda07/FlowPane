/* FlowPane Landing — behaviour
   The eyes and the thought bubble are ports of the app's own mechanics
   (src/js/main.js updateEyePupils, src/bubble.html typing loop). */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ═════════ ORCHESTRATED ENTRANCE ═════════
   One sequence on load, then scroll-entry per section. Not per-element fades. */

requestAnimationFrame(() => document.body.classList.add('is-cued'));

/* The stage must stop animating once entered, or its held transform keeps it
   a containing block and the docked pane can't fix to the viewport. */
const stage = document.querySelector('.hero__stage');
if (stage) {
  stage.addEventListener('animationend', () => stage.classList.add('is-settled'), { once: true });
  if (reduced.matches) stage.classList.add('is-settled');

  /* .hero__grid centers its two columns (align-items: center), so the
     stage's own height feeds back into where it sits — collapsing the pane
     to a 42px bar shrinks the stage, which re-centers the row, which
     silently drags the stage's untransformed position down mid-animation.
     The docked/collapsed math below assumes that position is fixed once a
     drag starts; without this it'd be computing against a moving target,
     which reads as the pane sliding away from an edge right after locking
     to it. Pin the footprint to its tallest natural size once, up front,
     so shrinking the pane later never reflows the row around it. */
  requestAnimationFrame(() => {
    stage.style.minHeight = `${stage.getBoundingClientRect().height}px`;
  });
}

const entering = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('is-in');
    entering.unobserve(entry.target);
  }
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });

document.querySelectorAll('.enter, .rail-seq').forEach((el) => entering.observe(el));

/* ═════════ WINDOW DRAG ═════════
   The title bar drags the whole preview around the page, exactly like the
   real app's frameless window drags by its title bar. Bounded to the
   viewport so it can't be dragged out of reach, with the site nav (fixed,
   above everything) left as the one thing it can't slide under.

   Once the visitor actually drags it somewhere, it docks: it keeps its
   screen position through scrolling instead of riding along with the page,
   the way a real floating window ignores the document under it. This is
   done with transform math (compensating translateY by the scroll delta)
   rather than switching to position: fixed, so the hero layout never
   reflows out from under it. */

const dragHandle = document.querySelector('.fp-bar');
const dragRig = document.getElementById('rig');
const focusPane = document.getElementById('pane');

/* Focus/hover visual state is shared between the drag logic below (a drag
   marks the pane "active") and the pointerenter/leave + outside-click
   listeners further down — declared here so both can reach it. */
let isActive = true;
let isHovering = false;

/* Which edge the pane is folded against, or null when it's a normal
   floating pane — read by the bubble logic further down too, so it's
   hoisted alongside the focus state above. */
let collapsedEdge = null;
let peeking = false;

function updateFocusVisual() {
  if (!focusPane || !dragRig) return;
  if (!dragRig.classList.contains('is-docked')) {
    focusPane.classList.remove('is-unfocused');
    return;
  }
  focusPane.classList.toggle('is-unfocused', !(isHovering || isActive));
}

if (dragHandle && dragRig) {
  let dragging = false;
  let pointerId = null;
  let startX = 0, startY = 0;
  let originX = 0, originY = 0; // translate this drag started from
  let dragX = 0, dragY = 0;     // raw pointer-follow translate — always where the
                                 // cursor wants the pane, regardless of collapse
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  let hasMoved = false;
  let rigWidth = 0;
  let originLeftAtDrop = 0, originTopAtDrop = 0; // set each drag, read while it's live

  let docked = false;
  let dockBaseX = 0, dockBaseY = 0, dockScrollY = 0;

  const EDGE_MARGIN = 72; // keep at least this much of the pane on screen
  const MOVE_THRESHOLD = 3; // px of pointer travel before a click counts as a drag

  /* ── Edge collapse ──
     Ported from src/js/main.js's onMoved handler: while dragging, once the
     pane is within TRIGGER_PX of a screen edge it collapses right there —
     live, mid-drag, after a short debounce (src/js/main.js collapseTimer,
     150ms) — rather than waiting for the drop. Only one axis locks to the
     edge; the other keeps tracking the cursor, so a collapsed bar still
     slides along its edge with the pointer. Dragging back out past
     EXPAND_PX un-collapses immediately, same as the app's dTop/dLeft/dRight
     checks. TRIGGER_PX stays tight (the app's own TRIGGER_TOP_SIDES is 6px)
     so it only folds once it's genuinely reached the edge, not merely near
     it. The top edge means the very top of the *page*, past the nav bar —
     the nav is fixed and never moves for this, the pane just tucks in
     above it (elevated z-index, see sections.css) so it stays visible.
     Never bottom — the app docks to a taskbar/dock there, which a page has
     no equivalent of. */
  const EDGE_TRIGGER_PX = 10;
  const EDGE_EXPAND_PX = 30;
  const COLLAPSE_DEBOUNCE_MS = 150;
  const COLLAPSE_LOCK_MS = 400; // hysteresis: ignore expand checks right after collapsing
  const PEEK_DELAY_MS = 150;    // src/js/constants.js HOVER_PEEK_DELAY_MS
  const UNPEEK_DELAY_MS = 260;
  const GROW_MS = 600; // >= --dur-4 (520ms): how long the right-edge grow-tracking runs

  let collapseTimer = null;
  let lastCollapseAt = -Infinity;
  let peekTimer = null;
  let rightTrackUntil = 0; // performance.now() deadline; while in the future, the
                            // right edge keeps re-measuring the pane's live (mid-
                            // transition) width instead of using a fixed value

  /* Where the pane's right edge should sit while collapsed (or freshly
     un-collapsing) against the right side of the screen. Reads the pane's
     *actual current* width every time, so it tracks correctly whichever
     direction it's animating — shrinking in as it collapses, growing back
     out as it's picked up — instead of jumping or overshooting off-screen
     mid-transition. Returns null when the right edge currently has no
     say over the x position. */
  function lockedRightX() {
    if (collapsedEdge !== 'right' && performance.now() >= rightTrackUntil) return null;
    return window.innerWidth - focusPane.getBoundingClientRect().width - originLeftAtDrop;
  }

  /* Paints the pane at its current position: the locked axis (if any) snaps
     to its edge, the other keeps following the raw drag. Returns what it
     applied, so callers can seed the post-drag dock baseline with it. */
  function renderTransform() {
    let rx = dragX, ry = dragY;
    const lockedX = lockedRightX();
    if (lockedX !== null) rx = lockedX;
    else if (collapsedEdge === 'left') rx = -originLeftAtDrop;
    if (collapsedEdge === 'top') ry = -originTopAtDrop;
    dragRig.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    return { rx, ry };
  }

  function applyCollapse(edge) {
    collapsedEdge = edge;
    peeking = false;
    focusPane.classList.remove('is-collapsed-y', 'is-collapsed-x', 'is-docked-right', 'is-peeking');
    dragRig.classList.remove('is-collapsed-y', 'is-collapsed-x');
    focusPane.classList.add(edge === 'top' ? 'is-collapsed-y' : 'is-collapsed-x');
    dragRig.classList.add(edge === 'top' ? 'is-collapsed-y' : 'is-collapsed-x');
    if (edge === 'right') focusPane.classList.add('is-docked-right');
    lastCollapseAt = performance.now();
    renderTransform();
  }

  function clearCollapse() {
    // Leaving a right-docked collapse: the bar is about to grow back to full
    // width. Keep tracking its live width against the right edge for a bit
    // longer so it un-collapses in place — an instant width change with no
    // position compensation would send it shooting off past the screen edge.
    if (collapsedEdge === 'right') rightTrackUntil = performance.now() + GROW_MS;
    collapsedEdge = null;
    peeking = false;
    focusPane.classList.remove('is-collapsed-y', 'is-collapsed-x', 'is-docked-right', 'is-peeking');
    dragRig.classList.remove('is-collapsed-y', 'is-collapsed-x');
  }

  /* Checked on every pointermove (debounced entry) and once more, immediate,
     on release — so a fast flick straight into a corner still collapses
     even if it never lingered past the debounce. */
  function evaluateEdges(immediate) {
    if (focusPane.classList.contains('is-note-open') || focusPane.classList.contains('is-focus-open')) return;

    const screenLeft = originLeftAtDrop + dragX;
    const dTop = originTopAtDrop + dragY;
    const dLeft = screenLeft;
    const dRight = window.innerWidth - (screenLeft + rigWidth);

    if (!collapsedEdge) {
      let edge = null;
      if (dTop <= EDGE_TRIGGER_PX) edge = 'top';
      else if (dLeft <= EDGE_TRIGGER_PX) edge = 'left';
      else if (dRight <= EDGE_TRIGGER_PX) edge = 'right';

      clearTimeout(collapseTimer);
      if (edge) {
        if (immediate) applyCollapse(edge);
        else collapseTimer = setTimeout(() => applyCollapse(edge), COLLAPSE_DEBOUNCE_MS);
      }
    } else if (performance.now() - lastCollapseAt >= COLLAPSE_LOCK_MS) {
      const movedAway = collapsedEdge === 'top'
        ? dTop > EDGE_EXPAND_PX
        : dLeft > EDGE_EXPAND_PX && dRight > EDGE_EXPAND_PX;
      if (movedAway) clearCollapse();
    }
  }

  function schedulePeek() {
    if (!collapsedEdge || dragging) return;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      if (!collapsedEdge || dragging) return;
      peeking = true;
      focusPane.classList.add('is-peeking');
    }, PEEK_DELAY_MS);
  }

  function scheduleUnpeek() {
    clearTimeout(peekTimer);
    if (!peeking) return;
    peekTimer = setTimeout(() => {
      peeking = false;
      focusPane.classList.remove('is-peeking');
    }, UNPEEK_DELAY_MS);
  }

  dragHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('#note-exit')) return;

    dragRig.classList.add('is-dragging');

    // dragX/dragY only track the pointer while a drag is actually in
    // progress — once it ends, the pane is repositioned by dockLoop's own
    // scroll-compensated transform instead, and while collapsed the locked
    // axis is repositioned by renderTransform(). Neither writes back into
    // dragX/dragY, so both would be stale here; read the transform that's
    // truly on screen right now instead of trusting them.
    const liveTransform = new DOMMatrixReadOnly(getComputedStyle(dragRig).transform);
    dragX = liveTransform.m41;
    dragY = liveTransform.m42;

    // Picking a collapsed bar back up un-collapses it with the same eased
    // grow the app uses on manual move (src/js/main.js onMoved: peek.active
    // -> animateWindowSize, ~250-500ms) instead of snapping instantly — the
    // width/height transition on the pane classes handles that on its own.
    // The one exception is a right-docked bar: clearCollapse() keeps
    // tracking it against the right edge for the duration of that grow (see
    // lockedRightX), so it un-collapses in place instead of overshooting.
    if (collapsedEdge) {
      clearTimeout(peekTimer);
      clearCollapse();
    }

    const rect = dragRig.getBoundingClientRect();
    const originLeft = rect.left - dragX;
    const originTop = rect.top - dragY;

    rigWidth = rect.width;
    originLeftAtDrop = originLeft;
    originTopAtDrop = originTop;

    minX = EDGE_MARGIN - rect.width - originLeft;
    maxX = window.innerWidth - EDGE_MARGIN - originLeft;
    minY = -originTop; // the very top of the page — past the nav, which stays put
    maxY = window.innerHeight - EDGE_MARGIN - originTop;

    startX = e.clientX;
    startY = e.clientY;
    originX = dragX;
    originY = dragY;
    hasMoved = false;

    dragging = true;
    pointerId = e.pointerId;
    dragHandle.setPointerCapture(pointerId);
    document.body.classList.add('is-dragging-pane');
    if (bubbleOpen) hideBubble();
  });

  dragHandle.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    if (!hasMoved && Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_THRESHOLD) {
      hasMoved = true;
      // Real dragging has begun while still growing out of a right-docked
      // collapse: hand off from the live edge-tracking to plain pointer
      // -follow right now, rebasing so the cut-over doesn't jump.
      if (performance.now() < rightTrackUntil) {
        const liveX = lockedRightX();
        if (liveX !== null) originX = liveX - (e.clientX - startX);
        rightTrackUntil = 0;
      }
    }
    dragX = Math.min(maxX, Math.max(minX, originX + (e.clientX - startX)));
    dragY = Math.min(maxY, Math.max(minY, originY + (e.clientY - startY)));
    renderTransform();
    if (hasMoved) evaluateEdges(false);
  });

  function endDrag(e) {
    if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
    dragging = false;
    pointerId = null;
    dragRig.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-pane');
    clearTimeout(collapseTimer);

    if (hasMoved) {
      if (!collapsedEdge) evaluateEdges(true);

      docked = true;
      dragRig.classList.add('is-docked');
      isActive = true;

      const { rx, ry } = renderTransform();
      dockBaseX = rx;
      dockBaseY = ry;
      dockScrollY = window.scrollY;
      updateFocusVisual();
    }
  }

  dragHandle.addEventListener('pointerup', endDrag);
  dragHandle.addEventListener('pointercancel', endDrag);

  focusPane.addEventListener('pointerenter', schedulePeek);
  focusPane.addEventListener('pointerleave', scheduleUnpeek);

  /* A continuous rAF loop rather than a scroll-event listener: scroll events
     can fire a frame or two behind the compositor's own scroll updates,
     which reads as jitter. Sampling window.scrollY every painted frame
     keeps it glued to the same spot with no lag.

     It also repaints while actively dragging, not just once docked —
     pointermove already calls renderTransform() on every move for
     zero-lag pointer tracking, but a pickup that hasn't moved yet (still
     mid-grow, no pointermove fired at all) would otherwise sit frozen at
     whatever renderTransform last painted, since nothing else would be
     calling it. Same story for the right edge specifically (lockedRightX):
     a collapse/grow animation still running when the pointer is released
     needs to keep being repainted, not freeze wherever dockBaseX happened
     to land at that instant. */
  function dockLoop() {
    if (dragging) {
      renderTransform();
    } else if (docked) {
      const x = lockedRightX() ?? dockBaseX;
      dragRig.style.transform = `translate3d(${x}px, ${dockBaseY + (window.scrollY - dockScrollY)}px, 0)`;
    }
    requestAnimationFrame(dockLoop);
  }
  requestAnimationFrame(dockLoop);
}

/* ═════════ FOCUS / HOVER DIMMING ═════════
   The real app dims to 40% opacity + desaturates when the OS moves focus to
   another window, but brightens back up on hover even then — src/js/main.js
   updateFocusState(): focused if hovered, or if no window is hovered and
   this one was the last active one (src/css/reset.css #app:not(.focused)).
   There's no OS window focus on a page, so a drag stands in for "this one
   is active" and a click outside for "focus moved elsewhere" — but until
   the visitor actually drags it once, it stays put, bright, undimmable
   (see updateFocusVisual above). */

if (focusPane) {
  focusPane.addEventListener('pointerenter', () => {
    isHovering = true;
    updateFocusVisual();
  });

  focusPane.addEventListener('pointerleave', () => {
    isHovering = false;
    updateFocusVisual();
  });

  document.addEventListener('pointerdown', (e) => {
    isActive = !!e.target.closest('#pane');
    updateFocusVisual();
  });
}

/* ═════════ EYES ═════════
   Every .eye on the page tracks the real cursor, exactly as the app tracks
   the OS cursor. Pupil travel is clamped so it stays inside the sclera. */

const eyes = [...document.querySelectorAll('.eye')];
let cursor = null;
let eyeFrame = null;

function aimEyes() {
  eyeFrame = null;
  if (!cursor) return;

  for (const eye of eyes) {
    const pupil = eye.firstElementChild;
    if (!pupil) continue;

    const box = eye.getBoundingClientRect();
    if (box.width === 0) continue;

    const dx = cursor.x - (box.left + box.width / 2);
    const dy = cursor.y - (box.top + box.height / 2);
    const angle = Math.atan2(dy, dx);
    const bound = (box.width - pupil.offsetWidth) / 2;
    const reach = Math.min(Math.hypot(dx, dy) / 9, bound);

    pupil.style.transform =
      `translate3d(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px, 0)`;
  }
}

if (!reduced.matches) {
  window.addEventListener('pointermove', (e) => {
    cursor = { x: e.clientX, y: e.clientY };
    idleSince = performance.now();
    if (!eyeFrame) eyeFrame = requestAnimationFrame(aimEyes);
  }, { passive: true });

  window.addEventListener('scroll', () => {
    if (cursor && !eyeFrame) eyeFrame = requestAnimationFrame(aimEyes);
  }, { passive: true });
}

/* ═════════ THOUGHT BUBBLE ═════════
   Same pop-in, same 30ms/char typing, same burst-out as the app. */

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const hint = document.querySelector('.stage__hint');

const LINES = [
  'you can drag<br>me around',
  'i got my<br>eyes on you',
  'still on<br>that one?',
  'shall we<br>start the clock',
  'it can wait<br>up here',
];

let bubbleOpen = false;
let lineIndex = 0;
let idleSince = performance.now();
const timers = new Set();

function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
  timers.add(id);
  return id;
}

function clearTimers() {
  for (const id of timers) { clearTimeout(id); clearInterval(id); }
  timers.clear();
}

function tokenize(html) {
  const out = [];
  for (let i = 0; i < html.length; i++) {
    if (html.startsWith('<br>', i)) { out.push('<br>'); i += 3; }
    else out.push(html[i]);
  }
  return out;
}

function typeIn(tokens) {
  let n = 0;
  const id = setInterval(() => {
    if (!bubbleOpen) { clearInterval(id); timers.delete(id); return; }
    bubbleText.innerHTML = tokens.slice(0, ++n).join('');
    if (n >= tokens.length) { clearInterval(id); timers.delete(id); }
  }, 30);
  timers.add(id);
}

function showBubble(customMsg) {
  if (bubbleOpen || !bubble || reduced.matches) return;
  /* Never speak over an open note, as in the app */
  if (paneEl && paneEl.classList.contains('is-note-open')) return;
  /* Nor over a collapsed edge bar — there's nowhere for it to pop out of
     until the visitor peeks it back open */
  if (collapsedEdge && !peeking) return;
  bubbleOpen = true;

  const msg = customMsg || LINES[lineIndex % LINES.length];
  if (!customMsg) lineIndex++;

  const tokens = tokenize(msg);

  bubbleText.innerHTML = '';
  bubble.classList.remove('is-out');
  bubble.classList.add('is-shown');
  later(() => typeIn(tokens), 380);
  later(hideBubble, 4200);
}

function hideBubble() {
  if (!bubbleOpen) return;
  bubbleOpen = false;
  clearTimers();
  bubble.classList.remove('is-shown');
  bubble.classList.add('is-out');
  later(() => {
    bubble.classList.remove('is-out');
    bubbleText.innerHTML = '';
  }, 500);
}

/* The very first line introduces the drag affordance, so it fires fast on
   its own timer rather than waiting for the visitor to go idle. After that,
   speak only when they've actually gone still. */
if (!reduced.matches && bubble) {
  later(() => { if (!bubbleOpen) showBubble(); }, 1000);

  setInterval(() => {
    if (bubbleOpen) return;
    if (performance.now() - idleSince > 1500) showBubble();
  }, 500);

  later(() => hint && hint.classList.add('is-shown'), 1600);
  later(() => hint && hint.classList.remove('is-shown'), 6000);
}

/* ═════════ NAV SHADE ═════════ */

const nav = document.getElementById('nav');
let scrollFrame = null;

function onScroll() {
  scrollFrame = null;
  nav.classList.toggle('is-past', window.scrollY > 16);
}

window.addEventListener('scroll', () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(onScroll);
}, { passive: true });

onScroll();

/* ═════════ NOTE WORKSPACE ═════════
   Clicking a note (the list entry or a sticky tab) performs the app's own
   circular reveal (openNote / closeNote in src/js/main.js): clip-path
   circle from the click point, themed to the note's colour. */

const paneEl = document.getElementById('pane');
const noteWs = document.getElementById('note-ws');
const noteExit = document.getElementById('note-exit');
const noteTitleEl = document.querySelector('.fp-title__note');
const noteWsTitle = document.getElementById('note-ws-title');
const noteWsBody = document.getElementById('note-ws-body');

/* One demo note per sticky-tab colour; theme 4 is the pink list entry.
   Edits persist per-note for the session only — a refresh restores these. */
const DEMO_NOTES = {
  1: { title: 'ideas that slap', body: 'a pane that cheers when you finish 🎉\nkeyboard-only mode\ntiny rain sounds for focus' },
  2: { title: 'do not forget', body: 'cancel that one free trial 💸\nreply to mum\nstretch. actually stretch.' },
  3: { title: 'weekend quests', body: 'find the best croissant in town 🥐\nfix the squeaky chair\nbeat my 25:00 focus record' },
  4: { title: 'sunday brain dump', body: 'stop checking email before coffee\nblock deep work before lunch, not after\nthat 2pm meeting could\'ve been a message\nnew plant for the desk — apparently it helps' },
};

let activeTheme = null;

// Dynamic list items
let activeItems = [
  { id: 'task-1', type: 'task', title: 'Ship it before the coffee dies ☕', due: 'Due in 9 mins', urgent: true },
  { id: 'task-2', type: 'task', title: 'Fix the production bug 🐛', due: '<b>∞</b> Plenty of time', urgent: false },
  { id: 'note-4', type: 'note', theme: 4 }
];

let completedTasks = [];
let activeFilter = 'all'; // 'all', 'tasks', 'notes'
let isHistoryOpen = false;
let isFocusOpen = false;
let taskCounter = 2;

const listEl = document.querySelector('.fp-list');

function renderList() {
  if (!listEl) return;
  listEl.innerHTML = '';

  if (isHistoryOpen) {
    if (completedTasks.length === 0) {
      listEl.innerHTML = `
        <div class="fp-empty">
          <div class="fp-empty__icon">✨</div>
          <div class="fp-empty__text">Your finished tasks will land here</div>
          <div class="fp-empty__sub">Keep up the flow, you're doing great!</div>
        </div>
      `;
      return;
    }

    completedTasks.forEach(item => {
      const li = document.createElement('li');
      li.className = 'fp-task fp-completed';
      li.dataset.id = item.id;
      li.innerHTML = `
        <span class="fp-check is-checked"></span>
        <span class="fp-info">
          <span class="fp-t" style="text-decoration: line-through; opacity: 0.5;"></span>
          <span class="fp-due">Completed ${item.completedTime}</span>
        </span>
        <button class="fp-x" type="button" aria-label="Delete">×</button>
      `;
      li.querySelector('.fp-t').textContent = item.title;
      listEl.appendChild(li);
    });
    return;
  }

  // Filter active items
  let itemsToShow = activeItems;
  if (activeFilter === 'tasks') {
    itemsToShow = activeItems.filter(item => item.type === 'task');
  } else if (activeFilter === 'notes') {
    itemsToShow = activeItems.filter(item => item.type === 'note');
  }

  if (itemsToShow.length === 0) {
    if (activeFilter === 'tasks') {
      listEl.innerHTML = `
        <div class="fp-empty">
          <div class="fp-empty__icon">🎯</div>
          <div class="fp-empty__text">No active tasks</div>
          <div class="fp-empty__sub">Add a task or take a breather!</div>
        </div>
      `;
    } else if (activeFilter === 'notes') {
      listEl.innerHTML = `
        <div class="fp-empty">
          <div class="fp-empty__icon">📝</div>
          <div class="fp-empty__text">No notes here</div>
          <div class="fp-empty__sub">Open a tab to create one.</div>
        </div>
      `;
    } else {
      listEl.innerHTML = `
        <div class="fp-empty">
          <div class="fp-empty__icon">🏖️</div>
          <div class="fp-empty__text">All caught up!</div>
          <div class="fp-empty__sub">Nothing to do, enjoy your time.</div>
        </div>
      `;
    }
    return;
  }

  itemsToShow.forEach(item => {
    const li = document.createElement('li');
    li.dataset.id = item.id;
    if (item.type === 'task') {
      li.className = 'fp-task' + (item.urgent ? ' fp-urgent' : '');
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-label', 'Open focus mode for this task');
      li.innerHTML = `
        <span class="fp-check"></span>
        <span class="fp-info">
          <span class="fp-t"></span>
          <span class="fp-due">${item.due}</span>
        </span>
        <button class="fp-x" type="button" aria-label="Delete">×</button>
      `;
      li.querySelector('.fp-t').textContent = item.title;
    } else {
      const note = DEMO_NOTES[item.theme];
      const firstLine = note.body.trim().split('\n')[0];
      li.className = 'fp-task fp-note';
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-label', 'Open the note');
      li.innerHTML = `
        <span class="fp-swatch"></span>
        <span class="fp-info">
          <span class="fp-t"></span>
          <span class="fp-due fp-note__sub"></span>
        </span>
        <button class="fp-x" type="button" aria-label="Delete">×</button>
      `;
      li.querySelector('.fp-t').textContent = note.title.trim() || 'Untitled note';
      li.querySelector('.fp-note__sub').textContent = firstLine || 'Click to start writing... ✍️';
    }
    listEl.appendChild(li);
  });
}

/* The pink list entry mirrors its note, as buildNoteItem does in the app. */
function syncNoteRow() {
  renderList();
}

function setRevealOrigin(e) {
  const box = noteWs.getBoundingClientRect();
  const x = e && box.width ? ((e.clientX - box.left) / box.width) * 100 : 50;
  const y = e && box.height ? ((e.clientY - box.top) / box.height) * 100 : 100;
  noteWs.style.setProperty('--reveal-x', `${x}%`);
  noteWs.style.setProperty('--reveal-y', `${y}%`);
}

function clearActiveTab() {
  document.querySelectorAll('.fp-tab.note-active').forEach((t) => t.classList.remove('note-active'));
}

function openNote(theme, e) {
  const note = DEMO_NOTES[theme];
  if (!note) return;

  noteWs.classList.remove('theme-1', 'theme-2', 'theme-3', 'theme-4');
  noteWs.classList.add(`theme-${theme}`);
  noteWsTitle.value = note.title;
  noteWsBody.value = note.body;
  if (noteTitleEl) noteTitleEl.textContent = note.title.trim() || 'Untitled note';

  clearActiveTab();
  const tab = document.querySelector(`.fp-tab--${theme}`);
  if (tab) tab.classList.add('note-active');

  setRevealOrigin(e);
  activeTheme = theme;
  paneEl.classList.add('is-note-open');
  noteWs.setAttribute('aria-hidden', 'false');
  noteWs.inert = false;
  if (bubbleOpen) hideBubble();

  /* As the app does: an untitled note gets the title caret, otherwise
     the body, with the caret at the end. */
  const target = note.title.trim() ? noteWsBody : noteWsTitle;
  target.focus({ preventScroll: true });
  const end = target.value.length;
  target.setSelectionRange(end, end);
}

function closeNote(e) {
  setRevealOrigin(e);
  activeTheme = null;
  clearActiveTab();
  paneEl.classList.remove('is-note-open');
  noteWs.setAttribute('aria-hidden', 'true');
  noteWs.inert = true;
}

function closeNoteOrHistory(e) {
  if (isFocusOpen) {
    closeFocus();
  } else if (isHistoryOpen) {
    isHistoryOpen = false;
    paneEl.classList.remove('is-history-open');
    const historyBtn = document.querySelector('.fp-history');
    if (historyBtn) historyBtn.classList.remove('is-on');
    renderList();
  } else {
    closeNote(e);
  }
}

/* ═════════ FOCUS MODE PREVIEW ═════════
   Clicking a task opens the app's real focus-mode chrome (src/css/focus-mode.css),
   but the scene is blurred and locked — the countdown never actually runs here. */

const focusWs = document.getElementById('focus-ws');
const focusWsTask = document.getElementById('focus-ws-task');
const focusWsQuote = document.querySelector('.fp-focus-ws__quote');

const FOCUS_QUOTES = [
  'Small steps, steady pace.',
  'One thing. Then the next.',
  'Quiet mind, clear list.',
  'This is the only tab that matters.',
];

function openFocus(task) {
  if (!paneEl || !focusWs || !task) return;

  if (isHistoryOpen) {
    isHistoryOpen = false;
    paneEl.classList.remove('is-history-open');
    const historyBtn = document.querySelector('.fp-history');
    if (historyBtn) historyBtn.classList.remove('is-on');
  }
  if (activeTheme) closeNote();
  if (bubbleOpen) hideBubble();

  isFocusOpen = true;
  focusWsTask.textContent = task.title;
  if (focusWsQuote) focusWsQuote.textContent = FOCUS_QUOTES[Math.floor(Math.random() * FOCUS_QUOTES.length)];
  paneEl.classList.add('is-focus-open');
  focusWs.setAttribute('aria-hidden', 'false');
  if (noteExit) noteExit.setAttribute('aria-label', 'Exit focus mode');
}

function closeFocus() {
  if (!isFocusOpen) return;
  isFocusOpen = false;
  paneEl.classList.remove('is-focus-open');
  focusWs.setAttribute('aria-hidden', 'true');
  if (noteExit) noteExit.setAttribute('aria-label', 'Close note');
}

if (paneEl && noteWs && noteExit) {
  noteWs.inert = true;

  // Render initial list
  renderList();

  noteWsTitle.addEventListener('input', () => {
    if (!activeTheme) return;
    DEMO_NOTES[activeTheme].title = noteWsTitle.value;
    if (noteTitleEl) noteTitleEl.textContent = noteWsTitle.value.trim() || 'Untitled note';
    if (activeTheme === 4) syncNoteRow();
  });

  noteWsBody.addEventListener('input', () => {
    if (!activeTheme) return;
    DEMO_NOTES[activeTheme].body = noteWsBody.value;
    if (activeTheme === 4) syncNoteRow();
  });

  document.querySelectorAll('.fp-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const theme = Number(tab.dataset.theme);
      if (activeTheme === theme) closeNote(e);
      else {
        // If history is open, close it first
        if (isHistoryOpen) {
          isHistoryOpen = false;
          paneEl.classList.remove('is-history-open');
          const historyBtn = document.querySelector('.fp-history');
          if (historyBtn) historyBtn.classList.remove('is-on');
          renderList();
        }
        openNote(theme, e);
      }
    });
  });

  noteExit.addEventListener('click', closeNoteOrHistory);

  // Click handler delegation for the list
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const check = e.target.closest('.fp-check');
      const xBtn = e.target.closest('.fp-x');
      const noteRow = e.target.closest('.fp-note');
      const li = e.target.closest('.fp-task');

      if (check && li) {
        e.stopPropagation();
        const id = li.dataset.id;
        
        if (isHistoryOpen) {
          // Restore task
          const idx = completedTasks.findIndex(t => t.id === id);
          if (idx !== -1) {
            const task = completedTasks[idx];
            completedTasks.splice(idx, 1);
            task.completed = false;
            task.urgent = false;
            activeItems.push(task);
            renderList();
          }
        } else {
          // Complete task
          const idx = activeItems.findIndex(t => t.id === id);
          if (idx !== -1) {
            li.classList.add('task-completing');

            // Smoothly collapse the height, padding, and gap of the item in parallel
            const height = li.offsetHeight;
            li.style.overflow = 'hidden';
            li.style.pointerEvents = 'none';
            li.animate(
              [
                { height: `${height}px`, paddingTop: '14px', paddingBottom: '14px', marginBottom: '0px' },
                { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-8px' }
              ],
              { duration: 380, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
            );

            // History icon animation
            const historyBtn = document.querySelector('.fp-history');
            if (historyBtn) {
              setTimeout(() => {
                historyBtn.classList.add('history-uplift');
                setTimeout(() => historyBtn.classList.remove('history-uplift'), 600);
              }, 50);
            }

            // Speak congrats bubble
            const CONGRATS_LINES = [
              'well done! 🎉',
              'completed! ✨',
              'nice focus! 💪',
              'crushing it! 🚀',
              'keep it up! 🌊'
            ];
            const congrats = CONGRATS_LINES[Math.floor(Math.random() * CONGRATS_LINES.length)];
            showBubble(congrats);

            setTimeout(() => {
              const task = activeItems[idx];
              activeItems.splice(idx, 1);

              const date = new Date();
              let hours = date.getHours();
              const minutes = String(date.getMinutes()).padStart(2, '0');
              const ampm = hours >= 12 ? 'pm' : 'am';
              hours = hours % 12;
              hours = hours ? hours : 12;
              const timeStr = `${hours}:${minutes} ${ampm}`;

              task.completed = true;
              task.completedTime = `at ${timeStr}`;
              completedTasks.push(task);
              renderList();
            }, 380);
          }
        }
      } else if (xBtn && li) {
        e.stopPropagation();
        const id = li.dataset.id;
        const height = li.offsetHeight;
        li.style.overflow = 'hidden';
        li.style.pointerEvents = 'none';
        li.animate(
          [
            { opacity: 1, height: `${height}px`, paddingTop: '14px', paddingBottom: '14px', marginBottom: '0px', transform: 'scale(1)' },
            { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-8px', transform: 'scale(0.96)' },
          ],
          { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        ).onfinish = () => {
          activeItems = activeItems.filter(item => item.id !== id);
          completedTasks = completedTasks.filter(item => item.id !== id);
          renderList();
        };
      } else if (noteRow) {
        e.stopPropagation();
        openNote(4, e);
      } else if (li && !isHistoryOpen) {
        const task = activeItems.find(t => t.id === li.dataset.id);
        if (task) openFocus(task);
      }
    });

    listEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const noteRow = e.target.closest('.fp-note');
      const li = e.target.closest('.fp-task');
      if (noteRow) {
        e.preventDefault();
        openNote(4);
      } else if (li && !isHistoryOpen) {
        e.preventDefault();
        const task = activeItems.find(t => t.id === li.dataset.id);
        if (task) openFocus(task);
      }
    });
  }

  // Add-task input: mirrors the app's "type it, hit enter" flow
  const taskInput = document.getElementById('fp-task-input');
  if (taskInput) {
    taskInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const title = taskInput.value.trim();
      if (!title) return;

      activeItems.unshift({
        id: `task-${++taskCounter}`,
        type: 'task',
        title,
        due: '<b>∞</b> Plenty of time',
        urgent: false,
      });
      taskInput.value = '';
      if (activeFilter === 'notes') {
        pills.forEach(p => p.classList.remove('is-on'));
        const allPill = [...pills].find(p => p.textContent.toLowerCase() === 'all');
        if (allPill) allPill.classList.add('is-on');
        activeFilter = 'all';
      }
      if (isHistoryOpen) {
        isHistoryOpen = false;
        paneEl.classList.remove('is-history-open');
        const historyBtn = document.querySelector('.fp-history');
        if (historyBtn) historyBtn.classList.remove('is-on');
      }
      renderList();
    });
  }

  // Filter bar pills logic
  const pills = document.querySelectorAll('.fp-filter__pills b');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      // Close history if active
      if (isHistoryOpen) {
        isHistoryOpen = false;
        paneEl.classList.remove('is-history-open');
        const historyBtn = document.querySelector('.fp-history');
        if (historyBtn) historyBtn.classList.remove('is-on');
      }
      pills.forEach(p => p.classList.remove('is-on'));
      pill.classList.add('is-on');
      activeFilter = pill.textContent.toLowerCase();
      renderList();
    });
  });

  // History button toggle logic
  const historyBtn = document.querySelector('.fp-history');
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      // Toggle history view
      if (isHistoryOpen) {
        isHistoryOpen = false;
        paneEl.classList.remove('is-history-open');
        historyBtn.classList.remove('is-on');
      } else {
        // If note is open, close it first
        if (activeTheme) closeNote();
        isHistoryOpen = true;
        paneEl.classList.add('is-history-open');
        historyBtn.classList.add('is-on');
      }
      renderList();
    });
  }
}

/* ═════════ MOBILE DRAWER ═════════ */

const burger = document.getElementById('burger');
const drawer = document.getElementById('drawer');
const veil = document.getElementById('veil');

function setDrawer(open) {
  burger.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';

  if (open) {
    drawer.hidden = false;
    veil.hidden = false;
    requestAnimationFrame(() => {
      drawer.classList.add('is-open');
      veil.classList.add('is-open');
    });
    return;
  }

  drawer.classList.remove('is-open');
  veil.classList.remove('is-open');
  setTimeout(() => {
    if (burger.getAttribute('aria-expanded') === 'true') return;
    drawer.hidden = true;
    veil.hidden = true;
  }, 320);
}

burger.addEventListener('click', () => {
  setDrawer(burger.getAttribute('aria-expanded') !== 'true');
});

veil.addEventListener('click', () => setDrawer(false));
drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setDrawer(false)));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
    setDrawer(false);
    burger.focus();
  }
});

/* ═════════ ANCHOR SCROLL ═════════ */

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const id = link.getAttribute('href');
    if (id === '#') return;
    const target = document.querySelector(id);
    if (!target) return;

    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - nav.offsetHeight - 12;
    window.scrollTo({ top, behavior: reduced.matches ? 'auto' : 'smooth' });
  });
});
