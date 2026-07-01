'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { loadWorkspaceRoles, loadWorkspacePermissions, createWorkspaceRole, deleteWorkspaceRole } from '@/server/actions/workspace-roles';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { Permission, RoleWithCounts } from '@projectflow/types';
import { WorkspaceRoleEditor } from './WorkspaceRoleEditor';
import styles from './CustomRoleManager.module.css';

export function CustomRoleManager({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Permissions');
  const [roles, setRoles] = useState<RoleWithCounts[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refetch = async () => setRoles(await loadWorkspaceRoles(workspaceId));
  useEffect(() => {
    void refetch();
    void loadWorkspacePermissions(workspaceId).then(setPerms);
    /* eslint-disable-line react-hooks/exhaustive-deps */
  }, [workspaceId]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const onCreate = () => start(async () => {
    if (!name.trim()) return;
    const r = await createWorkspaceRole(workspaceId, { name: name.trim(), description: null, permissionIds: [...picked] });
    if (!r.ok) return notifyActionError(r);
    setName(''); setPicked(new Set()); await refetch();
  });
  const onDelete = (roleId: string) => start(async () => {
    const r = await deleteWorkspaceRole(workspaceId, roleId);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  return (
    <section className={styles.root}>
      <h2 className={styles.heading}>{t('rolesTitle')}</h2>
      <ul className={styles.roleList}>
        {roles.map((r) => (
          <li key={r.id} className={styles.roleItem}>
            <div className={styles.roleRow}>
              <span className={styles.roleName}>{r.name}</span>
              <span className={styles.badge}>{r.isSystem ? t('system') : t('custom')}</span>
              <span className={styles.counts}>{t('counts', { perms: r.permissionCount, members: r.memberCount })}</span>
              <button
                type="button"
                className={styles.manage}
                aria-expanded={expandedId === r.id}
                onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
              >
                {expandedId === r.id ? t('close') : t('manage')}
              </button>
              {!r.isSystem && <button className={styles.delete} disabled={pending} onClick={() => onDelete(r.id)}>{t('delete')}</button>}
            </div>
            {expandedId === r.id && (
              <WorkspaceRoleEditor
                workspaceId={workspaceId}
                role={r}
                perms={perms}
                onChanged={() => { void refetch(); }}
              />
            )}
          </li>
        ))}
      </ul>
      <div className={styles.createBox}>
        <h3 className={styles.subheading}>{t('newRole')}</h3>
        <input className={styles.nameInput} value={name} placeholder={t('roleNamePlaceholder')} onChange={(e) => setName(e.target.value)} />
        <fieldset className={styles.permGrid}>
          {perms.map((p) => (
            <label key={p.id} className={styles.permLabel}>
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.slug}</span>
            </label>
          ))}
        </fieldset>
        <button className={styles.createBtn} disabled={pending || !name.trim()} onClick={onCreate}>{t('createRole')}</button>
      </div>
    </section>
  );
}
