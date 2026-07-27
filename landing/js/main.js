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
}

const entering = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('is-in');
    entering.unobserve(entry.target);
  }
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });

document.querySelectorAll('.enter, .rail-seq').forEach((el) => entering.observe(el));

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
    if (bubbleOpen) hideBubble();
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

function showBubble() {
  if (bubbleOpen || !bubble || reduced.matches) return;
  /* Never speak over an open note, as in the app */
  if (paneEl && paneEl.classList.contains('is-note-open')) return;
  bubbleOpen = true;

  const tokens = tokenize(LINES[lineIndex % LINES.length]);
  lineIndex++;

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

/* Speak only when the visitor has actually gone still. */
if (!reduced.matches && bubble) {
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
const noteRow = document.getElementById('note-row');
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
  4: { title: '3am shower thoughts', body: 'what if the eyes blink back…\n\nteach the pane to wink 😉\nadopt a plant it can watch\nname the googly eyes' },
};

let activeTheme = null;

/* The pink list entry mirrors its note, as buildNoteItem does in the app. */
function syncNoteRow() {
  if (!noteRow || !noteRow.isConnected) return;
  const note = DEMO_NOTES[4];
  noteRow.querySelector('.fp-t').textContent = note.title.trim() || 'Untitled note';
  const firstLine = note.body.trim().split('\n')[0];
  noteRow.querySelector('.fp-note__sub').textContent = firstLine || 'Click to start writing... ✍️';
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

/* Delete buttons remove the row for real; a refresh restores the demo. */
function removeRow(row) {
  const height = row.offsetHeight;
  row.style.overflow = 'hidden';
  row.style.pointerEvents = 'none';
  row.animate(
    [
      { opacity: 1, height: `${height}px`, paddingTop: '14px', paddingBottom: '14px', transform: 'scale(1)' },
      { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'scale(0.96)' },
    ],
    { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
  ).onfinish = () => row.remove();
}

if (paneEl && noteRow && noteWs && noteExit) {
  noteWs.inert = true;

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

  noteRow.addEventListener('click', (e) => openNote(4, e));
  noteRow.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNote(4); }
  });

  document.querySelectorAll('.fp-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const theme = Number(tab.dataset.theme);
      if (activeTheme === theme) closeNote(e);
      else openNote(theme, e);
    });
  });

  noteExit.addEventListener('click', closeNote);

  document.querySelectorAll('.fp-x').forEach((x) =>
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      removeRow(x.closest('.fp-task'));
    }));
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
