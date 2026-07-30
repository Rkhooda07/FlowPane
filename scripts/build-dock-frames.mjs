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
//
// Run this when the source artwork changes and commit the output. The Rust side
// loads the pre-rendered PNGs; nothing here runs at runtime.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { decodePNG, encodePNG } from './lib/png.mjs';
import {
  findEyes,
  findIconShape,
  inpaintDisc,
  applySquircleAlpha,
  hasAlpha,
  resize,
  clamp,
  smoothstep,
} from './lib/raster.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Pupil appearance, sampled from src/assets/FlowPane_logo.png ──────────────
// See the table in scripts/README-dock-frames.md for how these were measured.
const PUPIL = {
  radiusRatio: 0.353,           // of the eye white's half-width
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
    squircle: 5.4,
  };
  const numeric = new Set(['size', 'travel', 'squircle']);
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

  // Measured pupil offsets in the reference, as a fraction of each eye's half-size.
  const restOffsets = [[0.351, -0.269], [0.233, -0.268]];

  for (const [n, eye] of eyes.entries()) {
    const r = eye.halfWidth * PUPIL.radiusRatio;
    const px = eye.cx + eye.halfWidth * restOffsets[n][0];
    const py = eye.cy + eye.halfHeight * restOffsets[n][1];

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

/** Render one frame: base plate + both pupils at a normalised gaze offset. */
function renderFrame(plate, eyes, gazeX, gazeY, travel) {
  const frame = {
    width: plate.width,
    height: plate.height,
    data: Uint8Array.from(plate.data),
  };

  for (const eye of eyes) {
    const r = eye.halfWidth * PUPIL.radiusRatio;
    const rangeX = (eye.halfWidth - r) * travel;
    const rangeY = (eye.halfHeight - r) * travel;
    drawPupil(frame, eye.cx + gazeX * rangeX, eye.cy + gazeY * rangeY, r);
  }

  return frame;
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

  // Dock icons composite over the Dock's own backdrop, so the area outside the
  // squircle has to be truly transparent. Image generators cannot produce an
  // alpha channel, so cut it here unless the plate already has one.
  if (hasAlpha(plate)) {
    console.log('  alpha: base plate already has transparency, left as-is');
  } else {
    const shape = findIconShape(plate);
    applySquircleAlpha(plate, { exponent: args.squircle, bounds: shape });
    console.log(
      `  alpha: cut squircle (n=${args.squircle}) at ` +
        `x=[${shape.x0}..${shape.x1}] y=[${shape.y0}..${shape.y1}]`
    );
  }

  const eyes = findEyes(plate);
  for (const [n, eye] of eyes.entries()) {
    console.log(
      `  eye${n}: centre=(${eye.cx.toFixed(1)}, ${eye.cy.toFixed(1)}) ` +
        `size=${(eye.halfWidth * 2).toFixed(0)}x${(eye.halfHeight * 2).toFixed(0)} ` +
        `pupil r=${(eye.halfWidth * PUPIL.radiusRatio).toFixed(1)}`
    );
  }

  // Gaze directions as unit offsets; the roll traces an ellipse so it stays
  // inside the egg-shaped eye rather than clipping at the narrow top.
  const frames = [
    ['idle-center', 0, 0],
    ['look-left', -1, 0],
    ['look-right', 1, 0],
    ['look-up', 0, -1],
    ['look-down', 0, 1],
  ];
  for (let n = 1; n <= 8; n++) {
    const theta = -Math.PI / 2 + ((n - 1) / 8) * Math.PI * 2; // top, clockwise
    frames.push([`roll-${n}`, Math.cos(theta), Math.sin(theta)]);
  }

  mkdirSync(args.out, { recursive: true });

  for (const [name, gx, gy] of frames) {
    const frame = renderFrame(plate, eyes, gx, gy, args.travel);
    writeFileSync(join(args.out, `${name}.png`), encodePNG(resize(frame, args.size)));
    console.log(`  wrote ${name}.png`);
  }

  if (args.blink) {
    const blink = decodePNG(readFileSync(resolve(args.blink)));
    writeFileSync(join(args.out, 'blink-closed.png'), encodePNG(resize(blink, args.size)));
    console.log('  wrote blink-closed.png');
  } else {
    console.log('  skipped blink-closed.png (no --blink supplied)');
  }

  console.log(`\n${frames.length + (args.blink ? 1 : 0)} frames -> ${args.out}`);
}

try {
  main();
} catch (error) {
  console.error(`build-dock-frames: ${error.message}`);
  process.exit(1);
}
