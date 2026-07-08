import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const sizes = [16, 32, 80];
const colors = {
  teal: [15, 118, 110, 255],
  tealDark: [17, 94, 89, 255],
  white: [255, 255, 255, 255],
  paper: [248, 250, 252, 255],
  shadow: [15, 23, 42, 70],
  stroke: [15, 23, 42, 190],
  red: [220, 38, 38, 255],
  blue: [37, 99, 235, 255],
  arrow: [250, 204, 21, 255]
};

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  drawIcon(canvas, size);
  await writeFile(`public/assets/icon-${size}.png`, encodePng(canvas));
}

function createCanvas(width, height) {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height * 4)
  };
}

function drawIcon(canvas, size) {
  const s = size / 80;
  const radius = Math.max(3, Math.round(14 * s));

  fillRoundedRect(canvas, 3 * s, 3 * s, 74 * s, 74 * s, radius, colors.teal);
  fillRoundedRect(canvas, 7 * s, 7 * s, 66 * s, 66 * s, Math.max(2, radius - 4 * s), colors.tealDark);

  drawDocument(canvas, 18 * s, 12 * s, 31 * s, 45 * s, colors.blue, "D", s, true);
  drawDocument(canvas, 32 * s, 22 * s, 31 * s, 45 * s, colors.red, "P", s, false);

  drawArrow(canvas, s);
}

function drawDocument(canvas, x, y, width, height, labelColor, label, s, back) {
  fillRoundedRect(canvas, x + 3 * s, y + 4 * s, width, height, 3 * s, colors.shadow);
  fillRoundedRect(canvas, x, y, width, height, 3 * s, colors.paper);
  strokeRect(canvas, x, y, width, height, Math.max(1, Math.round(2 * s)), colors.stroke);

  fillPolygon(canvas, [
    [x + width - 10 * s, y],
    [x + width, y + 10 * s],
    [x + width - 10 * s, y + 10 * s]
  ], [226, 232, 240, 255]);

  fillRect(canvas, x + 4 * s, y + height - 17 * s, width - 8 * s, 13 * s, labelColor);

  if (s >= 0.7) {
    drawText(canvas, label, x + 12 * s, y + height - 16 * s, Math.max(1, Math.floor(2 * s)), colors.white);
  }
}

function drawArrow(canvas, s) {
  const thickness = Math.max(2, Math.round(5 * s));
  drawLine(canvas, 17 * s, 62 * s, 44 * s, 62 * s, thickness, colors.arrow);
  fillPolygon(canvas, [
    [44 * s, 52 * s],
    [63 * s, 62 * s],
    [44 * s, 72 * s]
  ], colors.arrow);
  drawLine(canvas, 17 * s, 62 * s, 17 * s, 51 * s, thickness, colors.arrow);
}

function fillRoundedRect(canvas, x, y, width, height, radius, color) {
  const minX = Math.floor(x);
  const maxX = Math.ceil(x + width);
  const minY = Math.floor(y);
  const maxY = Math.ceil(y + height);

  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      const cx = clamp(px, x + radius, x + width - radius);
      const cy = clamp(py, y + radius, y + height - radius);
      if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) {
        setPixel(canvas, px, py, color);
      }
    }
  }
}

function fillRect(canvas, x, y, width, height, color) {
  for (let py = Math.floor(y); py < Math.ceil(y + height); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + width); px++) {
      setPixel(canvas, px, py, color);
    }
  }
}

function strokeRect(canvas, x, y, width, height, thickness, color) {
  fillRect(canvas, x, y, width, thickness, color);
  fillRect(canvas, x, y + height - thickness, width, thickness, color);
  fillRect(canvas, x, y, thickness, height, color);
  fillRect(canvas, x + width - thickness, y, thickness, height, color);
}

function fillPolygon(canvas, points, color) {
  const ys = points.map(([, y]) => y);
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));

  for (let y = minY; y <= maxY; y++) {
    const nodes = [];
    let j = points.length - 1;

    for (let i = 0; i < points.length; i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];

      if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
        nodes.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }

      j = i;
    }

    nodes.sort((a, b) => a - b);
    for (let i = 0; i < nodes.length; i += 2) {
      for (let x = Math.floor(nodes[i]); x < Math.ceil(nodes[i + 1]); x++) {
        setPixel(canvas, x, y, color);
      }
    }
  }
}

function drawLine(canvas, x1, y1, x2, y2, thickness, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  for (let i = 0; i <= steps; i++) {
    const x = x1 + (dx * i) / steps;
    const y = y1 + (dy * i) / steps;
    fillRoundedRect(canvas, x - thickness / 2, y - thickness / 2, thickness, thickness, thickness / 2, color);
  }
}

function drawText(canvas, text, x, y, scale, color) {
  const glyphs = {
    C: ["01110", "10000", "10000", "10000", "10000", "10000", "01110"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"]
  };
  let cursor = x;

  for (const char of text) {
    const glyph = glyphs[char];
    if (!glyph) {
      cursor += 3 * scale;
      continue;
    }

    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, colIndex) => {
        if (pixel === "1") {
          fillRect(canvas, cursor + colIndex * scale, y + rowIndex * scale, scale, scale, color);
        }
      });
    });
    cursor += 6 * scale;
  }
}

function setPixel(canvas, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);

  if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) {
    return;
  }

  const index = (py * canvas.width + px) * 4;
  canvas.pixels[index] = color[0];
  canvas.pixels[index + 1] = color[1];
  canvas.pixels[index + 2] = color[2];
  canvas.pixels[index + 3] = color[3];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function encodePng(canvas) {
  const raw = Buffer.alloc((canvas.width * 4 + 1) * canvas.height);

  for (let y = 0; y < canvas.height; y++) {
    const rowStart = y * (canvas.width * 4 + 1);
    raw[rowStart] = 0;
    raw.set(canvas.pixels.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.concat([
      uint32(canvas.width),
      uint32(canvas.height),
      Buffer.from([8, 6, 0, 0, 0])
    ])),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data])))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
