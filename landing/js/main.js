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
    if (performance.now() - idleSince > 2600) showBubble();
  }, 900);

  later(() => hint && hint.classList.add('is-shown'), 1600);
  later(() => hint && hint.classList.remove('is-shown'), 6000);
}

/* ═════════ THE PANE DOCKS ═════════
   Past the hero, the replica performs the app's own collapse-to-edge. */

const rig = document.getElementById('rig');
const hero = document.getElementById('top');
const nav = document.getElementById('nav');

const canDock = window.matchMedia('(min-width: 1180px)');
let docked = false;
let scrollFrame = null;

function onScroll() {
  scrollFrame = null;

  nav.classList.toggle('is-past', window.scrollY > 16);

  if (!rig || !hero || reduced.matches || !canDock.matches) return;

  const past = window.scrollY > hero.offsetHeight * 0.72;
  if (past === docked) return;
  docked = past;
  rig.classList.toggle('is-docked', past);
}

window.addEventListener('scroll', () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(onScroll);
}, { passive: true });

canDock.addEventListener('change', () => {
  if (!canDock.matches && rig) { rig.classList.remove('is-docked'); docked = false; }
});

onScroll();

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
