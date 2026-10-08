/**
 * What a profile picture may be. Only real raster images, checked by their own header bytes (never by the name or the type the browser
 * claims), with a sane size: no SVG (it can carry scripts), and no tiny file that unpacks into a gigantic image.
 */
export type AvatarType = 'image/png' | 'image/jpeg' | 'image/webp';

export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_MAX_SIDE = 1024;

export interface ImageInfo {
  type: AvatarType;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

function png(b: Uint8Array): ImageInfo | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !signature.every((v, i) => b[i] === v) || ascii(b, 12, 4) !== 'IHDR') return null;
  return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const length = u16be(b, o + 2);
    // Start-of-frame markers carry the size (C4, C8 and CC are not frames).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { type: 'image/jpeg', height: u16be(b, o + 5), width: u16be(b, o + 7) };
    if (length < 2) return null;
    o += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? { type: 'image/webp', width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff } : null;
  if (chunk === 'VP8L') return b[20] === 0x2f ? { type: 'image/webp', width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!), height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)) } : null;
  if (chunk === 'VP8X') return { type: 'image/webp', width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

/** The image's real type and size from its bytes, or null when it is not a PNG, JPEG or WebP. */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes);
}

export type AvatarProblem = 'EMPTY' | 'TOO_LARGE' | 'NOT_AN_IMAGE' | 'TYPE_MISMATCH' | 'DIMENSIONS';

/** Is this a picture we will store? Returns what is wrong with it, or null when it is fine. */
export function avatarProblem(bytes: Uint8Array, claimed: string): AvatarProblem | null {
  if (bytes.length === 0) return 'EMPTY';
  if (bytes.length > AVATAR_MAX_BYTES) return 'TOO_LARGE';
  const info = inspectImage(bytes);
  if (!info) return 'NOT_AN_IMAGE';
  if (info.type !== claimed) return 'TYPE_MISMATCH';
  if (info.width < 1 || info.height < 1 || info.width > AVATAR_MAX_SIDE || info.height > AVATAR_MAX_SIDE) return 'DIMENSIONS';
  return null;
}
