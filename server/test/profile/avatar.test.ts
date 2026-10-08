import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { avatarResponseSchema, meResponseSchema } from '@tinker/shared';
import { AVATAR_MAX_BYTES, avatarProblem, inspectImage } from '../../src/modules/profile/image.ts';
import { call, startHarness, type Harness, type TestUser } from '../support/harness.ts';

/** Just the header bytes of each format, with a chosen size (the checks read headers, never decode pixels). */
const png = (w: number, h: number, pad = 0) => {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
const webpX = (w: number, h: number) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};
const webpL = (w: number, h: number) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBPVP8L', 8, 'ascii');
  b[20] = 0x2f;
  const bits = (w - 1) | ((h - 1) << 14);
  b.writeUInt32LE(bits >>> 0, 21);
  return b;
};

describe('what counts as a profile picture', () => {
  it('reads the real type and size from the header bytes of PNG, JPEG and WebP', () => {
    expect(inspectImage(png(256, 128))).toEqual({ type: 'image/png', width: 256, height: 128 });
    expect(inspectImage(jpeg(300, 200))).toEqual({ type: 'image/jpeg', width: 300, height: 200 });
    expect(inspectImage(webpX(640, 480))).toEqual({ type: 'image/webp', width: 640, height: 480 });
    expect(inspectImage(webpL(100, 50))).toEqual({ type: 'image/webp', width: 100, height: 50 });
  });

  it('refuses SVG, scripts and anything that is not a picture, whatever it claims to be', () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<html><script>x</script>', 'GIF89a......', 'not an image at all']) {
      expect(avatarProblem(Buffer.from(text), 'image/png'), text).toBe('NOT_AN_IMAGE');
    }
    expect(inspectImage(Buffer.alloc(0))).toBeNull();
  });

  it('a picture must be what it says it is, small in bytes and in pixels, and not empty', () => {
    expect(avatarProblem(png(64, 64), 'image/png')).toBeNull();
    expect(avatarProblem(jpeg(64, 64), 'image/jpeg')).toBeNull();
    expect(avatarProblem(png(64, 64), 'image/jpeg')).toBe('TYPE_MISMATCH');
    expect(avatarProblem(png(5000, 5000), 'image/png')).toBe('DIMENSIONS'); // a tiny file that unpacks into a huge image
    expect(avatarProblem(png(0, 10), 'image/png')).toBe('DIMENSIONS');
    expect(avatarProblem(png(64, 64, AVATAR_MAX_BYTES), 'image/png')).toBe('TOO_LARGE');
    expect(avatarProblem(Buffer.alloc(0), 'image/png')).toBe('EMPTY');
  });

  it('broken or truncated headers do not crash the check', () => {
    for (const b of [Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('RIFF'), Buffer.from([0x89, 0x50, 0x4e, 0x47])]) {
      expect(() => inspectImage(b)).not.toThrow();
    }
  });
});

describe('profile picture API', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('portrait');
  });
  afterAll(() => h.close());

  const put = (user: TestUser | null, contentType: string, bytes: Buffer) => call(h, user, 'PUT', '/v1/me/avatar', { contentType, data: bytes.toString('base64') });

  it('stores a picture, tells /v1/me about it, serves it back unchanged, and deletes it', async () => {
    const before = meResponseSchema.parse((await call(h, u, 'GET', '/v1/me')).body);
    expect(before.user.avatarUpdatedAt).toBeNull();
    expect((await call(h, u, 'GET', '/v1/me/avatar')).status).toBe(404);

    const image = png(256, 256, 100);
    const saved = await put(u, 'image/png', image);
    expect(saved.status).toBe(200);

    const me = meResponseSchema.parse((await call(h, u, 'GET', '/v1/me')).body);
    expect(me.user.avatarUpdatedAt).toBe(saved.body.updatedAt);
    const back = avatarResponseSchema.parse((await call(h, u, 'GET', '/v1/me/avatar')).body);
    expect(back.contentType).toBe('image/png');
    expect(Buffer.from(back.data, 'base64').equals(image)).toBe(true);

    const replaced = await put(u, 'image/jpeg', jpeg(128, 128));
    expect(replaced.status).toBe(200);
    expect((await call(h, u, 'GET', '/v1/me/avatar')).body.contentType).toBe('image/jpeg');

    expect((await call(h, u, 'DELETE', '/v1/me/avatar')).status).toBe(200);
    expect((await call(h, u, 'GET', '/v1/me/avatar')).status).toBe(404);
    expect(meResponseSchema.parse((await call(h, u, 'GET', '/v1/me')).body).user.avatarUpdatedAt).toBeNull();
  });

  it('refuses anything that is not a real, small picture, with a plain reason, and stores nothing', async () => {
    const svg = await put(u, 'image/png', Buffer.from('<svg><script>alert(1)</script></svg>'));
    expect(svg.status).toBe(422);
    expect(svg.body.error.details).toMatchObject({ reason: 'INVALID_AVATAR', problem: 'NOT_AN_IMAGE' });
    expect((await put(u, 'image/png', png(4000, 4000))).body.error.details.problem).toBe('DIMENSIONS');
    expect((await put(u, 'image/png', png(10, 10, AVATAR_MAX_BYTES))).body.error.details.problem).toBe('TOO_LARGE');
    expect((await put(u, 'image/jpeg', png(10, 10))).body.error.details.problem).toBe('TYPE_MISMATCH');
    expect((await call(h, u, 'PUT', '/v1/me/avatar', { contentType: 'image/svg+xml', data: 'PHN2Zz4=' })).status).toBe(400);
    expect((await call(h, u, 'PUT', '/v1/me/avatar', { contentType: 'image/png', data: 'not base64 !!' })).status).toBe(400);
    expect((await call(h, u, 'GET', '/v1/me/avatar')).status).toBe(404);
  });

  it('is private: only the owner, only signed in, and every person has their own', async () => {
    const owner = await h.newUser('owner'); // a fresh person: the upload limit above is per person
    await put(owner, 'image/png', png(32, 32));
    const other = await h.newUser('neighbour');
    expect((await call(h, other, 'GET', '/v1/me/avatar')).status).toBe(404); // not the owner's picture
    expect((await call(h, null, 'GET', '/v1/me/avatar')).status).toBe(401);
    expect((await put(null, 'image/png', png(32, 32))).status).toBe(401);
    await put(other, 'image/jpeg', jpeg(32, 32));
    expect((await call(h, owner, 'GET', '/v1/me/avatar')).body.contentType).toBe('image/png');
    expect((await call(h, other, 'GET', '/v1/me/avatar')).body.contentType).toBe('image/jpeg');
  });

  it('limits how often a picture can be uploaded', async () => {
    const eager = await h.newUser('eager');
    const results = [];
    for (let i = 0; i < 8; i++) results.push((await put(eager, 'image/png', png(16 + i, 16))).status);
    expect(results.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(results.slice(6).every((s) => s === 429)).toBe(true);
  });
});
