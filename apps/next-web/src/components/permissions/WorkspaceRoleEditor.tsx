'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { UserPlus, Trash2, Loader2 } from 'lucide-react';

import {
  updateWorkspaceRole, assignWorkspaceRole, revokeWorkspaceRole,
} from '@/server/actions/workspace-roles';
import { loadRoleDetail, loadRoleMembers, loadUsersForRoles } from '@/server/actions/admin-roles';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { AdminUser, Permission, RoleMember, RoleWithCounts } from '@projectflow/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Inline editor for one workspace role: edit name/description/permissions
 *  (custom roles only) plus a members assign/revoke section (any role). Mounted
 *  on demand by CustomRoleManager when a role row is expanded. */
export function WorkspaceRoleEditor({
  workspaceId, role, perms, onChanged,
}: {
  workspaceId: string;
  role:        RoleWithCounts;
  perms:       Permission[];
  onChanged:   () => void;
}) {
  return (
    <div className="space-y-4 border-t border-border bg-muted/20 p-3">
      {!role.isSystem && (
        <RoleDetailForm workspaceId={workspaceId} role={role} perms={perms} onChanged={onChanged} />
      )}
      <RoleMembers workspaceId={workspaceId} roleId={role.id} onChanged={onChanged} />
    </div>
  );
}

function RoleDetailForm({
  workspaceId, role, perms, onChanged,
}: {
  workspaceId: string;
  role:        RoleWithCounts;
  perms:       Permission[];
  onChanged:   () => void;
}) {
  const t = useTranslations('Permissions');
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [pending, start] = useTransition();

  // Prefill the permission set from the role detail (the list view only carries
  // counts, so the current permission ids are fetched lazily on expand).
  useEffect(() => {
    let cancelled = false;
    loadRoleDetail(role.id)
      .then((d) => { if (!cancelled) { setPicked(new Set(d.permissions.map((p) => p.id))); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [role.id]);

  const toggle = (id: string) =>
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const onSave = () => start(async () => {
    if (!name.trim()) return;
    const r = await updateWorkspaceRole(workspaceId, role.id, {
      name: name.trim(),
      description: description.trim() || null,
      permissionIds: [...picked],
    });
    if (!r.ok) return notifyActionError(r);
    onChanged();
  });

  return (
    <div className="space-y-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('roleNamePlaceholder')} className="h-8 text-sm" />
      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('descriptionPlaceholder')} className="h-8 text-sm" />
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5" disabled={!loaded}>
        {perms.map((p) => (
          <label key={p.id} className="flex items-center gap-1.5 text-xs text-foreground">
            <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
            <span>{p.slug}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={pending || !loaded || !name.trim()} onClick={onSave}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {t('saveChanges')}
        </Button>
      </div>
    </div>
  );
}

function RoleMembers({
  workspaceId, roleId, onChanged,
}: {
  workspaceId: string;
  roleId:      string;
  onChanged:   () => void;
}) {
  const t = useTranslations('Admin');
  const [members, setMembers] = useState<RoleMember[]>([]);
  const [loaded, setLoaded]   = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [pending, start]      = useTransition();

  const refetch = () =>
    loadRoleMembers(roleId)
      .then((m) => { setMembers(m); setLoaded(true); })
      .catch(() => setLoaded(true));

  useEffect(() => { void refetch(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [roleId]);

  const onAssign = (userId: string) => start(async () => {
    const r = await assignWorkspaceRole(workspaceId, roleId, userId);
    if (!r.ok) return notifyActionError(r);
    setShowAdd(false);
    await refetch();
    onChanged();
  });

  const onRevoke = (userId: string) => start(async () => {
    const r = await revokeWorkspaceRole(workspaceId, roleId, userId);
    if (!r.ok) return notifyActionError(r);
    await refetch();
    onChanged();
  });

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {t('rolesMembersLabel')} <span className="text-xs font-normal text-muted-foreground">({members.length})</span>
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
          <UserPlus className="size-3.5" />
          {showAdd ? t('rolesMembersCancelAssign') : t('rolesMembersAssignUser')}
        </Button>
      </div>

      {showAdd && <AssignPicker existing={members} onAssign={onAssign} isPending={pending} />}

      {!loaded ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t('rolesMembersLoadingMembers')}
        </div>
      ) : members.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('rolesMembersNoOne')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.userId} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="px-3 py-2 text-end text-xs text-muted-foreground tabular-nums">
                    {m.assignedAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Button
                      type="button" size="sm" variant="ghost" disabled={pending}
                      onClick={() => { if (confirm(t('rolesMembersRevokeConfirm', { email: m.email }))) onRevoke(m.userId); }}
                      aria-label={t('rolesMembersRevokeAriaLabel', { email: m.email })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AssignPicker({
  existing, onAssign, isPending,
}: {
  existing:  RoleMember[];
  onAssign:  (userId: string) => void;
  isPending: boolean;
}) {
  const t = useTranslations('Admin');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [results, setResults] = useState<AdminUser[]>([]);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(h);
  }, [search]);

  useEffect(() => {
    loadUsersForRoles(debounced).then(setResults).catch(() => setResults([]));
  }, [debounced]);

  const existingIds = useMemo(() => new Set(existing.map((m) => m.userId)), [existing]);
  const users = results.filter((u) => !existingIds.has(u.id));

  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-3">
      <span className="text-xs font-medium text-muted-foreground">{t('rolesMembersUserLabel')}</span>
      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setUserId(null); }}
        placeholder={t('rolesMembersSearchPlaceholder')}
        className="h-8 text-xs"
      />
      {users.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded border border-border">
          {users.map((u) => (
            <button
              type="button" key={u.id}
              onClick={() => { setUserId(u.id); setSearch(u.email); }}
              className={`block w-full px-2 py-1.5 text-start text-xs hover:bg-muted ${userId === u.id ? 'bg-muted font-medium' : ''}`}
            >
              <div>{u.name}</div>
              <div className="text-muted-foreground">{u.email}</div>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={!userId || isPending} onClick={() => onAssign(userId!)}>
          {isPending && <Loader2 className="size-3.5 animate-spin" />}
          {isPending ? t('rolesMembersAssigning') : t('rolesMembersAssign')}
        </Button>
      </div>
    </div>
  );
}
