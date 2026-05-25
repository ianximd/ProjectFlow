import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Accept either a full URL (e.g. http://localhost:9000) or the split
// host/port/ssl form used by .env (MINIO_ENDPOINT=localhost + MINIO_PORT +
// MINIO_USE_SSL). The S3 client needs a valid absolute URL for `endpoint`.
function resolveMinioEndpoint(): string {
  const raw = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
  if (/^https?:\/\//i.test(raw)) return raw;
  const scheme = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  const port   = process.env.MINIO_PORT ? `:${process.env.MINIO_PORT}` : '';
  return `${scheme}://${raw}${port}`;
}
const MINIO_ENDPOINT    = resolveMinioEndpoint();
const MINIO_REGION      = process.env.MINIO_REGION      || 'us-east-1';
const MINIO_ACCESS_KEY  = process.env.MINIO_ACCESS_KEY  || 'minioadmin';
const MINIO_SECRET_KEY  = process.env.MINIO_SECRET_KEY  || 'minioadmin';
export const ATTACHMENTS_BUCKET = process.env.MINIO_BUCKET || 'projectflow-attachments';

/** Singleton S3-compatible client pointed at MinIO */
export const s3 = new S3Client({
  endpoint:        MINIO_ENDPOINT,
  region:          MINIO_REGION,
  credentials: {
    accessKeyId:     MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true, // required for MinIO
});

/**
 * Upload a file buffer to MinIO.
 * Returns the storage key (object path).
 */
export async function uploadObject(
  key: string,
  body: Buffer,
  mimeType: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket:      ATTACHMENTS_BUCKET,
      Key:         key,
      Body:        body,
      ContentType: mimeType,
    }),
  );
  return key;
}

/**
 * Generate a presigned GET URL valid for 1 hour.
 */
export async function getPresignedUrl(key: string, bucket = ATTACHMENTS_BUCKET): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

/**
 * Permanently delete an object from storage.
 */
export async function deleteObject(key: string, bucket = ATTACHMENTS_BUCKET): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Ensure the attachments bucket exists (idempotent — call on startup).
 */
export async function ensureBucket(): Promise<void> {
  const { CreateBucketCommand, HeadBucketCommand } = await import('@aws-sdk/client-s3');
  try {
    await s3.send(new HeadBucketCommand({ Bucket: ATTACHMENTS_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: ATTACHMENTS_BUCKET }));
  }
}
