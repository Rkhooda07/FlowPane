# Dock icon frame set

`build-dock-frames.mjs` generates the animated Dock icon frames. It is a build
step: run it when the source artwork changes, commit the output, and let the
Rust side load the pre-rendered PNGs. Nothing here runs at runtime.

```
node scripts/build-dock-frames.mjs --base path/to/base-plate.png --blink path/to/blink-closed.png
```

Output lands in `src-tauri/assets/dock/`.

## Why compositing instead of generated frames

Generating each frame separately re-renders the background, oval geometry and
glow every time, so a swap sequence jitters. Compositing one moving pupil onto a
single base plate keeps every non-pupil pixel byte-identical — verified: frames
differ in ~5% of pixels, all inside the pupil regions.

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

Note the icon body currently fills **95.4%** of the canvas. Apple's macOS grid
puts it near 80%, so the icon renders noticeably larger than its Dock neighbours.
Fixing that means rescaling the body inside the canvas — not currently done.

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
pupils sit at roughly 0.54 of that maximum; the default 0.3 reads noticeably
calmer than the shipped logo.

The roll traces an ellipse sized to each axis independently, so it follows the
egg shape instead of clipping at the narrow top. Frame 1 is at the top, running
clockwise.

## Frames

`idle-center`, `look-left`, `look-right`, `look-up`, `look-down`, `roll-1`…`roll-8`,
plus `blink-closed` when `--blink` is supplied. The blink frame is a separate
piece of artwork — it is passed through and resized, not composited.
