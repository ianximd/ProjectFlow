'use client';

import { useEffect, useRef, useState, useTransition, DragEvent } from 'react';
import {
  uploadAttachment,
  deleteAttachment,
  getAttachmentDownloadUrl,
  loadAttachments,
} from '@/server/actions/attachments';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { Attachment } from '@/server/queries/attachments';
import styles from './AttachmentSection.module.css';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('Attachments');
  const inputRef    = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, start] = useTransition();
  const [dragover, setDragover] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const refetch = () => loadAttachments(taskId).then((rows) => {
    setAttachments(rows);
    setLoaded(true);
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (taskId) refetch();
  }, [taskId]);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    start(async () => {
      for (const f of arr) {
        const form = new FormData();
        form.append('taskId', taskId);
        form.append('file', f);
        const r = await uploadAttachment(form);
        if (!r.ok) { setUploadError(r.error); notifyActionError(r); return; }
      }
      setUploadError(null);
      await refetch();
    });
  };

  const onDeleteAttachment = (id: string) => start(async () => {
    const r = await deleteAttachment(id);
    if (!r.ok) { setUploadError(r.error); return notifyActionError(r); }
    await refetch();
  });

  // Two-step download: ask the server for the signed URL, then hand it to the
  // browser. The presigned URL is signed and time-limited, so it's safe to open.
  const openDownload = async (id: string) => {
    const r = await getAttachmentDownloadUrl(id);
    if (!r.ok) { setUploadError(t('failedOpen')); return notifyActionError(r); }
    if (r.data.url) window.open(r.data.url, '_blank', 'noopener,noreferrer');
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
        aria-label={t('dropzoneLabel')}
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
          {t('dropzoneLabel')}
        </p>
      </div>

      {pending && (
        <p className={styles.uploading}>{t('uploading')}</p>
      )}
      {uploadError && <p className={styles.error}>{uploadError}</p>}

      {/* Attachment list */}
      {!loaded ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : attachments.length === 0 ? (
        <p className={styles.empty}>{t('noAttachments')}</p>
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
                onClick={() => onDeleteAttachment(a.Id)}
                disabled={pending}
                aria-label={t('deleteAttachment')}
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
