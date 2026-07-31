#!/usr/bin/env node
// Build step — generates the animated Dock icon frame set.
//
// Composites a procedurally shaded pupil onto a pupil-less base plate, so every
// frame shares byte-identical background, ovals and glow. Only the pupil moves.
//
//   node scripts/build-dock-frames.mjs [options]
//
//   --base <png>    Base plate: eye whites, glow, background, no pupils.
//                   Defaults to deriving one from src/assets/FlowPane_logo.png
//                   by inpainting its pupils away.
//   --blink <png>   Closed-eye frame. Passed through and resized; skipped if absent.
//   --out <dir>     Output directory (default src-tauri/assets/dock).
//   --size <px>     Output edge length (default 512). The largest standard Dock
//                   icon is 128pt, so 512 already leaves Retina headroom.
//   --travel <0..1> Gaze offset as a fraction of the maximum in-eye travel.
//   --squircle <n>  Superellipse exponent for the alpha mask (default 5.4, the
//                   measured fit to the FlowPane artwork). Ignored when the base
//                   plate already carries an alpha channel.
//   --grid <0..1>   Share of the canvas edge the icon body occupies. Default
//                   824/1024 — Apple's macOS icon grid — so FlowPane sits at the
//                   same visual size as its Dock neighbours.
//
// Run this when the source artwork changes and commit the output. The Rust side
// loads the pre-rendered PNGs; nothing here runs at runtime.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { decodePNG, encodePNG } from './lib/png.mjs';
import {
  findEyes,
  bodyBounds,
  inpaintDisc,
  applySquircleAlpha,
  hasAlpha,
  placeOnGrid,
  clamp,
  smoothstep,
  APPLE_GRID,
  FLOWPANE_SQUIRCLE,
} from './lib/raster.mjs';

// The blink frame is separate artwork, so its backdrop is an independent render:
// it differs from the base plate by ~2/255 across the whole canvas even where
// nothing changed, which would make every blink nudge the entire icon. Only the
// lids and the glow they cast are grafted onto the plate; the rest comes from
// the plate itself. Measured falloff of the plate/blink difference, in native px
// beyond the eye bounding box: ~13/255 at the edge, 3.4 by 100px, and level with
// render noise past 150px — so the graft is opaque to `core` and fades out by
// `core + feather`, well inside the noise floor.
const LID_GRAFT = { core: 60, feather: 100 };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Where the pupils sit at rest in the reference logo, per eye, as a fraction of
// that eye's half-size. This is the shipped brand pose, so it is the neutral the
// animation departs from and returns to — `idle-center` reproduces it rather
// than centring the pupils, and every gaze offset is measured from here.
//
// The two eyes differ: the left pupil sits further right than the right one,
// which converges the gaze slightly. That asymmetry is deliberate in the
// artwork, so it is preserved per eye rather than averaged away.
const REST = [
  [0.351, -0.269],
  [0.233, -0.268],
];

// ── Pupil appearance, sampled from src/assets/FlowPane_logo.png ──────────────
// See the table in scripts/README-dock-frames.md for how these were measured.
const PUPIL = {
  radiusRatio: 0.353,           // of the eye white's half-width
  clearance: 1.18,              // eye white kept visible around the pupil, in units of r
  bodyShadow: [30, 25, 21],     // warm charcoal on the side facing away from the light
  bodyLit: [58, 50, 41],        // and on the side facing into it
  rim: [74, 63, 51],            // slight warm lift at the very edge, from the surrounding glow
  rimStart: 0.86,               // where the rim ramp begins, in units of r
  specular: [233, 189, 134],    // warm amber highlight
  specularAt: [-0.57, -0.63],   // upper-left, in units of r
  specularCore: 0.2,            // hot core radius, in units of r
  specularSoft: 0.07,           // softness of the core edge, in units of r
  specularBloom: 0.5,           // faint surrounding glow, in units of r
  specularBloomWeight: 0.16,
  aoOuter: 1.6,                 // contact shadow reach, in units of r
  aoStrength: 0.28,             // peak darkening of the eye white at the pupil edge
  aoDirection: [0.6, 0.8],      // shadow falls down-right, away from the key light
  aoAmbient: 0.3,               // share of the shadow that is omnidirectional
};

// Key light direction, taken from where the specular sits on the sphere:
// the surface normal at the highlight points straight at the light.
const LIGHT = (() => {
  const [x, y] = PUPIL.specularAt;
  return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
})();

function parseArgs(argv) {
  const args = {
    base: null,
    blink: null,
    out: join(ROOT, 'src-tauri/assets/dock'),
    size: 512,
    travel: 0.3,
    squircle: FLOWPANE_SQUIRCLE,
    grid: APPLE_GRID,
  };
  const numeric = new Set(['size', 'travel', 'squircle', 'grid']);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (!(key in args)) throw new Error(`Unknown option --${key}`);
    if (value === undefined) throw new Error(`Option --${key} needs a value`);
    args[key] = numeric.has(key) ? Number(value) : value;
  }
  return args;
}

/** Derive a base plate from the shipped logo by erasing its pupils. */
function deriveBasePlate() {
  const logoPath = join(ROOT, 'src/assets/FlowPane_logo.png');
  const image = decodePNG(readFileSync(logoPath));
  const eyes = findEyes(image);

  for (const [n, eye] of eyes.entries()) {
    const r = eye.halfWidth * PUPIL.radiusRatio;
    const px = eye.cx + eye.halfWidth * REST[n][0];
    const py = eye.cy + eye.halfHeight * REST[n][1];

    // Stay well clear of the rim light — it is a wide bright band, and sampling
    // it drags streaks into the fill.
    const inset = Math.round(eye.halfWidth * 0.09);
    const isInside = (x, y) => {
      const span = eye.spans[y];
      return !!span && x >= span[0] + inset && x <= span[1] - inset;
    };

    // Wide enough to take the old contact shadow with the pupil, tight enough
    // that the boundary ring stays on clean eye white.
    inpaintDisc(image, px, py, r * 1.75, isInside);
  }

  return image;
}

/** Composite one shaded pupil sphere onto `image` at (cx, cy) with radius r. */
function drawPupil(image, cx, cy, r) {
  const { width, height, data } = image;
  const reach = r * PUPIL.aoOuter;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(width - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(height - 1, Math.ceil(cy + reach));

  const specX = cx + PUPIL.specularAt[0] * r;
  const specY = cy + PUPIL.specularAt[1] * r;
  const aa = Math.max(0.75, r * 0.012); // edge softness in pixels

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      if (d > reach) continue;

      // 1. Contact shadow on the eye white. Mostly directional — the sphere
      //    casts down-right, away from the key light — with a little ambient
      //    occlusion all the way round.
      const falloff = 1 - smoothstep(r * 0.95, reach, d);
      const dir = d > 0.001
        ? clamp(((x - cx) * PUPIL.aoDirection[0] + (y - cy) * PUPIL.aoDirection[1]) / d, 0, 1)
        : 0;
      const ao = 1 - PUPIL.aoStrength * falloff * (PUPIL.aoAmbient + (1 - PUPIL.aoAmbient) * dir);
      let R = data[i] * ao;
      let G = data[i + 1] * ao;
      let B = data[i + 2] * ao;

      // 2. Pupil body: a lit sphere, plus a warm rim from the surrounding glow.
      const coverage = 1 - smoothstep(r - aa, r + aa, d);
      if (coverage > 0) {
        const u = (x - cx) / r;
        const v = (y - cy) / r;
        const w = Math.sqrt(Math.max(0, 1 - u * u - v * v));
        const lit = smoothstep(0, 1, clamp(u * LIGHT[0] + v * LIGHT[1] + w * LIGHT[2], 0, 1));

        const rimT = smoothstep(PUPIL.rimStart * r, r, d);
        let pr = PUPIL.bodyShadow[0] + (PUPIL.bodyLit[0] - PUPIL.bodyShadow[0]) * lit;
        let pg = PUPIL.bodyShadow[1] + (PUPIL.bodyLit[1] - PUPIL.bodyShadow[1]) * lit;
        let pb = PUPIL.bodyShadow[2] + (PUPIL.bodyLit[2] - PUPIL.bodyShadow[2]) * lit;
        pr += (PUPIL.rim[0] - pr) * rimT;
        pg += (PUPIL.rim[1] - pg) * rimT;
        pb += (PUPIL.rim[2] - pb) * rimT;

        // 3. Specular: a crisp bright dot with a faint bloom around it.
        const sd = Math.hypot(x - specX, y - specY);
        const core = 1 - smoothstep(
          (PUPIL.specularCore - PUPIL.specularSoft) * r,
          (PUPIL.specularCore + PUPIL.specularSoft) * r,
          sd
        );
        const bloom = 1 - smoothstep(0, PUPIL.specularBloom * r, sd);
        const spec = clamp(core + bloom * PUPIL.specularBloomWeight, 0, 1);
        pr += (PUPIL.specular[0] - pr) * spec;
        pg += (PUPIL.specular[1] - pg) * spec;
        pb += (PUPIL.specular[2] - pb) * spec;

        R += (pr - R) * coverage;
        G += (pg - G) * coverage;
        B += (pb - B) * coverage;
      }

      data[i] = clamp(Math.round(R), 0, 255);
      data[i + 1] = clamp(Math.round(G), 0, 255);
      data[i + 2] = clamp(Math.round(B), 0, 255);
    }
  }
}

/**
 * Shrink a gaze offset until the pupil sits fully inside the eye white, with a
 * sliver of white still showing around it.
 *
 * The eye is egg-shaped, so the ellipse implied by its bounding box overstates
 * how far the pupil can travel — most at the narrow top, but enough at the sides
 * that an unclamped rightward gaze visibly clips off the edge. `eye.spans` holds
 * the real per-row outline, so test against that instead.
 */
function fitInsideEye(eye, radius, dx, dy) {
  const fits = (ox, oy) => {
    const cx = eye.cx + ox;
    const cy = eye.cy + oy;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      const span = eye.spans[y];
      if (!span) return false;
      const half = Math.sqrt(Math.max(0, radius * radius - (y - cy) ** 2));
      if (cx - half < span[0] || cx + half > span[1]) return false;
    }
    return true;
  };

  if (fits(dx, dy)) return [dx, dy, 1];

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(dx * mid, dy * mid)) lo = mid;
    else hi = mid;
  }
  return [dx * lo, dy * lo, lo];
}

/**
 * Render one frame: base plate + both pupils at a normalised gaze offset.
 *
 * Gaze is measured from the artwork's rest pose, not from the middle of the eye,
 * so that a direction reads the way it is named. Anchoring it at the eye centre
 * instead would put `look-up` up and to the *left* of a rest pose that already
 * sits up and to the right, and would leave `look-right` barely distinguishable
 * from idle.
 *
 * Rest already sits at ~54% of the available travel toward the right edge, so
 * there is less room to look further right than left; those extremes get
 * shortened by the fit rather than the rest pose being pulled off-brand.
 */
function renderFrame(plate, eyes, gazeX, gazeY, travel, onFit = null) {
  const frame = {
    width: plate.width,
    height: plate.height,
    data: Uint8Array.from(plate.data),
  };

  for (const [n, eye] of eyes.entries()) {
    const r = eye.halfWidth * PUPIL.radiusRatio;
    const dx = REST[n][0] * eye.halfWidth + gazeX * (eye.halfWidth - r) * travel;
    const dy = REST[n][1] * eye.halfHeight + gazeY * (eye.halfHeight - r) * travel;

    const [fx, fy, scale] = fitInsideEye(eye, r * PUPIL.clearance, dx, dy);
    if (onFit) onFit(n, fx, fy, scale);

    drawPupil(frame, eye.cx + fx, eye.cy + fy, r);
  }

  return frame;
}

/** Bounding box covering every supplied box. */
function unionBox(boxes) {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Distance from (x, y) to the box — 0 anywhere inside it. */
function distanceOutside(box, x, y) {
  const u = Math.max(0, box.x0 - x, x - box.x1);
  const v = Math.max(0, box.y0 - y, y - box.y1);
  return Math.hypot(u, v);
}

/**
 * Take the closed lids and their glow from the blink artwork and everything else
 * from the base plate, so a blink cannot shift the icon body or its backdrop.
 * Pixels past the graft's reach are copied verbatim rather than blended, so they
 * stay byte-identical rather than merely close.
 */
function graftLids(plate, blink, eyeBox) {
  const out = { width: plate.width, height: plate.height, data: Uint8Array.from(plate.data) };
  const { core, feather } = LID_GRAFT;

  for (let y = 0; y < plate.height; y++) {
    for (let x = 0; x < plate.width; x++) {
      const w = 1 - smoothstep(core, core + feather, distanceOutside(eyeBox, x, y));
      if (w <= 0) continue;

      const i = (y * plate.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        out.data[i + c] = clamp(
          Math.round(plate.data[i + c] + (blink.data[i + c] - plate.data[i + c]) * w),
          0,
          255
        );
      }
    }
  }

  return out;
}

/**
 * Every frame must be byte-identical to `idle-center` outside the region the
 * animation is allowed to touch — that is what stops the swap sequence from
 * jittering. Compare each frame against it and report where the differences
 * actually landed.
 */
function checkRegistration(frames, allowed) {
  const reference = frames.get('idle-center');

  let clean = true;
  for (const [name, frame] of frames) {
    if (name === 'idle-center') continue;

    const boxes = allowed.get(name);
    const inside = (x, y) =>
      boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);

    const { width, height, data } = frame;
    let count = 0;
    let stray = 0;
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (
          data[i] === reference.data[i] &&
          data[i + 1] === reference.data[i + 1] &&
          data[i + 2] === reference.data[i + 2] &&
          data[i + 3] === reference.data[i + 3]
        ) {
          continue;
        }
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (!inside(x, y)) stray++;
      }
    }

    const share = ((count / (width * height)) * 100).toFixed(2);
    const box = count ? `x=[${x0}..${x1}] y=[${y0}..${y1}]` : 'none';
    if (stray) clean = false;
    console.log(
      `  ${name.padEnd(13)} ${share.padStart(5)}% differ  ${box.padEnd(28)}` +
        (stray ? `FAIL — ${stray} px outside the eyes` : 'ok')
    );
  }

  return clean;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const plate = args.base
    ? decodePNG(readFileSync(resolve(args.base)))
    : deriveBasePlate();
  console.log(
    args.base
      ? `base plate: ${args.base} (${plate.width}x${plate.height})`
      : `base plate: derived from src/assets/FlowPane_logo.png (${plate.width}x${plate.height})`
  );

  // The artwork fills ~95% of its canvas; Apple's grid puts the body near 80%,
  // so the icon is rescaled into the canvas rather than cropped or padded. The
  // same transform runs on every frame — including the separately drawn blink —
  // so nothing shifts between them.
  const plateBounds = bodyBounds(plate);
  const plateOpaque = !hasAlpha(plate);
  console.log(
    `  body: x=[${plateBounds.x0}..${plateBounds.x1}] y=[${plateBounds.y0}..${plateBounds.y1}] ` +
      `= ${(((plateBounds.x1 - plateBounds.x0 + 1) / plate.width) * 100).toFixed(1)}% of canvas ` +
      `-> ${(args.grid * 100).toFixed(1)}% (Apple grid)`
  );

  const eyes = findEyes(plate);
  for (const [n, eye] of eyes.entries()) {
    console.log(
      `  eye${n}: centre=(${eye.cx.toFixed(1)}, ${eye.cy.toFixed(1)}) ` +
        `size=${(eye.halfWidth * 2).toFixed(0)}x${(eye.halfHeight * 2).toFixed(0)} ` +
        `pupil r=${(eye.halfWidth * PUPIL.radiusRatio).toFixed(1)} ` +
        `rest=(${(REST[n][0] * eye.halfWidth).toFixed(1)}, ${(REST[n][1] * eye.halfHeight).toFixed(1)})`
    );
  }

  // Gaze directions as unit offsets; the roll traces an ellipse so it stays
  // inside the egg-shaped eye rather than clipping at the narrow top.
  const specs = [
    ['idle-center', 0, 0],
    ['look-left', -1, 0],
    ['look-right', 1, 0],
    ['look-up', 0, -1],
    ['look-down', 0, 1],
  ];
  for (let n = 1; n <= 8; n++) {
    const theta = -Math.PI / 2 + ((n - 1) / 8) * Math.PI * 2; // top, clockwise
    specs.push([`roll-${n}`, Math.cos(theta), Math.sin(theta)]);
  }

  mkdirSync(args.out, { recursive: true });

  // Pupils are composited at the artwork's native resolution, then the grid
  // rescale and the downsize to --size happen in a single resampling pass.
  const written = new Map();
  const allowed = new Map();
  let eyeBoxes = null;
  let toOutput = null;

  for (const [name, gx, gy] of specs) {
    const fits = [];
    const native = renderFrame(plate, eyes, gx, gy, args.travel, (n, fx, fy, scale) =>
      fits.push({ n, fx, fy, scale })
    );
    const shortened = fits.filter((f) => f.scale < 1);
    if (shortened.length) {
      console.log(
        `  ${name}: fitted inside the eye — ` +
          shortened
            .map((f) => `eye${f.n} to ${(f.scale * 100).toFixed(0)}% (${f.fx.toFixed(0)}, ${f.fy.toFixed(0)})`)
            .join(', ')
      );
    }
    const placed = placeOnGrid(native, {
      bounds: plateBounds,
      size: args.size,
      fraction: args.grid,
    });

    // Dock icons composite over the Dock's own backdrop, so everything outside
    // the squircle has to be truly transparent. Image generators cannot emit an
    // alpha channel, so cut it here unless the artwork already has one.
    if (plateOpaque) {
      applySquircleAlpha(placed.image, { exponent: args.squircle, bounds: placed.bounds });
    }

    if (!eyeBoxes) {
      // The box filter reaches about half a destination pixel into its
      // neighbours, so allow a pixel of bleed around each mapped region.
      toOutput = (box, pad = 0) => {
        const [x0, y0] = placed.project(box.x0 - pad, box.y0 - pad);
        const [x1, y1] = placed.project(box.x1 + pad, box.y1 + pad);
        return {
          x0: Math.floor(x0) - 1,
          x1: Math.ceil(x1) + 1,
          y0: Math.floor(y0) - 1,
          y1: Math.ceil(y1) + 1,
        };
      };
      // A gaze frame may touch the eye white plus however far the pupil's
      // contact shadow reaches past it — the pupil itself is fitted inside the
      // white, but its shadow falls on the surrounding glow. Anything beyond
      // that is drift, not shading.
      eyeBoxes = eyes.map((eye) =>
        toOutput(eye.bounds, eye.halfWidth * PUPIL.radiusRatio * (PUPIL.aoOuter - 1))
      );
      console.log(
        `  placed: body x=[${placed.bounds.x0}..${placed.bounds.x1}] ` +
          `y=[${placed.bounds.y0}..${placed.bounds.y1}] on a ${args.size}px canvas ` +
          `(scale ${placed.scale.toFixed(4)})` +
          (plateOpaque ? `, squircle n=${args.squircle}` : ', existing alpha kept')
      );
    }

    writeFileSync(join(args.out, `${name}.png`), encodePNG(placed.image));
    written.set(name, placed.image);
    allowed.set(name, eyeBoxes);
  }

  if (args.blink) {
    const blink = decodePNG(readFileSync(resolve(args.blink)));
    const blinkBounds = bodyBounds(blink);
    const drift = Math.max(
      Math.abs(blinkBounds.x0 - plateBounds.x0),
      Math.abs(blinkBounds.x1 - plateBounds.x1),
      Math.abs(blinkBounds.y0 - plateBounds.y0),
      Math.abs(blinkBounds.y1 - plateBounds.y1)
    );
    if (drift > 1) {
      // The lids are grafted onto the plate, which only works if the two pieces
      // of artwork agree on where the icon body sits.
      throw new Error(
        `blink body x=[${blinkBounds.x0}..${blinkBounds.x1}] y=[${blinkBounds.y0}..${blinkBounds.y1}] ` +
          `is ${drift}px off the base plate's — re-export the pair from the same composition`
      );
    }

    const eyeBox = unionBox(eyes.map((eye) => eye.bounds));
    const placed = placeOnGrid(graftLids(plate, blink, eyeBox), {
      bounds: plateBounds,
      size: args.size,
      fraction: args.grid,
    });
    if (plateOpaque) {
      applySquircleAlpha(placed.image, { exponent: args.squircle, bounds: placed.bounds });
    }

    console.log(
      `  blink: lids grafted onto the plate within ${LID_GRAFT.core}px of the eyes, ` +
        `fading out by ${LID_GRAFT.core + LID_GRAFT.feather}px`
    );
    writeFileSync(join(args.out, 'blink-closed.png'), encodePNG(placed.image));
    written.set('blink-closed', placed.image);
    allowed.set('blink-closed', [toOutput(eyeBox, LID_GRAFT.core + LID_GRAFT.feather)]);
  } else {
    console.log('  skipped blink-closed.png (no --blink supplied)');
  }

  console.log(`\n${written.size} frames -> ${args.out}\n\nregistration vs idle-center:`);
  if (!checkRegistration(written, allowed)) {
    throw new Error('frames differ outside the eye regions — they would jitter when swapped');
  }
  console.log('  all frames byte-identical outside the pupil/eyelid regions');
}

try {
  main();
} catch (error) {
  console.error(`build-dock-frames: ${error.message}`);
  process.exit(1);
}
