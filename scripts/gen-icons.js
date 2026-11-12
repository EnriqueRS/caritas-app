// Genera los iconos PNG de Caritas: un semáforo con caritas, sin dependencias.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filtro "none" por línea
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profundidad 8 bits
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Logo: semáforo con carita feliz, neutra y enfadada, en una cuadrícula de 512
// con supermuestreo 2x2 para bordes suaves.
const COLORS = {
  bg: [11, 17, 32],      // #0b1120
  case: [51, 65, 85],    // #334155
  green: [34, 197, 94],  // #22c55e
  yellow: [234, 179, 8], // #eab308
  red: [239, 68, 68],    // #ef4444
  dark: [11, 17, 32],    // rasgos de las caras
};

function logo(x, y, size) {
  const s = 512 / size;
  const hits = { bg: 0, case: 0, green: 0, yellow: 0, red: 0, dark: 0 };
  for (const dx of [0.25, 0.75]) {
    for (const dy of [0.25, 0.75]) {
      const px = (x + dx) * s;
      const py = (y + dy) * s;
      let which = 'bg';

      const inRounded = (x0, y0, x1, y1, r) => {
        if (px < x0 || px > x1 || py < y0 || py > y1) return false;
        const cx = Math.min(Math.max(px, x0 + r), x1 - r);
        const cy = Math.min(Math.max(py, y0 + r), y1 - r);
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
      };
      if (inRounded(160, 56, 352, 456, 56)) which = 'case';

      const inCircle = (cx, cy, r) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
      const light = (cy, color) => { if (inCircle(256, cy, 56)) which = color; };
      light(140, 'green');
      light(256, 'yellow');
      light(372, 'red');

      const faceDark = (cy, mouth) => {
        if (inCircle(234, cy - 16, 9) || inCircle(278, cy - 16, 9)) which = 'dark';
        if (mouth === 'smile') {
          const d = Math.hypot(px - 256, py - 138);
          if (py >= 138 && d >= 17 && d <= 27) which = 'dark';
        } else if (mouth === 'flat') {
          if (px >= 234 && px <= 278 && py >= cy + 3 && py <= cy + 13) which = 'dark';
        } else {
          const d = Math.hypot(px - 256, py - 402);
          if (py <= 402 && d >= 17 && d <= 27) which = 'dark';
        }
      };
      faceDark(140, 'smile');
      faceDark(256, 'flat');
      faceDark(372, 'frown');

      hits[which]++;
    }
  }
  const blend = (i) => Math.round(
    Object.entries(hits).reduce((acc, [k, n]) => acc + n * COLORS[k][i], 0) / 4
  );
  return [blend(0), blend(1), blend(2), 255];
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'webos', 'app'), { recursive: true });
fs.writeFileSync(path.join(root, 'web', 'icon-512.png'), png(512, logo));
fs.writeFileSync(path.join(root, 'web', 'icon-192.png'), png(192, logo));
fs.writeFileSync(path.join(root, 'webos', 'app', 'largeIcon.png'), png(130, logo));
fs.writeFileSync(path.join(root, 'webos', 'app', 'icon.png'), png(80, logo));
console.log('Iconos generados');
