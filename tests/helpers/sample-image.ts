import { crc32 as zlibCrc32, deflateSync } from "node:zlib";

/**
 * Dependency-free tiny valid PNG generator, shared by the vitest live-integration
 * helpers (`tests/helpers/live.ts`) and the Playwright specs (`tests/e2e/*`).
 * This module imports nothing from vitest, so it can be imported from the
 * Playwright runner without pulling vitest in (see the note in
 * `tests/e2e/helpers.ts`).
 *
 * Produces a genuinely decodable 1x1 opaque RGBA PNG: the correct 8-byte
 * signature, an IHDR chunk (1x1, 8-bit depth, colour type 6/RGBA), a single
 * IDAT chunk holding a real DEFLATE stream of one filtered scanline (filter-type
 * byte 0 + 4 raw RGBA bytes), and an IEND chunk — with each chunk's length and
 * CRC-32 (over its type+data, per the PNG spec) computed for real. The
 * previous fixture hardcoded every chunk CRC as `0,0,0,0` and truncated its
 * IDAT, so nothing that rendered it could decode the bytes.
 *
 * CRC-32 uses `node:zlib`'s `crc32` (present since Node 20.12) when available;
 * otherwise it falls back to a small table-based implementation, since
 * package.json only requires Node `>=20`.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Fallback(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  if (typeof zlibCrc32 === "function") return zlibCrc32(bytes) >>> 0;
  return crc32Fallback(bytes);
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function chunk(type: string, data: number[]): number[] {
  const typeBytes = Array.from(type, (c) => c.charCodeAt(0));
  const body = Uint8Array.from([...typeBytes, ...data]);
  return [...u32be(data.length), ...typeBytes, ...data, ...u32be(crc32(body))];
}

/**
 * A genuine, decodable 1x1 opaque RGBA PNG. Kept as `samplePng()` (same name
 * and signature as the previous stub) so existing call sites keep working
 * unmodified.
 */
export function samplePng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [
    ...u32be(1), // width
    ...u32be(1), // height
    8, // bit depth
    6, // colour type: truecolour with alpha (RGBA)
    0, // compression method
    0, // filter method
    0, // interlace method
  ];
  const scanline = Uint8Array.from([0, 0xdd, 0x33, 0x33, 0xff]); // filter 0 + opaque RGBA pixel
  const idatData = Array.from(deflateSync(Buffer.from(scanline)));
  return Uint8Array.from([
    ...sig,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", idatData),
    ...chunk("IEND", []),
  ]);
}
