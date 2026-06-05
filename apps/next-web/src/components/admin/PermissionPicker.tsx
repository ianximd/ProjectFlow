'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { Permission, RoleScope } from '@projectflow/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface Props {
  catalog:        Permission[];          // full permission list (filtered to scope)
  scope:          RoleScope;
  selectedIds:    Set<string>;
  onChange:       (next: Set<string>) => void;
  disabled?:      boolean;
}

/** Permission catalog grouped by resource with a checkbox per slug. */
export function PermissionPicker({ catalog, scope, selectedIds, onChange, disabled }: Props) {
  const t = useTranslations('Admin');
  const groups = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of catalog) {
      if (p.scope !== scope) continue;
      if (!map.has(p.resource)) map.set(p.resource, []);
      map.get(p.resource)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [catalog, scope]);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function toggleResource(perms: Permission[], wantAll: boolean) {
    const next = new Set(selectedIds);
    for (const p of perms) {
      if (wantAll) next.add(p.id);
      else next.delete(p.id);
    }
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('permissionsNoAvailable')}
        </p>
      )}

      {groups.map(([resource, perms]) => {
        const allChecked = perms.every((p) => selectedIds.has(p.id));
        const someChecked = !allChecked && perms.some((p) => selectedIds.has(p.id));
        return (
          <div key={resource} className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`grp-${resource}`}
                  checked={allChecked}
                  onCheckedChange={() => toggleResource(perms, !allChecked)}
                  disabled={disabled}
                  aria-label={`Toggle all ${resource} permissions`}
                />
                <Label
                  htmlFor={`grp-${resource}`}
                  className="text-sm font-semibold capitalize cursor-pointer"
                >
                  {resource}
                </Label>
                {someChecked && (
                  <Badge variant="secondary" size="sm">
                    {perms.filter((p) => selectedIds.has(p.id)).length}/{perms.length}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 ps-7">
              {perms.map((p) => (
                <div key={p.id} className="flex items-start gap-2">
                  <Checkbox
                    id={`perm-${p.id}`}
                    checked={selectedIds.has(p.id)}
                    onCheckedChange={() => toggle(p.id)}
                    disabled={disabled}
                  />
                  <div className="min-w-0">
                    <Label
                      htmlFor={`perm-${p.id}`}
                      className="text-sm font-medium leading-tight cursor-pointer block"
                    >
                      {p.action}
                    </Label>
                    {p.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
