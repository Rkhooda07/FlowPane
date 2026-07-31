#!/usr/bin/env node
// Build step — renders the bundled application icon.
//
//   node scripts/build-app-icon.mjs [options]
//   npm run tauri icon src-tauri/icons/1024x1024.png
//
//   --source <png>  Source artwork (default artwork/FlowPane_logo.png).
//   --out <dir>     Icon directory (default src-tauri/icons).
//
// This is the static icon macOS shows in Finder, Spotlight and the Cmd-Tab
// switcher, and the one the Dock falls back to if the animated frames fail to
// load. It goes through the same grid placement and squircle mask as
// build-dock-frames.mjs, so the app cannot change size or shape when it falls
// back to it.
//
// Two steps are needed because they cover different sizes. This script writes
// the plain square PNGs that tauri.conf.json names but the Tauri CLI does not
// emit; `tauri icon` then fans the 1024px master out into everything else —
// icon.icns, icon.ico, the Windows Square*Logo set, and the mobile icons.
// Each size is resampled straight from the source rather than from a smaller
// intermediate, so none of them go through two rounds of filtering.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { decodePNG, encodePNG } from './lib/png.mjs';
import {
  bodyBounds,
  applySquircleAlpha,
  hasAlpha,
  placeOnGrid,
  APPLE_GRID,
  FLOWPANE_SQUIRCLE,
} from './lib/raster.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Sizes tauri.conf.json references by name that `tauri icon` does not generate.
// 1024 doubles as the master the CLI reads for everything else.
const SIZES = [1024, 512, 256];

function parseArgs(argv) {
  const args = {
    source: join(ROOT, 'artwork/FlowPane_logo.png'),
    out: join(ROOT, 'src-tauri/icons'),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (!(key in args)) throw new Error(`Unknown option --${key}`);
    if (value === undefined) throw new Error(`Option --${key} needs a value`);
    args[key] = value;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const source = decodePNG(readFileSync(resolve(args.source)));
  const bounds = bodyBounds(source);
  console.log(`source: ${args.source} (${source.width}x${source.height})`);
  console.log(
    `  body: x=[${bounds.x0}..${bounds.x1}] y=[${bounds.y0}..${bounds.y1}] ` +
      `= ${(((bounds.x1 - bounds.x0 + 1) / source.width) * 100).toFixed(1)}% of canvas ` +
      `-> ${(APPLE_GRID * 100).toFixed(1)}% (Apple grid)`
  );

  // The artwork paints its backdrop black rather than leaving it transparent,
  // so without a mask the Dock, Finder and Spotlight would all show a black
  // square instead of the rounded icon.
  const opaque = !hasAlpha(source);
  console.log(
    opaque
      ? `  alpha: cutting squircle (n=${FLOWPANE_SQUIRCLE})`
      : '  alpha: source already has transparency, left as-is'
  );

  for (const size of SIZES) {
    const placed = placeOnGrid(source, { bounds, size, fraction: APPLE_GRID });
    if (opaque) {
      applySquircleAlpha(placed.image, { exponent: FLOWPANE_SQUIRCLE, bounds: placed.bounds });
    }
    const file = join(resolve(args.out), `${size}x${size}.png`);
    writeFileSync(file, encodePNG(placed.image));
    console.log(
      `  wrote ${size}x${size}.png — body x=[${placed.bounds.x0}..${placed.bounds.x1}] ` +
        `y=[${placed.bounds.y0}..${placed.bounds.y1}]`
    );
  }

  const master = join(resolve(args.out), `${SIZES[0]}x${SIZES[0]}.png`);
  console.log(`\nnext: npm run tauri icon ${master}`);
}

try {
  main();
} catch (error) {
  console.error(`build-app-icon: ${error.message}`);
  process.exit(1);
}
