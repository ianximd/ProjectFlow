'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type {
  Permission,
  Role,
  RoleScope,
  RoleWithPermissions,
} from '@projectflow/types';
import { useStore } from '@/store/useStore';
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

// ─── api helper ──────────────────────────────────────────────────────────────

async function api(path: string, token: string | null, opts?: RequestInit) {
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

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  open:        boolean;
  onClose:     () => void;
  /** When set: edit mode. When null: create mode (initialScope is required). */
  roleId:      string | null;
  initialScope?: RoleScope;
}

export function RoleEditorDialog({ open, onClose, roleId, initialScope }: Props) {
  const token = useStore((s) => s.accessToken);
  const qc    = useQueryClient();
  const isEdit = !!roleId;

  // ── form state ─────────────────────────────────────────────────────────
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [scope,       setScope]       = useState<RoleScope>(initialScope ?? 'WORKSPACE');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  // Fetch role detail (permissions included) when editing
  const { data: roleDetail, isLoading: isLoadingRole } = useQuery<RoleWithPermissions>({
    queryKey: ['admin', 'role', roleId],
    queryFn:  () => api(`/admin/roles/${roleId}`, token).then((j) => j.data),
    enabled:  open && !!roleId,
  });

  // Fetch permissions catalog (entire) once per session
  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ['admin', 'permissions'],
    queryFn:  () => api('/admin/permissions', token).then((j) => j.data),
    enabled:  open,
  });

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

  const createMut = useMutation({
    mutationFn: () =>
      api('/admin/roles', token, {
        method: 'POST',
        body:   JSON.stringify({
          name, description: description || null, scope,
          permissionIds: Array.from(selectedIds),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      onClose();
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!isEdit) return;
      // PATCH metadata, then PUT permissions
      await api(`/admin/roles/${roleId}`, token, {
        method: 'PATCH',
        body:   JSON.stringify({ name, description: description || null }),
      });
      await api(`/admin/roles/${roleId}/permissions`, token, {
        method: 'PUT',
        body:   JSON.stringify({ permissionIds: Array.from(selectedIds) }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      qc.invalidateQueries({ queryKey: ['admin', 'role', roleId] });
      onClose();
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () =>
      api(`/admin/roles/${roleId}`, token, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      onClose();
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const isPending = createMut.isPending || updateMut.isPending || deleteMut.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim()) {
      setErrorMsg('Name is required');
      return;
    }
    if (isEdit) updateMut.mutate();
    else        createMut.mutate();
  }

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            {isEdit ? 'Edit role' : 'Create role'}
            {isBuiltIn && <Badge variant="secondary" size="sm">Built-in</Badge>}
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
                Loading role…
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isBuiltIn || isPending}
                  placeholder="e.g. Project Lead"
                />
                {isBuiltIn && (
                  <p className="text-xs text-muted-foreground">
                    Built-in role names can&apos;t be changed.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="role-scope">Scope</Label>
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
                  <option value="WORKSPACE">Workspace</option>
                  <option value="SYSTEM">System</option>
                </select>
                {isEdit && (
                  <p className="text-xs text-muted-foreground">
                    Scope can&apos;t be changed after creation.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-desc">Description</Label>
              <textarea
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isPending}
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Short description of what this role can do"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">
                Permissions
                <span className="ms-2 text-xs font-normal text-muted-foreground">
                  ({selectedIds.size} selected)
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
          </SheetBody>

          <SheetFooter className="border-t border-border px-6 py-3 flex items-center justify-between gap-2">
            <div>
              {isEdit && !isBuiltIn && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => {
                    if (confirm('Delete this role? Active assignments will block deletion.')) {
                      deleteMut.mutate();
                    }
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isEdit ? 'Save changes' : 'Create role'}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
