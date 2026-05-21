import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

// API returns rows from MSSQL stored procedures with PascalCase fields.
// See infra/sql/procedures/usp_Attachment_List.sql. Kept verbatim — do NOT
// rename to camelCase (the client renders these field names directly).
export interface Attachment {
  Id:           string;
  FileName:     string;
  FileSize:     number;
  MimeType:     string;
  UploaderName: string;
  CreatedAt:    string;
}

// GET /attachments?taskId= returns the standard { data: Attachment[] } envelope.
export const getAttachments = cache(async (taskId: string): Promise<Attachment[]> => {
  return (await serverFetch<Attachment[]>(`/attachments?taskId=${encodeURIComponent(taskId)}`)) ?? [];
});
