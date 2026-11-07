// Reads which code points a WOFF2 font maps to a glyph, without a font library.
// Only the cmap table is needed; WOFF2 never transforms it (only glyf, loca and hmtx have transforms).
import { brotliDecompressSync } from 'node:zlib';

export function woff2Codepoints(buf: Buffer): Set<number> {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  if (buf.toString('latin1', 4, 8) === 'ttcf') throw new Error('WOFF2 font collections are not supported');
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  let pos = 48;
  const uintBase128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[pos++];
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new Error('bad UIntBase128 in WOFF2 table directory');
  };

  // Tables follow each other unpadded in the decompressed stream, in directory order.
  let offset = 0;
  let cmap: { offset: number; length: number } | undefined;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    const tagIndex = flags & 0x3f;
    const tag = tagIndex === 63 ? buf.toString('latin1', pos, (pos += 4)) : '';
    const version = flags >> 6;
    const origLength = uintBase128();
    // glyf (10) and loca (11) use version 3 for "not transformed"; every other table uses 0.
    const glyfOrLoca = tagIndex === 10 || tagIndex === 11 || tag === 'glyf' || tag === 'loca';
    const transformed = glyfOrLoca ? version !== 3 : version !== 0;
    const length = transformed ? uintBase128() : origLength;
    if (tagIndex === 0 || tag === 'cmap') {
      if (transformed) throw new Error('WOFF2 cmap table is transformed');
      cmap = { offset, length };
    }
    offset += length;
  }
  if (!cmap) throw new Error('WOFF2 font has no cmap table');
  const data = brotliDecompressSync(buf.subarray(pos, pos + compressedSize));
  return cmapCodepoints(data.subarray(cmap.offset, cmap.offset + cmap.length));
}

/** Union of the format 4 (BMP) and format 12 (full Unicode) subtables; other formats carry no extra characters here. */
function cmapCodepoints(t: Buffer): Set<number> {
  const out = new Set<number>();
  const seen = new Set<number>();
  const numTables = t.readUInt16BE(2);
  for (let i = 0; i < numTables; i++) {
    const off = t.readUInt32BE(4 + i * 8 + 4);
    if (seen.has(off)) continue;
    seen.add(off);
    const format = t.readUInt16BE(off);
    if (format === 4) {
      const segX2 = t.readUInt16BE(off + 6);
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const start = t.readUInt16BE(starts + s);
        const end = t.readUInt16BE(ends + s);
        const delta = t.readUInt16BE(deltas + s);
        const rangeOffset = t.readUInt16BE(rangeOffsets + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const raw = rangeOffset ? t.readUInt16BE(rangeOffsets + s + rangeOffset + (c - start) * 2) : c;
          const glyph = rangeOffset && !raw ? 0 : (raw + delta) & 0xffff;
          if (glyph) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = t.readUInt32BE(off + 12);
      for (let g = 0; g < groups; g++) {
        const p = off + 16 + g * 12;
        const start = t.readUInt32BE(p);
        const end = t.readUInt32BE(p + 4);
        const glyph = t.readUInt32BE(p + 8);
        for (let c = start; c <= end; c++) if (glyph + c - start) out.add(c);
      }
    }
  }
  return out;
}
