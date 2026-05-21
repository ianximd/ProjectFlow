import 'server-only';
import { cache } from 'react';
import { serverFetch, serverFetchEnvelope } from '../api';
import type {
  AdminStats,
  AdminUser,
  AdminWorkspace,
  AuditLogEntry,
} from '@projectflow/types';

const PAGE_SIZE = 50;

// ── Stats ─────────────────────────────────────────────────────────────────────

export const getAdminStats = cache(async (): Promise<AdminStats> => {
  return serverFetch<AdminStats>('/admin/stats');
});

// ── Access check ───────────────────────────────────────────────────────────────
// /auth/me/permissions is auth-only (never 403), so we can ask "is this user an
// admin?" without tripping the admin.* permission gate. Used to render a clean
// not-authorized state on /admin instead of letting the first admin.* fetch throw
// an ApiError(403) up to the error boundary ("A server error occurred").

export const getMyPermissions = cache(async (): Promise<string[]> => {
  const data = await serverFetch<{ permissions?: string[] }>('/auth/me/permissions');
  return data.permissions ?? [];
});

export async function hasAdminAccess(): Promise<boolean> {
  const perms = await getMyPermissions();
  return perms.some((p) => p.startsWith('admin.'));
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface AdminUsersResult {
  items: AdminUser[];
  total: number;
}

export const getAdminUsers = cache(async (opts: {
  search?: string;
  page?: number;
} = {}): Promise<AdminUsersResult> => {
  const qs = new URLSearchParams({
    page:     String(opts.page ?? 1),
    pageSize: String(PAGE_SIZE),
  });
  if (opts.search) qs.set('search', opts.search);

  const { data, meta } = await serverFetchEnvelope<AdminUser[], { total: number }>(
    `/admin/users?${qs}`,
  );
  return { items: data ?? [], total: meta?.total ?? 0 };
});

// ── Workspaces ────────────────────────────────────────────────────────────────

export interface AdminWorkspacesResult {
  items: AdminWorkspace[];
  total: number;
}

export const getAdminWorkspaces = cache(async (opts: {
  page?: number;
} = {}): Promise<AdminWorkspacesResult> => {
  const qs = new URLSearchParams({
    page:     String(opts.page ?? 1),
    pageSize: String(PAGE_SIZE),
  });

  const { data, meta } = await serverFetchEnvelope<AdminWorkspace[], { total: number }>(
    `/admin/workspaces?${qs}`,
  );
  return { items: data ?? [], total: meta?.total ?? 0 };
});

// ── Audit log ─────────────────────────────────────────────────────────────────

export interface AuditLogResult {
  items: AuditLogEntry[];
  total: number;
}

export const getAuditLog = cache(async (opts: {
  resource?: string;
  action?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
} = {}): Promise<AuditLogResult> => {
  const qs = new URLSearchParams({
    page:     String(opts.page ?? 1),
    pageSize: String(PAGE_SIZE),
  });
  if (opts.resource) qs.set('resource', opts.resource);
  if (opts.action)   qs.set('action',   opts.action);
  if (opts.fromDate) qs.set('fromDate', opts.fromDate);
  if (opts.toDate)   qs.set('toDate',   opts.toDate);

  const { data, meta } = await serverFetchEnvelope<AuditLogEntry[], { total: number }>(
    `/admin/audit-log?${qs}`,
  );
  return { items: data ?? [], total: meta?.total ?? 0 };
});
