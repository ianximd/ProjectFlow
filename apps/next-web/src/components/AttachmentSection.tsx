'use client';

import { useRef, useState, DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './AttachmentSection.module.css';

interface Attachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploaderName: string;
  createdAt: string;
}

interface Props {
  taskId: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mime: string) {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf') return '📄';
  if (mime.includes('word')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📑';
  if (mime.includes('zip')) return '🗜️';
  if (mime.startsWith('text/')) return '📃';
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
            <div key={a.id} className={styles.item}>
              <span className={styles.icon}>{mimeIcon(a.mimeType)}</span>
              <div className={styles.info}>
                <a
                  href={`/api/v1/attachments/${a.id}/download`}
                  className={styles.fileName}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={a.fileName}
                >
                  {a.fileName}
                </a>
                <p className={styles.meta}>
                  {formatBytes(a.fileSize)} · {a.uploaderName} ·{' '}
                  {new Date(a.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                className={styles.deleteBtn}
                onClick={() => deleteMutation.mutate(a.id)}
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
