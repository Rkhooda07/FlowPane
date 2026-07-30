// Small raster helpers shared by the dock-frame build step.

/** Perceptual luma of pixel `i` in an RGBA Uint8Array. */
export const luma = (data, i) =>
  0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Locate the two eye whites by scanning for bright pixels in each half of the
 * canvas. Returns per-eye centroid and extents, derived from a per-row
 * "interior" span so the oval shape is respected instead of a loose bounding box.
 */
export function findEyes({ width, height, data }) {
  let maxL = 0;
  for (let i = 0; i < width * height; i++) maxL = Math.max(maxL, luma(data, i));
  const cut = maxL * 0.5;

  return [[0, width >> 1], [width >> 1, width]].map(([xLo, xHi], index) => {
    const spans = new Array(height).fill(null);
    let n = 0;
    let sx = 0;
    let sy = 0;
    let x0 = width;
    let x1 = 0;
    let y0 = height;
    let y1 = 0;

    for (let y = 0; y < height; y++) {
      let a = -1;
      let b = -1;
      for (let x = xLo; x < xHi; x++) {
        if (luma(data, y * width + x) >= cut) {
          if (a < 0) a = x;
          b = x;
        }
      }
      if (a < 0) continue;
      spans[y] = [a, b];
      for (let x = a; x <= b; x++) {
        n++;
        sx += x;
        sy += y;
      }
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, b);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }

    if (!n) throw new Error(`Could not find an eye in the ${index ? 'right' : 'left'} half of the base plate`);

    return {
      cx: sx / n,
      cy: sy / n,
      halfWidth: (x1 - x0) / 2,
      halfHeight: (y1 - y0) / 2,
      spans,
      bounds: { x0, x1, y0, y1 },
    };
  });
}

/**
 * Fill a circular hole by interpolating the ring of pixels around it. For each
 * interior pixel we march out along evenly spaced rays, sample where each ray
 * leaves the disc, and weight those boundary colours by inverse square distance.
 *
 * This converges in a single pass and preserves the direction of the underlying
 * gradient, which iterative Laplace relaxation only reaches after O(radius^2)
 * sweeps. Used to erase the reference logo's pupils so the remaining eye-white
 * gradient can serve as a base plate.
 */
export function inpaintDisc(image, cx, cy, radius, isInside = null, rays = 48) {
  const { width, height, data } = image;
  const sampleAt = radius + 2.5;

  const directions = Array.from({ length: rays }, (_, a) => {
    const th = (a / rays) * Math.PI * 2;
    return [Math.cos(th), Math.sin(th)];
  });

  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));

  const patch = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      // Never paint eye-white over the background outside the oval.
      if (isInside && !isInside(x, y)) continue;

      const px = x - cx;
      const py = y - cy;
      let wr = 0;
      let wg = 0;
      let wb = 0;
      let wsum = 0;

      for (const [dx, dy] of directions) {
        // Distance from (px,py) along (dx,dy) to the circle of radius sampleAt.
        const b = px * dx + py * dy;
        const t = -b + Math.sqrt(Math.max(0, b * b - (px * px + py * py) + sampleAt * sampleAt));
        const sx = Math.round(clamp(cx + px + dx * t, 0, width - 1));
        const sy = Math.round(clamp(cy + py + dy * t, 0, height - 1));

        // Rays that leave the eye would drag the rim light and the dark
        // background inward as a starburst — drop them.
        if (isInside && !isInside(sx, sy)) continue;

        const i = (sy * width + sx) * 4;
        const w = 1 / Math.max(1, t * t);
        wr += data[i] * w;
        wg += data[i + 1] * w;
        wb += data[i + 2] * w;
        wsum += w;
      }

      if (wsum > 0) patch.push([x, y, wr / wsum, wg / wsum, wb / wsum]);
    }
  }

  for (const [x, y, r, g, b] of patch) {
    const i = (y * width + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  return image;
}

/** True if the image carries any meaningful transparency. */
export function hasAlpha({ width, height, data }) {
  for (let i = 0; i < width * height; i++) if (data[i * 4 + 3] < 250) return true;
  return false;
}

/**
 * Locate the icon body — the rounded-square shape sitting on the flat backdrop —
 * by thresholding just above the canvas-edge background level.
 */
export function findIconShape({ width, height, data }) {
  const edge = [];
  for (let x = 0; x < width; x++) {
    edge.push(luma(data, x));
    edge.push(luma(data, (height - 1) * width + x));
  }
  edge.sort((a, b) => a - b);
  const cut = edge[edge.length >> 1] + 6;

  let x0 = width;
  let x1 = 0;
  let y0 = height;
  let y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (luma(data, y * width + x) <= cut) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }

  if (x1 < x0) throw new Error('Could not find an icon body — the canvas looks uniform');
  return { x0, x1, y0, y1 };
}

/**
 * Cut true alpha outside the icon's squircle so the Dock composites it against
 * its own backdrop instead of showing an opaque square.
 *
 * Image generators emit opaque RGB — asking them for transparency yields a
 * painted-in checkerboard, not an alpha channel — so the mask is applied here.
 * The default exponent matches the Apple continuous-corner shape, which the
 * FlowPane artwork fits to n≈5.4.
 */
export function applySquircleAlpha(image, { exponent = 5.4, feather = 1.5, bounds } = {}) {
  const { width, height, data } = image;
  const { x0, x1, y0, y1 } = bounds ?? findIconShape(image);

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const a = (x1 - x0 + 1) / 2;
  const b = (y1 - y0 + 1) / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = Math.abs((x + 0.5 - cx) / a);
      const v = Math.abs((y + 0.5 - cy) / b);
      const f = Math.pow(u, exponent) + Math.pow(v, exponent);

      // Scaling a point by f^(-1/n) lands it on the boundary, so the signed
      // distance to the edge is d * (1 - f^(-1/n)).
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const signed = f === 0 ? -d : d * (1 - Math.pow(f, -1 / exponent));

      const alpha = 1 - smoothstep(-feather, feather, signed);
      const i = (y * width + x) * 4 + 3;
      data[i] = Math.round(data[i] * alpha);
    }
  }

  return image;
}

/** Box-filter resize. Only used to go down in size, which is all this pipeline needs. */
export function resize(image, size) {
  if (image.width === size && image.height === size) return image;
  const out = new Uint8Array(size * size * 4);
  const sx = image.width / size;
  const sy = image.height / size;

  for (let y = 0; y < size; y++) {
    const ya = Math.floor(y * sy);
    const yb = Math.max(ya + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const xa = Math.floor(x * sx);
      const xb = Math.max(xa + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let j = ya; j < yb; j++) {
        for (let i = xa; i < xb; i++) {
          const p = (j * image.width + i) * 4;
          r += image.data[p];
          g += image.data[p + 1];
          b += image.data[p + 2];
          a += image.data[p + 3];
          n++;
        }
      }
      const p = (y * size + x) * 4;
      out[p] = r / n;
      out[p + 1] = g / n;
      out[p + 2] = b / n;
      out[p + 3] = a / n;
    }
  }

  return { width: size, height: size, data: out };
}
