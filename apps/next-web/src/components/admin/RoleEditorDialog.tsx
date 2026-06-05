'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type {
  AdminUser,
  AdminWorkspace,
  Permission,
  RoleMember,
  RoleScope,
  RoleWithPermissions,
} from '@projectflow/types';
import {
  createRole,
  updateRole,
  setRolePermissions,
  deleteRole,
  assignUserRole,
  revokeUserRole,
  loadRoleDetail,
  loadPermissions,
  loadRoleMembers,
  loadUsersForRoles,
  loadAllWorkspacesForRoles,
} from '@/server/actions/admin-roles';
import { notifyActionError } from '@/lib/apiErrorToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PermissionPicker } from './PermissionPicker';

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  open:        boolean;
  onClose:     () => void;
  /** When set: edit mode. When null: create mode (initialScope is required). */
  roleId:      string | null;
  initialScope?: RoleScope;
}

export function RoleEditorDialog({ open, onClose, roleId, initialScope }: Props) {
  const t = useTranslations('Admin');
  const isEdit = !!roleId;

  // ── form state ─────────────────────────────────────────────────────────
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [scope,       setScope]       = useState<RoleScope>(initialScope ?? 'WORKSPACE');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  // ── server data ────────────────────────────────────────────────────────
  const [roleDetail,  setRoleDetail]  = useState<RoleWithPermissions | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [isLoadingRole, startLoadRole] = useTransition();
  const [saving, startSave] = useTransition();

  // Fetch role detail (permissions included) when editing
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !roleId) { setRoleDetail(null); return; }
    startLoadRole(async () => {
      try { setRoleDetail(await loadRoleDetail(roleId)); }
      catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Failed to load role'); }
    });
  }, [open, roleId]);

  // Fetch permissions catalog (entire) once per open
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    loadPermissions().then(setPermissions).catch(() => setPermissions([]));
  }, [open]);

  // Hydrate form when role detail arrives or dialog opens fresh
  useEffect(() => {
    if (!open) return;
    if (isEdit && roleDetail) {
      setName(roleDetail.name);
      setDescription(roleDetail.description ?? '');
      setScope(roleDetail.scope);
      setSelectedIds(new Set(roleDetail.permissions.map((p) => p.id)));
    } else if (!isEdit) {
      setName('');
      setDescription('');
      setScope(initialScope ?? 'WORKSPACE');
      setSelectedIds(new Set());
    }
    setErrorMsg(null);
  }, [open, isEdit, roleDetail, initialScope]);

  const isBuiltIn = !!roleDetail?.isSystem;

  // ── mutations ──────────────────────────────────────────────────────────

  const doCreate = () => startSave(async () => {
    const r = await createRole({
      name, description: description || null, scope,
      permissionIds: Array.from(selectedIds),
    });
    if (!r.ok) { setErrorMsg(r.error); notifyActionError(r); return; }
    onClose();
  });

  const doUpdate = () => startSave(async () => {
    // PATCH metadata, then PUT permissions
    const r1 = await updateRole(roleId!, { name, description: description || null });
    if (!r1.ok) { setErrorMsg(r1.error); notifyActionError(r1); return; }
    const r2 = await setRolePermissions(roleId!, Array.from(selectedIds));
    if (!r2.ok) { setErrorMsg(r2.error); notifyActionError(r2); return; }
    onClose();
  });

  const doDelete = () => startSave(async () => {
    const r = await deleteRole(roleId!);
    if (!r.ok) { setErrorMsg(r.error); notifyActionError(r); return; }
    onClose();
  });

  const isPending = isLoadingRole || saving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim()) {
      setErrorMsg(t('rolesEditorNameRequired'));
      return;
    }
    if (isEdit) doUpdate();
    else        doCreate();
  }

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            {isEdit ? t('rolesEditorEditTitle') : t('rolesEditorCreateTitle')}
            {isBuiltIn && <Badge variant="secondary" size="sm">{t('rolesBuiltIn')}</Badge>}
          </SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <SheetBody className="flex-1 overflow-y-auto p-6 space-y-6">
            {errorMsg && (
              <Alert variant="destructive">
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            {isEdit && isLoadingRole && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('rolesEditorLoadingRole')}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">{t('rolesEditorNameLabel')}</Label>
                <Input
                  id="role-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isBuiltIn || isPending}
                  placeholder={t('rolesEditorNamePlaceholder')}
                />
                {isBuiltIn && (
                  <p className="text-xs text-muted-foreground">
                    {t('rolesEditorBuiltInNameHint')}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="role-scope">{t('rolesEditorScopeLabel')}</Label>
                <select
                  id="role-scope"
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value as RoleScope);
                    // Clear selections when scope flips so we don't keep mismatched ids
                    setSelectedIds(new Set());
                  }}
                  disabled={isEdit || isPending}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="WORKSPACE">{t('rolesEditorScopeWorkspace')}</option>
                  <option value="SYSTEM">{t('rolesEditorScopeSystem')}</option>
                </select>
                {isEdit && (
                  <p className="text-xs text-muted-foreground">
                    {t('rolesEditorScopeFixedHint')}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-desc">{t('rolesEditorDescLabel')}</Label>
              <textarea
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isPending}
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={t('rolesEditorDescPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">
                {t('rolesEditorPermissionsLabel')}
                <span className="ms-2 text-xs font-normal text-muted-foreground">
                  ({t('rolesEditorSelectedCount', { count: selectedIds.size })})
                </span>
              </Label>
              <PermissionPicker
                catalog={permissions}
                scope={scope}
                selectedIds={selectedIds}
                onChange={setSelectedIds}
                disabled={isPending}
              />
            </div>

            {isEdit && roleDetail && (
              <RoleMembersSection
                roleId={roleId!}
                scope={roleDetail.scope}
              />
            )}
          </SheetBody>

          <SheetFooter className="border-t border-border px-6 py-3 flex items-center justify-between gap-2">
            <div>
              {isEdit && !isBuiltIn && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => {
                    if (confirm(t('rolesEditorDeleteConfirm'))) {
                      doDelete();
                    }
                  }}
                >
                  {t('rolesEditorDelete')}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
                {t('rolesEditorCancel')}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? t('rolesEditorSaving') : isEdit ? t('rolesEditorSaveChanges') : t('rolesEditorCreateRole')}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Members section ─────────────────────────────────────────────────────────

function RoleMembersSection({
  roleId, scope,
}: {
  roleId: string;
  scope:  RoleScope;
}) {
  const t = useTranslations('Admin');
  const [members, setMembers] = useState<RoleMember[]>([]);
  const [loaded,  setLoaded]  = useState(false);
  const [pending, start]      = useTransition();
  const [showAdd, setShowAdd] = useState(false);

  const refetch = () =>
    loadRoleMembers(roleId)
      .then((m) => { setMembers(m); setLoaded(true); })
      .catch(() => setLoaded(true)); // exit the loading state even on failure

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refetch(); }, [roleId]);

  const onRevoke = (userId: string, workspaceId: string | null) => start(async () => {
    const r = await revokeUserRole(userId, roleId, workspaceId);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  const onAssign = (userId: string, workspaceId: string | null) => start(async () => {
    const r = await assignUserRole(userId, { roleId, workspaceId });
    if (!r.ok) return notifyActionError(r);
    setShowAdd(false);
    await refetch();
  });

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm">
          {t('rolesMembersLabel')}
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            ({members.length})
          </span>
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowAdd((v) => !v)}
        >
          <UserPlus className="size-3.5" />
          {showAdd ? t('rolesMembersCancelAssign') : t('rolesMembersAssignUser')}
        </Button>
      </div>

      {showAdd && (
        <AssignMemberPicker
          scope={scope}
          existing={members}
          onAssign={onAssign}
          isPending={pending}
        />
      )}

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
                <tr key={`${m.userId}:${m.workspaceId ?? 'sys'}`} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {scope === 'WORKSPACE' && (
                      <Badge variant="secondary" size="sm">{m.workspaceName ?? '—'}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end text-xs text-muted-foreground tabular-nums">
                    {m.assignedAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(t('rolesMembersRevokeConfirm', { email: m.email }))) {
                          onRevoke(m.userId, m.workspaceId);
                        }
                      }}
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

// Inline picker shown when clicking "Assign user". For WORKSPACE-scoped roles
// the workspace is required; the API enforces this server-side too.
function AssignMemberPicker({
  scope, existing, onAssign, isPending,
}: {
  scope:     RoleScope;
  existing:  RoleMember[];
  onAssign:  (userId: string, workspaceId: string | null) => void;
  isPending: boolean;
}) {
  const t = useTranslations('Admin');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [userResults, setUserResults] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadUsersForRoles(debounced).then(setUserResults).catch(() => setUserResults([]));
  }, [debounced]);

  useEffect(() => {
    if (scope === 'WORKSPACE') {
      loadAllWorkspacesForRoles().then(setWorkspaces).catch(() => setWorkspaces([]));
    }
  }, [scope]);

  // Hide users who already hold this role in the chosen scope/workspace.
  const existingKey = useMemo(() => {
    const s = new Set<string>();
    for (const m of existing) s.add(`${m.userId}:${m.workspaceId ?? ''}`);
    return s;
  }, [existing]);

  const users = userResults.filter(
    (u) => !existingKey.has(`${u.id}:${workspaceId ?? ''}`),
  );

  const canAssign = !!userId && (scope === 'SYSTEM' || !!workspaceId);

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">{t('rolesMembersUserLabel')}</Label>
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setUserId(null); }}
            placeholder={t('rolesMembersSearchPlaceholder')}
            className="h-8 text-xs"
          />
          {users.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded border border-border bg-background">
              {users.map((u) => (
                <button
                  type="button"
                  key={u.id}
                  onClick={() => { setUserId(u.id); setSearch(u.email); }}
                  className={`block w-full px-2 py-1.5 text-start text-xs hover:bg-muted ${
                    userId === u.id ? 'bg-muted font-medium' : ''
                  }`}
                >
                  <div>{u.name}</div>
                  <div className="text-muted-foreground">{u.email}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {scope === 'WORKSPACE' && (
          <div className="space-y-1">
            <Label className="text-xs">{t('rolesMembersWorkspaceLabel')}</Label>
            <select
              value={workspaceId ?? ''}
              onChange={(e) => setWorkspaceId(e.target.value || null)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">{t('rolesMembersChooseWorkspace')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!canAssign || isPending}
          onClick={() => onAssign(userId!, workspaceId)}
        >
          {isPending && <Loader2 className="size-3.5 animate-spin" />}
          {isPending ? t('rolesMembersAssigning') : t('rolesMembersAssign')}
        </Button>
      </div>
    </div>
  );
}
