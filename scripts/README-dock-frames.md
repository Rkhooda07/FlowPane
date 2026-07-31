# Dock icon frame set

`build-dock-frames.mjs` generates the animated Dock icon frames. It is a build
step: run it when the source artwork changes, commit the output, and let the
Rust side load the pre-rendered PNGs. Nothing here runs at runtime.

The command that produced the committed frames:

```
node scripts/build-dock-frames.mjs \
  --base src/assets/base-plate.png \
  --blink src/assets/blink-closed.png \
  --travel 0.5
```

Output lands in `src-tauri/assets/dock/`.

The static bundled icon is a separate step — see [Icon grid](#icon-grid):

```
node scripts/build-app-icon.mjs
npm run tauri icon src-tauri/icons/1024x1024.png
```

## Why compositing instead of generated frames

Generating each frame separately re-renders the background, oval geometry and
glow every time, so a swap sequence jitters. Compositing one moving pupil onto a
single base plate keeps every non-pupil pixel byte-identical.

The build checks this rather than assuming it: every frame is compared against
`idle-center`, and the run fails if any differing pixel falls outside the region
that frame is allowed to touch. Current output — gaze frames differ in ~4% of
pixels, the blink in ~30%, none of them outside the eyes.

## Base plate

A 1:1 render of the icon with eye whites, glow and background but **no pupils**.
One requirement: **both eyes brighter than the background**, so `findEyes()` can
locate them by luma. It splits the canvas at the midpoint and takes the bright
region in each half.

Transparency is handled here, not in the artwork — see below.

With no `--base`, the script derives a stand-in by inpainting the pupils out of
`src/assets/FlowPane_logo.png`. That is a stopgap for reviewing motion — the fill
flattens the eye-white gradient where the old pupils were. Supply a real plate
for shipping.

## Transparency

The Dock composites an icon over its own backdrop, so anything outside the
squircle must be truly transparent or it renders as a hard opaque square.

Do not try to get this from the image generator. Gemini, Imagen, DALL·E and
Midjourney all emit opaque RGB; prompting for "transparent background" produces a
*painted* checkerboard or a flat matte, never an alpha channel. The script cuts
the mask instead:

- `findIconShape()` locates the icon body by thresholding just above the
  canvas-edge background level.
- `applySquircleAlpha()` clears everything outside a superellipse, feathered over
  1.5px. `--squircle` sets the exponent; the default 5.4 is the measured fit to
  the FlowPane artwork, and is close to the Apple continuous-corner shape (~5).

If the supplied base plate already has an alpha channel, the mask is skipped and
the existing transparency is preserved.

## Icon grid

The artwork fills **95.4%** of its canvas, which renders noticeably larger than
its Dock neighbours. Apple's macOS grid puts the body at 824/1024 — **80.5%** —
so `placeOnGrid()` rescales it to that and centres it. `--grid` overrides the
fraction.

The rescale and the downsize to `--size` are a single resampling pass, so no
frame is filtered twice. Scale is uniform, taken from the body's longer edge, so
a body that measures a pixel off square is not stretched.

The same grid is applied to the static bundled icon by
`scripts/build-app-icon.mjs`, which shares the `APPLE_GRID` and
`FLOWPANE_SQUIRCLE` constants from `lib/raster.mjs`. That matters: the static
icon is what the Dock falls back to if the animated frames fail to load, and if
the two used different grids the icon would visibly change size on fallback.

## Pupil constants

Measured from `src/assets/FlowPane_logo.png` (1254×1254). All positions are in
units of the pupil radius `r`; `r` itself is a fraction of the eye's half-width.

| Property | Measured | Constant |
| --- | --- | --- |
| Eye white | 374 × 423 px, half-width 187 | — |
| Pupil radius | ~66 px | `radiusRatio` 0.353 |
| Body, lit side | `rgb(58,50,41)` | `bodyLit` |
| Body, shadow side | `rgb(30,25,21)` | `bodyShadow` |
| Edge rim | `rgb(74,63,51)` at 0.95r | `rim`, `rimStart` |
| Specular colour | `rgb(233,189,134)` | `specular` |
| Specular position | (−0.57r, −0.63r) | `specularAt` |
| Rest gaze (left eye) | +0.351 / −0.269 of half-size | — |
| Rest gaze (right eye) | +0.233 / −0.268 of half-size | — |

The key light direction is derived from `specularAt` rather than stored
separately: the surface normal at the highlight points straight at the light.

## Gaze travel

`--travel` is the gaze offset as a fraction of the maximum in-eye travel
(`halfWidth − r`), so the pupil can never leave the eye. The reference logo's own
pupils sit at roughly 0.54 of that maximum, and the shipped frames are built with
`--travel 0.5` to match it. The 0.3 default reads noticeably calmer.

The roll traces an ellipse sized to each axis independently, so it follows the
egg shape instead of clipping at the narrow top. Frame 1 is at the top, running
clockwise.

## Frames

`idle-center`, `look-left`, `look-right`, `look-up`, `look-down`, `roll-1`…`roll-8`,
plus `blink-closed` when `--blink` is supplied.

## The blink frame

`blink-closed` is separate artwork rather than something the script can composite
— there is no way to derive closed lids from open eyes. It is therefore an
independent render, and its backdrop differs from the base plate's by about
2/255 **across the whole canvas**, even where nothing changed. Resizing it and
shipping it as-is would make every blink nudge the entire icon.

So only the lids and the glow they cast are grafted onto the base plate;
everything else comes from the plate itself. Measured falloff of the plate/blink
difference, in source pixels beyond the eye bounding box:

| Distance | 0–25 | 25–50 | 50–75 | 75–100 | 100–150 | 150+ |
| --- | --- | --- | --- | --- | --- | --- |
| Mean Δ | 12.7 | 6.7 | 4.5 | 3.4 | 2.5 | ~1 |

`LID_GRAFT` takes the blink verbatim out to 60px and fades it out by 160px, well
inside the noise floor. Past that the plate's pixels are copied rather than
blended, so they stay byte-identical rather than merely close.

This only works if both pieces of artwork agree on where the icon body sits; the
build fails if they are more than a pixel apart.
