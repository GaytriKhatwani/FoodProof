import "server-only";

/**
 * Content sniffing and image metadata stripping (FOODPROOF_TECHNICAL_SPEC.md §5,
 * §6). Uploads are sniffed by magic bytes (never trust the client content-type),
 * and reviewed copies have their metadata removed. This strips metadata segments
 * (EXIF/XMP/text/comments) rather than performing a full pixel re-encode — it
 * removes the personal-data vector the spec calls out without adding a native
 * image dependency; a full transcode is a documented hardening step.
 */

export type SniffedType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"
  | null;

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i += 1) s += String.fromCharCode(b[off + i] ?? 0);
  return s;
}

export function sniffMime(bytes: Uint8Array): SniffedType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 5 && ascii(bytes, 0, 4) === "%PDF") return "application/pdf";
  return null;
}

export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  if (mime === "image/jpeg") return stripJpeg(bytes);
  if (mime === "image/png") return stripPng(bytes);
  if (mime === "image/webp") return stripWebp(bytes);
  return bytes;
}

/** Drop APPn (incl. EXIF) and comment segments; keep image data intact. */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      break;
    }
    if (marker !== undefined && marker >= 0xd0 && marker <= 0xd7) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (marker === 0xda) {
      for (let k = i; k < bytes.length; k += 1) out.push(bytes[k]!);
      break;
    }
    if (marker !== undefined && ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
      i += 2 + len;
      continue;
    }
    for (let k = i; k < i + 2 + len && k < bytes.length; k += 1) out.push(bytes[k]!);
    i += 2 + len;
  }
  return Uint8Array.from(out);
}

/** Drop textual/EXIF/time ancillary chunks; keep critical rendering chunks. */
function stripPng(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let k = 0; k < 8; k += 1) out.push(bytes[k]!);
  const drop = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len =
      ((bytes[i] ?? 0) << 24) |
      ((bytes[i + 1] ?? 0) << 16) |
      ((bytes[i + 2] ?? 0) << 8) |
      (bytes[i + 3] ?? 0);
    const type = ascii(bytes, i + 4, 4);
    const total = 12 + len;
    if (!drop.has(type)) {
      for (let k = i; k < i + total && k < bytes.length; k += 1) out.push(bytes[k]!);
    }
    i += total;
    if (type === "IEND") break;
  }
  return Uint8Array.from(out);
}

/** Rebuild the RIFF container without EXIF/XMP chunks; fix the RIFF size. */
function stripWebp(bytes: Uint8Array): Uint8Array {
  const body: number[] = [];
  for (let k = 0; k < 12; k += 1) body.push(bytes[k]!);
  let i = 12;
  while (i + 8 <= bytes.length) {
    const fourcc = ascii(bytes, i, 4);
    const size =
      (bytes[i + 4] ?? 0) |
      ((bytes[i + 5] ?? 0) << 8) |
      ((bytes[i + 6] ?? 0) << 16) |
      ((bytes[i + 7] ?? 0) << 24);
    const total = 8 + size + (size & 1);
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      for (let k = i; k < i + total && k < bytes.length; k += 1) body.push(bytes[k]!);
    }
    i += total;
  }
  const riffSize = body.length - 8;
  body[4] = riffSize & 0xff;
  body[5] = (riffSize >> 8) & 0xff;
  body[6] = (riffSize >> 16) & 0xff;
  body[7] = (riffSize >> 24) & 0xff;
  return Uint8Array.from(body);
}
