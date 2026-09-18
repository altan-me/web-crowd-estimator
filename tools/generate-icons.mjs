// Generates the PWA icon PNGs so the icon set stays reproducible without a
// design tool or an image dependency. Run with: node tools/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");

const BACKGROUND = [0x0f, 0x14, 0x20];
const GRID = 5; // dots per side

// Density colours, matching the swatches in styles.css.
const DENSITY_COLORS = [
  [0x42, 0xa5, 0xf5], // light
  [0x66, 0xbb, 0x6a], // moderate
  [0xff, 0xa7, 0x26], // dense
  [0xef, 0x53, 0x50], // very dense
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A grid of dots that grows and shifts from blue to red along the diagonal,
// echoing the density swatches. The background is full bleed so Android never
// shows a white backdrop behind the masked icon.
function drawIcon(size, paddingFraction) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    px[i * 4] = BACKGROUND[0];
    px[i * 4 + 1] = BACKGROUND[1];
    px[i * 4 + 2] = BACKGROUND[2];
    px[i * 4 + 3] = 255;
  }

  const padding = size * paddingFraction;
  const cell = (size - 2 * padding) / GRID;
  const last = GRID - 1;

  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      const t = (row + col) / (2 * last);
      const radius = cell * (0.17 + 0.19 * t);
      const color =
        DENSITY_COLORS[
          Math.min(DENSITY_COLORS.length - 1, Math.floor(t * DENSITY_COLORS.length))
        ];
      const cx = padding + cell * (col + 0.5);
      const cy = padding + cell * (row + 0.5);

      const minX = Math.max(0, Math.floor(cx - radius - 1));
      const maxX = Math.min(size - 1, Math.ceil(cx + radius + 1));
      const minY = Math.max(0, Math.floor(cy - radius - 1));
      const maxY = Math.min(size - 1, Math.ceil(cy + radius + 1));

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const alpha = Math.min(1, Math.max(0, radius + 0.5 - dist));
          if (alpha <= 0) continue;
          const o = (y * size + x) * 4;
          for (let c = 0; c < 3; c += 1) {
            px[o + c] = Math.round(px[o + c] + (color[c] - px[o + c]) * alpha);
          }
        }
      }
    }
  }

  return px;
}

// "any" icons keep the grid fairly wide; the maskable one needs all of its art
// inside the safe zone, i.e. the centre circle at 80% of the icon's width.
const OUTPUTS = [
  { file: "icon-180.png", size: 180, padding: 0.16 },
  { file: "icon-192.png", size: 192, padding: 0.16 },
  { file: "icon-512.png", size: 512, padding: 0.16 },
  { file: "icon-maskable-512.png", size: 512, padding: 0.22 },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const { file, size, padding } of OUTPUTS) {
  const png = encodePng(size, size, drawIcon(size, padding));
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`${file}  ${size}x${size}  ${png.length} bytes`);
}
