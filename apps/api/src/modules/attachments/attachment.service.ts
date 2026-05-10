import { randomUUID } from 'crypto';
import path from 'path';
import { AttachmentRepository } from './attachment.repository.js';
import type { AttachmentRow } from './attachment.repository.js';
import {
  uploadObject,
  deleteObject,
  getPresignedUrl,
  ATTACHMENTS_BUCKET,
} from '../../shared/lib/storage.js';

const repo = new AttachmentRepository();

/** Max file size: 25 MB */
const MAX_BYTES = 25 * 1024 * 1024;

/** Allowed MIME types */
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
]);

export const attachmentService = {
  async upload(params: {
    taskId: string;
    uploadedById: string;
    fileName: string;
    fileBuffer: Buffer;
    mimeType: string;
  }): Promise<AttachmentRow> {
    if (params.fileBuffer.byteLength > MAX_BYTES) {
      throw Object.assign(new Error('File exceeds 25 MB limit'), { code: 'FILE_TOO_LARGE' });
    }
    if (!ALLOWED_MIME.has(params.mimeType)) {
      throw Object.assign(new Error('File type not allowed'), { code: 'INVALID_MIME' });
    }

    // Sanitise file name — strip path traversal, keep extension
    const safeName = path.basename(params.fileName).replace(/[^a-zA-Z0-9._\- ]/g, '_');
    const ext      = path.extname(safeName);
    const storageKey = `tasks/${params.taskId}/${randomUUID()}${ext}`;

    await uploadObject(storageKey, params.fileBuffer, params.mimeType);

    return repo.create({
      taskId:       params.taskId,
      uploadedById: params.uploadedById,
      fileName:     safeName,
      fileSize:     params.fileBuffer.byteLength,
      mimeType:     params.mimeType,
      storageKey,
      bucketName:   ATTACHMENTS_BUCKET,
    });
  },

  async list(taskId: string) {
    return repo.list(taskId);
  },

  async getDownloadUrl(attachmentId: string): Promise<string | null> {
    const attachment = await repo.getById(attachmentId);
    if (!attachment || attachment.DeletedAt) return null;
    return getPresignedUrl(attachment.StorageKey, attachment.BucketName);
  },

  async delete(attachmentId: string, requesterId: string): Promise<boolean> {
    const result = await repo.softDelete(attachmentId, requesterId);
    if (!result) return false;
    // Best-effort physical deletion from storage
    try {
      await deleteObject(result.storageKey, result.bucketName);
    } catch {
      // log but don't fail — DB record is already soft-deleted
    }
    return true;
  },
};
