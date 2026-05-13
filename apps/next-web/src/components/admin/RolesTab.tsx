'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShieldCheck, Loader2 } from 'lucide-react';
import type { RoleScope, RoleWithCounts } from '@projectflow/types';
import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RoleEditorDialog } from './RoleEditorDialog';

// ─── api helper ──────────────────────────────────────────────────────────────

async function api(path: string, token: string | null) {
  const res = await fetch(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (!res.ok) {
    notifyApiError(json, res.status);
    throw new Error(json.error?.message ?? 'Request failed');
  }
  return json;
}

// ─── component ───────────────────────────────────────────────────────────────

type ScopeFilter = 'ALL' | RoleScope;

export function RolesTab() {
  const token = useStore((s) => s.accessToken);
  const [scope,        setScope]        = useState<ScopeFilter>('ALL');
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [creatingScope, setCreatingScope] = useState<RoleScope | null>(null);

  const { data: roles = [], isLoading, error } = useQuery<RoleWithCounts[]>({
    queryKey: ['admin', 'roles', scope],
    queryFn:  () => {
      const q = scope === 'ALL' ? '' : `?scope=${scope}`;
      return api(`/admin/roles${q}`, token).then((j) => j.data);
    },
  });

  const dialogOpen = editingId !== null || creatingScope !== null;
  function closeDialog() {
    setEditingId(null);
    setCreatingScope(null);
  }

  return (
    <div className="space-y-5">
      {/* Top bar: scope tabs + new role */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={scope} onValueChange={(v) => setScope(v as ScopeFilter)}>
          <TabsList>
            <TabsTrigger value="ALL">All</TabsTrigger>
            <TabsTrigger value="SYSTEM">System</TabsTrigger>
            <TabsTrigger value="WORKSPACE">Workspace</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          onClick={() => setCreatingScope(scope === 'SYSTEM' ? 'SYSTEM' : 'WORKSPACE')}
        >
          <Plus className="size-4" />
          New role
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading roles…
        </div>
      )}

      {/* Roles table */}
      {!isLoading && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Name</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Scope</th>
                <th scope="col" className="px-4 py-2.5 text-end font-medium">Permissions</th>
                <th scope="col" className="px-4 py-2.5 text-end font-medium">Members</th>
                <th scope="col" className="px-4 py-2.5 text-end font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No roles match this scope.
                  </td>
                </tr>
              )}
              {roles.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setEditingId(r.id)}
                  className="cursor-pointer transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{r.name}</span>
                      {r.isSystem && (
                        <Badge variant="secondary" size="sm" className="gap-1">
                          <ShieldCheck className="size-3" />
                          Built-in
                        </Badge>
                      )}
                    </div>
                    {r.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                        {r.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={r.scope === 'SYSTEM' ? 'destructive' : 'secondary'}
                      size="sm"
                    >
                      {r.scope === 'SYSTEM' ? 'System' : 'Workspace'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {r.permissionCount}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {r.memberCount}
                  </td>
                  <td className="px-4 py-3 text-end text-xs text-muted-foreground">
                    {r.updatedAt.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RoleEditorDialog
        open={dialogOpen}
        onClose={closeDialog}
        roleId={editingId}
        initialScope={creatingScope ?? undefined}
      />
    </div>
  );
}
