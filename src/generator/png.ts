/** Deterministic PNG encoding with tEXt chunks (SYNTHETIC tag). */
import { PNG } from 'pngjs';
import type { Page } from './raster.js';

const SIGNATURE_LEN = 8;

export const SYNTHETIC_TEXT: Record<string, string> = {
  Synthetic: 'true',
  Comment: 'SYNTHETIC: synthetic data, not real patients',
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return out;
}

export function encodePng(
  page: Page,
  textChunks: Record<string, string> = SYNTHETIC_TEXT,
): Buffer {
  const png = new PNG({ width: page.width, height: page.height });
  for (let i = 0; i < page.data.length; i++) {
    const v = page.data[i] === 1 ? 0 : 255;
    const o = i * 4;
    png.data[o] = v;
    png.data[o + 1] = v;
    png.data[o + 2] = v;
    png.data[o + 3] = 255;
  }
  const raw = PNG.sync.write(png, {
    colorType: 0,
    inputColorType: 6,
    inputHasAlpha: true,
    bitDepth: 8,
    deflateLevel: 9,
    filterType: 0,
  });
  // Insert tEXt chunks before IEND (last 12 bytes).
  const iendStart = raw.length - 12;
  const texts = Object.entries(textChunks).map(([k, v]) =>
    chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')])),
  );
  return Buffer.concat([raw.subarray(0, iendStart), ...texts, raw.subarray(iendStart)]);
}

export function readPngText(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = SIGNATURE_LEN;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'tEXt') {
      const data = buf.subarray(pos + 8, pos + 8 + len);
      const nul = data.indexOf(0);
      out[data.toString('latin1', 0, nul)] = data.toString('latin1', nul + 1);
    }
    pos += 12 + len;
  }
  return out;
}

export function decodePng(buf: Buffer): { width: number; height: number; data: Buffer } {
  const p = PNG.sync.read(buf);
  return { width: p.width, height: p.height, data: p.data };
}
