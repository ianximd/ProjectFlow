import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

import { authMiddleware } from '../auth/auth.middleware.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { AuthService } from '../auth/auth.service.js';
import {
  uploadObject,
  deleteObject,
  getPresignedUrl,
  ATTACHMENTS_BUCKET,
} from '../../shared/lib/storage.js';

const authRepo    = new AuthRepository();
const authService = new AuthService(authRepo);

// 3 MB cap leaves comfortable headroom under the global 4 MB body guard
// (server.ts) and is plenty for any sane profile photo.
const MAX_BYTES = 3 * 1024 * 1024;

// SVG is excluded on purpose — embedded JS would XSS any consumer that
// renders it inline (e.g. our <AvatarImage>).
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// Square thumbnail edge length. Avatars are rendered at size-14 (56px) in
// the profile card and size-9 (36px) in the top-bar; 256 covers 2x-DPI
// without bloating storage.
const THUMBNAIL_SIZE = 256;

const KEY_PREFIX  = 'avatars/users/';
const URL_PREFIX  = '/api/v1/avatars/users/';

/**
 * Normalise an uploaded image into a small square thumbnail before it
 * touches MinIO. `rotate()` first honours EXIF orientation so portrait
 * phone shots don't end up sideways; sharp strips all other metadata by
 * default, which also drops GPS tags users probably don't want shipped.
 * GIF animation is intentionally collapsed to the first frame — avatars
 * shouldn't dance.
 */
async function makeThumbnail(
  buf: Buffer,
  mime: string,
): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  const pipeline = sharp(buf, { failOn: 'error' })
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover', position: 'centre' });

  if (mime === 'image/png') {
    return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(),
             mime: 'image/png',  ext: '.png' };
  }
  if (mime === 'image/webp') {
    return { buffer: await pipeline.webp({ quality: 85 }).toBuffer(),
             mime: 'image/webp', ext: '.webp' };
  }
  if (mime === 'image/gif') {
    // First frame as PNG (preserves transparency; static avatar).
    return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(),
             mime: 'image/png',  ext: '.png' };
  }
  // image/jpeg (and the fallthrough)
  return { buffer: await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer(),
           mime: 'image/jpeg', ext: '.jpg' };
}

function urlFromKey(key: string): string {
  // key  = "avatars/users/<userId>/<uuid>.<ext>"
  // url  = "/api/v1/avatars/users/<userId>/<uuid>.<ext>"
  return `/api/v1/${key}`;
}

function keyFromStoredUrl(stored: string | null | undefined): string | null {
  if (!stored || !stored.startsWith(URL_PREFIX)) return null;
  return stored.slice('/api/v1/'.length);
}

export const avatarRoutes = new Hono();

// GET /api/v1/avatars/users/:userId/:filename — public; 302 to a fresh
// presigned URL. Public because <img src=…> can't carry Bearer tokens, and
// avatars aren't secret. The random UUID in the filename means there's
// nothing to enumerate.
avatarRoutes.get('/users/:userId/:filename', async (c) => {
  const userId   = c.req.param('userId');
  const filename = c.req.param('filename');
  if (!userId || !filename || filename.includes('/') || filename.includes('..')) {
    return c.json({ error: { message: 'Not found' } }, 404);
  }
  const key = `${KEY_PREFIX}${userId}/${filename}`;
  try {
    const url = await getPresignedUrl(key, ATTACHMENTS_BUCKET);
    return c.redirect(url, 302);
  } catch {
    return c.json({ error: { message: 'Not found' } }, 404);
  }
});

// POST /api/v1/avatars/me  (multipart: file) — upload and write the stable
// /api/v1/avatars/... URL into the user's AvatarUrl. Old object (if any)
// is best-effort deleted from MinIO.
avatarRoutes.post('/me', authMiddleware, async (c) => {
  const user = (c as any).get('user') as { userId: string };

  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: { message: 'Invalid multipart body' } }, 400);
  }

  const file = body['file'] as File | undefined;
  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return c.json({ error: { message: 'file is required' } }, 400);
  }

  const mime = (file.type || '').split(';')[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return c.json(
      { error: { message: 'Only JPEG, PNG, GIF, or WebP images are allowed' } },
      415,
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return c.json({ error: { message: 'Avatar must be 3 MB or smaller' } }, 413);
  }

  // Downscale + re-encode before storage. The output mime/ext may differ
  // from the upload (e.g. GIF → PNG) — always trust what sharp produced.
  let thumb: { buffer: Buffer; mime: string; ext: string };
  try {
    thumb = await makeThumbnail(buf, mime);
  } catch {
    return c.json({ error: { message: 'Could not process image' } }, 415);
  }

  const storageKey = `${KEY_PREFIX}${user.userId}/${randomUUID()}${thumb.ext}`;
  await uploadObject(storageKey, thumb.buffer, thumb.mime);

  // Capture previous key before overwrite so we can clean up the orphan.
  const prev    = await authRepo.getUserById(user.userId);
  const prevKey = keyFromStoredUrl((prev as any)?.AvatarUrl ?? null);

  const updated = await authService.updateProfile(user.userId, {
    avatarUrl: urlFromKey(storageKey),
  });
  if (!updated) return c.json({ error: { message: 'User not found' } }, 404);

  if (prevKey && prevKey !== storageKey) {
    deleteObject(prevKey, ATTACHMENTS_BUCKET).catch(() => { /* ignore */ });
  }

  return c.json({ data: updated });
});

// DELETE /api/v1/avatars/me — clear the avatar; best-effort delete the
// object if it's one we own.
avatarRoutes.delete('/me', authMiddleware, async (c) => {
  const user = (c as any).get('user') as { userId: string };

  const prev    = await authRepo.getUserById(user.userId);
  const prevKey = keyFromStoredUrl((prev as any)?.AvatarUrl ?? null);

  const updated = await authService.updateProfile(user.userId, { avatarUrl: null });
  if (!updated) return c.json({ error: { message: 'User not found' } }, 404);

  if (prevKey) {
    deleteObject(prevKey, ATTACHMENTS_BUCKET).catch(() => { /* ignore */ });
  }

  return c.json({ data: updated });
});
