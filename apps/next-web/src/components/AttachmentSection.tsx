'use client';

import { useRef, useState, DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './AttachmentSection.module.css';

// API returns rows from MSSQL stored procedures with PascalCase fields.
// See infra/sql/procedures/usp_Attachment_List.sql.
interface Attachment {
  Id:           string;
  FileName:     string;
  FileSize:     number;
  MimeType:     string;
  UploaderName: string;
  CreatedAt:    string;
}

interface Props {
  taskId: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mime: string | null | undefined) {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return '🖼️';
  if (m === 'application/pdf') return '📄';
  if (m.includes('word')) return '📝';
  if (m.includes('sheet') || m.includes('excel')) return '📊';
  if (m.includes('presentation') || m.includes('powerpoint')) return '📑';
  if (m.includes('zip')) return '🗜️';
  if (m.startsWith('text/')) return '📃';
  return '📎';
}

export function AttachmentSection({ taskId }: Props) {
  const queryClient = useQueryClient();
  const inputRef    = useRef<HTMLInputElement>(null);
  const [dragover, setDragover] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: attachments = [], isLoading } = useQuery<Attachment[]>({
    queryKey: ['attachments', taskId],
    queryFn: async () => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`/api/v1/attachments?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: !!taskId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const token = useStore.getState().accessToken;
      const form  = new FormData();
      form.append('taskId', taskId);
      form.append('file', file);
      const res = await fetch('/api/v1/attachments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', taskId] });
      setUploadError(null);
    },
    onError: (err: Error) => setUploadError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = useStore.getState().accessToken;
      await fetch(`/api/v1/attachments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', taskId] }),
  });

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => uploadMutation.mutate(f));
  };

  // Two-step download: fetch the presigned URL with the in-memory Bearer token
  // (a plain <a href> wouldn't carry it), then hand the URL to the browser.
  // The presigned URL is signed and time-limited, so it's safe to open directly.
  const openDownload = async (id: string) => {
    const token = useStore.getState().accessToken;
    const res = await fetch(`/api/v1/attachments/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    if (!res.ok) {
      setUploadError('Failed to open attachment');
      return;
    }
    const json = await res.json();
    const url  = json?.data?.url as string | undefined;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragover(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className={styles.attachments}>
      {/* Upload dropzone */}
      <div
        className={`${styles.dropzone}${dragover ? ` ${styles.dragover}` : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className={styles.dropzoneInput}
          onChange={(e) => handleFiles(e.target.files)}
          onClick={(e) => e.stopPropagation()}
        />
        <p className={styles.dropzoneText}>
          Drop files here or <span>browse</span> — max 25 MB
        </p>
      </div>

      {uploadMutation.isPending && (
        <p className={styles.uploading}>Uploading…</p>
      )}
      {uploadError && <p className={styles.error}>{uploadError}</p>}

      {/* Attachment list */}
      {isLoading ? (
        <p className={styles.empty}>Loading attachments…</p>
      ) : attachments.length === 0 ? (
        <p className={styles.empty}>No attachments yet.</p>
      ) : (
        <div className={styles.list}>
          {attachments.map((a) => (
            <div key={a.Id} className={styles.item}>
              <span className={styles.icon}>{mimeIcon(a.MimeType)}</span>
              <div className={styles.info}>
                <button
                  type="button"
                  onClick={() => openDownload(a.Id)}
                  className={styles.fileName}
                  title={a.FileName}
                  style={{
                    background: 'none',
                    border:     'none',
                    padding:    0,
                    cursor:     'pointer',
                    textAlign:  'left',
                    font:       'inherit',
                    color:      'inherit',
                  }}
                >
                  {a.FileName}
                </button>
                <p className={styles.meta}>
                  {formatBytes(a.FileSize)} · {a.UploaderName} ·{' '}
                  {new Date(a.CreatedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                className={styles.deleteBtn}
                onClick={() => deleteMutation.mutate(a.Id)}
                aria-label="Delete attachment"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
