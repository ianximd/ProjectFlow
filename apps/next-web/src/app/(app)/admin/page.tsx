'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './page.module.css';
import type { AdminStats, AdminUser, AdminWorkspace, AuditLogEntry } from '@projectflow/types';
import { RolesTab } from '@/components/admin/RolesTab';

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, token: string | null, opts?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? 'Request failed');
  return json;
}

type Tab = 'stats' | 'users' | 'workspaces' | 'audit' | 'roles';

// ─── Action colours ───────────────────────────────────────────────────────────
const ACTION_BADGE: Record<string, string> = {
  CREATE: styles.badgeGreen,
  UPDATE: styles.badgeBlue,
  DELETE: styles.badgeRed,
  LOGIN:  styles.badgeYellow,
  LOGOUT: styles.badgeGray,
};

function actionBadge(action: string) {
  return ACTION_BADGE[action] ?? styles.badgeGray;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const token = useStore((s) => s.accessToken);
  const qc    = useQueryClient();
  const [tab, setTab] = useState<Tab>('stats');

  // ── Stats ──────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiFetch('/admin/stats', token).then((j) => j.data),
    enabled: tab === 'stats',
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  const [userSearch, setUserSearch]   = useState('');
  const [userPage,   setUserPage]     = useState(1);
  const PAGE_SIZE = 50;

  const { data: usersData } = useQuery<{ users: AdminUser[]; total: number }>({
    queryKey: ['admin', 'users', userSearch, userPage],
    queryFn:  () =>
      apiFetch(`/admin/users?search=${encodeURIComponent(userSearch)}&page=${userPage}&pageSize=${PAGE_SIZE}`, token)
        .then((j) => ({ users: j.data, total: j.meta.total })),
    enabled:  tab === 'users',
  });

  const suspendMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/admin/users/${userId}/suspend`, token, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const restoreMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/admin/users/${userId}/restore`, token, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  // ── Workspaces ─────────────────────────────────────────────────────────────
  const [wsPage, setWsPage] = useState(1);

  const { data: wsData } = useQuery<{ workspaces: AdminWorkspace[]; total: number }>({
    queryKey: ['admin', 'workspaces', wsPage],
    queryFn:  () =>
      apiFetch(`/admin/workspaces?page=${wsPage}&pageSize=${PAGE_SIZE}`, token)
        .then((j) => ({ workspaces: j.data, total: j.meta.total })),
    enabled:  tab === 'workspaces',
  });

  // ── Audit log ──────────────────────────────────────────────────────────────
  const [auditResource, setAuditResource] = useState('');
  const [auditAction,   setAuditAction]   = useState('');
  const [auditFrom,     setAuditFrom]     = useState('');
  const [auditTo,       setAuditTo]       = useState('');
  const [auditPage,     setAuditPage]     = useState(1);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);

  const { data: auditData } = useQuery<{ entries: AuditLogEntry[]; total: number }>({
    queryKey: ['admin', 'audit', auditResource, auditAction, auditFrom, auditTo, auditPage],
    queryFn:  () => {
      const params = new URLSearchParams({ page: String(auditPage), pageSize: String(PAGE_SIZE) });
      if (auditResource) params.set('resource', auditResource);
      if (auditAction)   params.set('action',   auditAction);
      if (auditFrom)     params.set('fromDate',  auditFrom);
      if (auditTo)       params.set('toDate',    auditTo);
      return apiFetch(`/admin/audit-log?${params}`, token)
        .then((j) => ({ entries: j.data, total: j.meta.total }));
    },
    enabled: tab === 'audit',
  });

  const resetAuditFilters = useCallback(() => {
    setAuditResource(''); setAuditAction('');
    setAuditFrom('');     setAuditTo('');
    setAuditPage(1);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin Panel</h1>
        <p className={styles.subtitle}>System management &amp; audit log viewer</p>
      </div>

      {/* Tabs */}
      <div className={styles.tabs} role="tablist" aria-label="Admin sections">
        {(['stats', 'users', 'workspaces', 'audit', 'roles'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            id={`tab-${t}`}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {{ stats: 'Overview', users: 'Users', workspaces: 'Workspaces', audit: 'Audit Log', roles: 'Roles & Permissions' }[t]}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'stats' && stats && (
        <div className={styles.statsGrid} id="panel-stats" role="tabpanel" aria-labelledby="tab-stats">
          {([
            ['Total Users',         stats.totalUsers],
            ['Total Workspaces',    stats.totalWorkspaces],
            ['Total Projects',      stats.totalProjects],
            ['Total Tasks',         stats.totalTasks],
            ['Tasks Today',         stats.tasksCreatedToday],
            ['Logins (24h)',        stats.loginsLast24h],
            ['Audit Events Today',  stats.auditEventsToday],
          ] as [string, number][]).map(([label, value]) => (
            <div key={label} className={styles.statCard}>
              <div className={styles.statValue}>{value.toLocaleString()}</div>
              <div className={styles.statLabel}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Users ── */}
      {tab === 'users' && (
        <div id="panel-users" role="tabpanel" aria-labelledby="tab-users">
          <div className={styles.filterBar}>
            <label htmlFor="user-search" className="sr-only">Search users</label>
            <input
              id="user-search"
              className={styles.searchInput}
              placeholder="Search by name or email…"
              value={userSearch}
              onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
            />
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Users">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Name</th>
                  <th scope="col">Verified</th>
                  <th scope="col">MFA</th>
                  <th scope="col">Workspaces</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(usersData?.users ?? []).length === 0 && (
                  <tr><td colSpan={8} className={styles.empty}>No users found</td></tr>
                )}
                {(usersData?.users ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className={styles.mono}>{u.email}</td>
                    <td>{u.name}</td>
                    <td>
                      <span className={`${styles.badge} ${u.isEmailVerified ? styles.badgeGreen : styles.badgeYellow}`}>
                        {u.isEmailVerified ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${u.mfaEnabled ? styles.badgeBlue : styles.badgeGray}`}>
                        {u.mfaEnabled ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td>{u.workspaceCount}</td>
                    <td className={styles.mono}>{u.createdAt.slice(0, 10)}</td>
                    <td>
                      <span className={`${styles.badge} ${u.deletedAt ? styles.badgeRed : styles.badgeGreen}`}>
                        {u.deletedAt ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td>
                      {u.deletedAt ? (
                        <button
                          className={`${styles.actionBtn} ${styles.btnRestore}`}
                          aria-label={`Restore ${u.email}`}
                          onClick={() => restoreMutation.mutate(u.id)}
                        >Restore</button>
                      ) : (
                        <button
                          className={`${styles.actionBtn} ${styles.btnSuspend}`}
                          aria-label={`Suspend ${u.email}`}
                          onClick={() => suspendMutation.mutate(u.id)}
                        >Suspend</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={userPage}
            total={usersData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => setUserPage((p) => Math.max(1, p - 1))}
            onNext={() => setUserPage((p) => p + 1)}
          />
        </div>
      )}

      {/* ── Workspaces ── */}
      {tab === 'workspaces' && (
        <div id="panel-workspaces" role="tabpanel" aria-labelledby="tab-workspaces">
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Workspaces">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Members</th>
                  <th scope="col">Projects</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {(wsData?.workspaces ?? []).length === 0 && (
                  <tr><td colSpan={7} className={styles.empty}>No workspaces found</td></tr>
                )}
                {(wsData?.workspaces ?? []).map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td className={styles.mono}>{w.slug}</td>
                    <td className={styles.mono}>{w.ownerEmail ?? '—'}</td>
                    <td>{w.memberCount}</td>
                    <td>{w.projectCount}</td>
                    <td className={styles.mono}>{w.createdAt.slice(0, 10)}</td>
                    <td>
                      <span className={`${styles.badge} ${w.deletedAt ? styles.badgeRed : styles.badgeGreen}`}>
                        {w.deletedAt ? 'Archived' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={wsPage}
            total={wsData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => setWsPage((p) => Math.max(1, p - 1))}
            onNext={() => setWsPage((p) => p + 1)}
          />
        </div>
      )}

      {/* ── Audit Log ── */}
      {tab === 'audit' && (
        <div id="panel-audit" role="tabpanel" aria-labelledby="tab-audit">
          <div className={styles.filterBar}>
            <label htmlFor="audit-resource" className="sr-only">Filter by resource</label>
            <select
              id="audit-resource"
              className={styles.filterSelect}
              value={auditResource}
              onChange={(e) => { setAuditResource(e.target.value); setAuditPage(1); }}
              aria-label="Filter by resource"
            >
              <option value="">All resources</option>
              {['Task','Project','Sprint','Workspace','Comment','AutomationRule',
                'Webhook','OutgoingWebhook','WorkLog','Version','Label','Component',
                'Epic','GitIntegration','Auth','Admin',
              ].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>

            <label htmlFor="audit-action" className="sr-only">Filter by action</label>
            <select
              id="audit-action"
              className={styles.filterSelect}
              value={auditAction}
              onChange={(e) => { setAuditAction(e.target.value); setAuditPage(1); }}
              aria-label="Filter by action"
            >
              <option value="">All actions</option>
              {['CREATE','UPDATE','DELETE','LOGIN','LOGOUT'].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <label htmlFor="audit-from" className="sr-only">From date</label>
            <input
              id="audit-from"
              className={styles.dateInput}
              type="date"
              aria-label="From date"
              value={auditFrom}
              onChange={(e) => { setAuditFrom(e.target.value); setAuditPage(1); }}
            />
            <label htmlFor="audit-to" className="sr-only">To date</label>
            <input
              id="audit-to"
              className={styles.dateInput}
              type="date"
              aria-label="To date"
              value={auditTo}
              onChange={(e) => { setAuditTo(e.target.value); setAuditPage(1); }}
            />
            <button className={styles.pageBtn} onClick={resetAuditFilters} aria-label="Clear all filters">
              Clear
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Audit log">
              <thead>
                <tr>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">User</th>
                  <th scope="col">Action</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Resource ID</th>
                  <th scope="col">IP</th>
                  <th scope="col">Changes</th>
                </tr>
              </thead>
              <tbody>
                {(auditData?.entries ?? []).length === 0 && (
                  <tr><td colSpan={7} className={styles.empty}>No audit events found</td></tr>
                )}
                {(auditData?.entries ?? []).map((e) => (
                  <>
                    <tr key={e.id}>
                      <td className={styles.mono}>{e.createdAt.replace('T', ' ').slice(0, 19)}</td>
                      <td className={styles.mono}>{e.userEmail ?? e.userId.slice(0, 8) + '…'}</td>
                      <td>
                        <span className={`${styles.badge} ${actionBadge(e.action)}`}>{e.action}</span>
                      </td>
                      <td>{e.resource}</td>
                      <td className={styles.mono}>{e.resourceId ? e.resourceId.slice(0, 12) + '…' : '—'}</td>
                      <td className={styles.mono}>{e.ipAddress ?? '—'}</td>
                      <td>
                        {(e.oldValues || e.newValues) && (
                          <button
                            className={styles.pageBtn}
                            aria-expanded={expandedId === e.id}
                            aria-label={expandedId === e.id ? 'Hide change details' : 'View change details'}
                            onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                          >
                            {expandedId === e.id ? 'Hide' : 'View'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === e.id && (
                      <tr key={e.id + '-detail'}>
                        <td colSpan={7} style={{ background: '#0f172a', padding: '0.75rem 1rem' }}>
                          {e.oldValues && (
                            <>
                              <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Before</div>
                              <pre className={styles.jsonPre}>{JSON.stringify(e.oldValues, null, 2)}</pre>
                            </>
                          )}
                          {e.newValues && (
                            <>
                              <div style={{ color: '#94a3b8', fontSize: '0.7rem', margin: '0.5rem 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>After</div>
                              <pre className={styles.jsonPre}>{JSON.stringify(e.newValues, null, 2)}</pre>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={auditPage}
            total={auditData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => setAuditPage((p) => Math.max(1, p - 1))}
            onNext={() => setAuditPage((p) => p + 1)}
          />
        </div>
      )}

      {/* ── Roles & Permissions ── */}
      {tab === 'roles' && (
        <div id="panel-roles" role="tabpanel" aria-labelledby="tab-roles">
          <RolesTab />
        </div>
      )}
    </div>
  );
}

// ─── Pagination helper ────────────────────────────────────────────────────────

function Pagination({
  page, total, pageSize, onPrev, onNext,
}: {
  page: number; total: number; pageSize: number;
  onPrev: () => void; onNext: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={styles.pagination}>
      <span>Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
      <button className={styles.pageBtn} disabled={page <= 1} onClick={onPrev}>← Prev</button>
      <button className={styles.pageBtn} disabled={page >= totalPages} onClick={onNext}>Next →</button>
    </div>
  );
}
