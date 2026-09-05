import { describe, expect, it } from "vitest";
import { sniffMime, stripImageMetadata } from "@/lib/server/image";

/**
 * Pure content-sniff and metadata-strip checks (no live services). Confirms the
 * sniffer identifies real magic bytes and the reviewed-copy strip removes
 * metadata segments (PNG tEXt, JPEG APP1/EXIF) while keeping image chunks.
 */

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  const out = [(len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
  for (const c of type) out.push(c.charCodeAt(0));
  out.push(...data);
  out.push(0, 0, 0, 0); // placeholder CRC (strip does not validate it)
  return out;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngWithText(): Uint8Array {
  const ihdr = chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const text = chunk("tEXt", [..."Author".split("").map((c) => c.charCodeAt(0)), 0, 0x58]);
  const idat = chunk("IDAT", [0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  const iend = chunk("IEND", []);
  return Uint8Array.from([...PNG_SIG, ...ihdr, ...text, ...idat, ...iend]);
}

function jpegWithExif(): Uint8Array {
  const app1 = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // APP1 "Exif"
  const sos = [0xff, 0xda, 0x00, 0x03, 0x01, 0x11, 0x22, 0x33]; // SOS + tiny data
  return Uint8Array.from([0xff, 0xd8, ...app1, ...sos, 0xff, 0xd9]);
}

function has(bytes: Uint8Array, marker: string): boolean {
  const target = marker.split("").map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + target.length <= bytes.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("content sniffing", () => {
  it("identifies PNG and JPEG by magic bytes, rejects text", () => {
    expect(sniffMime(pngWithText())).toBe("image/png");
    expect(sniffMime(jpegWithExif())).toBe("image/jpeg");
    expect(sniffMime(Uint8Array.from([...`not an image`].map((c) => c.charCodeAt(0))))).toBeNull();
  });
});

describe("reviewed-copy metadata strip", () => {
  it("removes PNG tEXt but keeps IHDR/IDAT/IEND", () => {
    const stripped = stripImageMetadata(pngWithText(), "image/png");
    expect(has(stripped, "tEXt")).toBe(false);
    expect(has(stripped, "IHDR")).toBe(true);
    expect(has(stripped, "IDAT")).toBe(true);
    expect(has(stripped, "IEND")).toBe(true);
    expect(sniffMime(stripped)).toBe("image/png");
  });

  it("removes JPEG APP1/EXIF but keeps a decodable stream", () => {
    const stripped = stripImageMetadata(jpegWithExif(), "image/jpeg");
    expect(has(stripped, "Exif")).toBe(false);
    // Still a JPEG (SOI + EOI preserved).
    expect(sniffMime(stripped)).toBe("image/jpeg");
    expect(stripped[stripped.length - 2]).toBe(0xff);
    expect(stripped[stripped.length - 1]).toBe(0xd9);
  });
});
