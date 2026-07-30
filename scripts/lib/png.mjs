// Minimal zero-dependency PNG reader/writer for the dock-frame build step.
// Supports 8-bit RGB/RGBA, non-interlaced — which is what `sips` emits and what
// every image generator produces. Anything else errors out with a fix hint.

import { inflateSync, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode a PNG buffer into { width, height, data } where data is RGBA Uint8Array. */
export function decodePNG(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Not a PNG file (bad signature)');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(
      `Unsupported PNG (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}). ` +
        'Normalize it first:  sips -s format png in.png --out in.png'
    );
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;

    for (let x = 0; x < stride; x++) {
      const value = raw[src + x];
      const a = x >= channels ? pixels[dst + x - channels] : 0;
      const b = y > 0 ? pixels[prev + x] : 0;
      const c = x >= channels && y > 0 ? pixels[prev + x - channels] : 0;

      let out;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + a; break;
        case 2: out = value + b; break;
        case 3: out = value + ((a + b) >> 1); break;
        case 4: out = value + paethPredictor(a, b, c); break;
        default: throw new Error(`Unknown PNG filter type ${filter} on row ${y}`);
      }
      pixels[dst + x] = out & 0xff;
    }
  }

  // Normalize to RGBA so callers only ever deal with one layout.
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    data[i * 4] = pixels[i * channels];
    data[i * 4 + 1] = pixels[i * channels + 1];
    data[i * 4 + 2] = pixels[i * channels + 2];
    data[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }

  return { width, height, data };
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Encode RGBA pixels into a PNG buffer, Paeth-filtered for a smaller file. */
export function encodePNG({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 4; // Paeth
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? data[i - 4] : 0;
      const b = y > 0 ? data[i - stride] : 0;
      const c = x >= 4 && y > 0 ? data[i - stride - 4] : 0;
      raw[dst + 1 + x] = (data[i] - paethPredictor(a, b, c)) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
