import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '../build');

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    for (let j = 0; j < 8; j++) {
      let mask = -(byte & 1);
      byte = (byte >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      crc = (crc >>> 1) ^ (mask & 0xEDB88320);
    }
  }
  return ~crc >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcPayload = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcPayload);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, crcPayload, crcBuf]);
}

function generatePng(size) {
  const width = size;
  const height = size;

  // Raw pixel data: 1 filter byte + (width * 4 RGBA bytes) per row
  const rowStride = 1 + width * 4;
  const rawBuf = Buffer.alloc(rowStride * height);

  const bgR = 0x4b;
  const bgG = 0x45;
  const bgB = 0xc6;

  const cornerRadius = size * 0.22;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride;
    rawBuf[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Check rounded rect corner distance
      let inside = true;
      let alpha = 255;

      const dx = Math.max(0, Math.max(cornerRadius - x, x - (width - 1 - cornerRadius)));
      const dy = Math.max(0, Math.max(cornerRadius - y, y - (height - 1 - cornerRadius)));

      if (dx > 0 && dy > 0) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > cornerRadius) {
          inside = false;
        } else if (dist > cornerRadius - 1.5) {
          alpha = Math.round(255 * (cornerRadius - dist) / 1.5);
        }
      }

      if (!inside) {
        rawBuf[pxOffset] = 0;
        rawBuf[pxOffset + 1] = 0;
        rawBuf[pxOffset + 2] = 0;
        rawBuf[pxOffset + 3] = 0;
        continue;
      }

      // Check lines (furniture planks)
      // Line 1: y around 36%
      // Line 2: y around 50%
      // Line 3: y around 64%
      const lineThickness = size * 0.06;
      const marginX = size * 0.25;
      const isLine1 = Math.abs(y - size * 0.36) < lineThickness / 2 && x >= marginX && x <= width - marginX;
      const isLine2 = Math.abs(y - size * 0.50) < lineThickness / 2 && x >= marginX && x <= width - marginX;
      const isLine3 = Math.abs(y - size * 0.64) < lineThickness / 2 && x >= marginX && x <= width - marginX - size * 0.15;

      if (isLine1 || isLine2 || isLine3) {
        rawBuf[pxOffset] = 255;
        rawBuf[pxOffset + 1] = 255;
        rawBuf[pxOffset + 2] = 255;
        rawBuf[pxOffset + 3] = alpha;
      } else {
        rawBuf[pxOffset] = bgR;
        rawBuf[pxOffset + 1] = bgG;
        rawBuf[pxOffset + 2] = bgB;
        rawBuf[pxOffset + 3] = alpha;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idatData = zlib.deflateSync(rawBuf);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([
    pngSignature,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', idatData),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

const icon512 = generatePng(512);
const iconPath = path.join(buildDir, 'icon.png');
fs.writeFileSync(iconPath, icon512);
console.log(`Generated ${iconPath} (${icon512.length} bytes)`);
