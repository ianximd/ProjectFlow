import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export interface AttachmentRow {
  Id: string;
  TaskId: string;
  UploadedById: string;
  FileName: string;
  FileSize: number;
  MimeType: string;
  StorageKey: string;
  BucketName: string;
  DeletedAt: Date | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  UploaderName: string;
  UploaderAvatarUrl: string | null;
}

export class AttachmentRepository {
  async create(params: {
    taskId: string;
    uploadedById: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    storageKey: string;
    bucketName: string;
  }): Promise<AttachmentRow> {
    const rows = await execSpOne<AttachmentRow>('usp_Attachment_Create', [
      { name: 'TaskId',       type: sql.UniqueIdentifier,  value: params.taskId },
      { name: 'UploadedById', type: sql.UniqueIdentifier,  value: params.uploadedById },
      { name: 'FileName',     type: sql.NVarChar(500),     value: params.fileName },
      { name: 'FileSize',     type: sql.BigInt,            value: params.fileSize },
      { name: 'MimeType',     type: sql.NVarChar(255),     value: params.mimeType },
      { name: 'StorageKey',   type: sql.NVarChar(1000),    value: params.storageKey },
      { name: 'BucketName',   type: sql.NVarChar(255),     value: params.bucketName },
    ]);
    return rows[0];
  }

  async list(taskId: string): Promise<AttachmentRow[]> {
    const rows = await execSpOne<AttachmentRow>('usp_Attachment_List', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows as AttachmentRow[];
  }

  async getById(id: string): Promise<AttachmentRow | null> {
    const rows = await execSpOne<AttachmentRow>('usp_Attachment_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  async getContext(id: string): Promise<{ workspaceId: string; ownerId: string } | null> {
    const rows = await execSpOne<{ WorkspaceId: string; OwnerId: string }>('usp_Attachment_GetContext', [
      { name: 'AttachmentId', type: sql.UniqueIdentifier, value: id },
    ]);
    const r = rows[0];
    return r ? { workspaceId: r.WorkspaceId, ownerId: r.OwnerId } : null;
  }

  async softDelete(id: string, requesterId: string): Promise<{ storageKey: string; bucketName: string } | null> {
    try {
      const rows = await execSpOne<{ StorageKey: string; BucketName: string }>('usp_Attachment_Delete', [
        { name: 'Id',          type: sql.UniqueIdentifier, value: id },
        { name: 'RequesterId', type: sql.UniqueIdentifier, value: requesterId },
      ]);
      const row = rows[0];
      if (!row) return null;
      return { storageKey: row.StorageKey, bucketName: row.BucketName };
    } catch (err: any) {
      if (err.message?.includes('ATTACHMENT_NOT_FOUND_OR_NOT_OWNER')) return null;
      throw err;
    }
  }
}
