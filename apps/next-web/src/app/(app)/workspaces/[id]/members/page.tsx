'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, ArrowLeft, UserPlus, Shield, Trash2,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';

interface MemberRow {
  Id:        string;
  Email:     string;
  Name:      string;
  AvatarUrl: string | null;
  JoinedAt:  string;
  RoleSlugs: string | null;
  IsOwner:   boolean;
}

const ROLE_OPTIONS = ['ADMIN', 'MEMBER', 'VIEWER'] as const;
type RoleInput = typeof ROLE_OPTIONS[number];

// Map UserRoles slugs back to the API's role string. The UI normalises the
// noisy slug list ("workspace-admin", "workspace-viewer", …) into a single
// label so the dropdown's selected value is unambiguous.
function effectiveRoleInput(slugs: string | null, isOwner: boolean): RoleInput | 'OWNER' {
  if (isOwner) return 'OWNER';
  const arr = (slugs ?? '').split(',').filter(Boolean);
  if (arr.includes('workspace-admin'))  return 'ADMIN';
  if (arr.includes('workspace-viewer')) return 'VIEWER';
  return 'MEMBER';
}

function roleBadgeVariant(role: 'OWNER' | RoleInput): { label: string; cls: string } {
  switch (role) {
    case 'OWNER':  return { label: 'Owner',  cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' };
    case 'ADMIN':  return { label: 'Admin',  cls: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' };
    case 'MEMBER': return { label: 'Member', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' };
    case 'VIEWER': return { label: 'Viewer', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    notifyApiError(json, res.status);
    throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  }
  return json;
}

export default function WorkspaceMembersPage() {
  const params      = useParams<{ id: string }>();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);
  const workspaceId = params.id;

  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: ws } = useQuery<Record<string, any>>({
    queryKey: ['workspace', workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => (await api(`/workspaces/${workspaceId}`, accessToken)).data,
  });

  const { data: members, isLoading } = useQuery<MemberRow[]>({
    queryKey: ['workspace', workspaceId, 'members'],
    enabled: !!workspaceId,
    queryFn: async () => (await api(`/workspaces/${workspaceId}/members`, accessToken)).data ?? [],
  });

  const inviteMutation = useMutation({
    mutationFn: (input: { email: string; role: RoleInput }) =>
      api(`/workspaces/${workspaceId}/members/by-email`, accessToken, {
        method: 'POST', body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace', workspaceId, 'members'] });
      setInviteOpen(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api(`/workspaces/${workspaceId}/members/${userId}`, accessToken, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', workspaceId, 'members'] }),
  });

  const setRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: RoleInput }) =>
      api(`/workspaces/${workspaceId}/members/${userId}/role`, accessToken, {
        method: 'PUT', body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', workspaceId, 'members'] }),
  });

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link href="/workspaces" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Users className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground truncate">
            {ws?.Name ?? 'Workspace'} · Members
          </div>
          <h2 className="text-base font-semibold text-foreground">
            {members ? `${members.length} member${members.length === 1 ? '' : 's'}` : 'Loading…'}
          </h2>
        </div>
        <Button size="sm" variant="primary" onClick={() => setInviteOpen(true)}>
          <UserPlus className="size-4" /> Invite
        </Button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-4 flex flex-col gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !members || members.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No members yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Joined</th>
                  <th className="px-4 py-2 w-[1%]"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const role  = effectiveRoleInput(m.RoleSlugs, m.IsOwner);
                  const badge = roleBadgeVariant(role);
                  return (
                    <tr key={m.Id} className="border-t border-border/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar className="size-8">
                            {m.AvatarUrl
                              ? <AvatarImage src={m.AvatarUrl} alt={m.Name} className="size-8" />
                              : null}
                            <AvatarFallback className="text-xs font-medium">
                              {initials(m.Name || m.Email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate">{m.Name}</div>
                            <div className="text-xs text-muted-foreground truncate">{m.Email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {m.IsOwner ? (
                          <Badge size="sm" variant="outline" appearance="outline" className={`gap-1 ${badge.cls}`}>
                            <Shield className="size-3" /> {badge.label}
                          </Badge>
                        ) : (
                          <Select
                            value={role}
                            onValueChange={(v) => setRoleMutation.mutate({ userId: m.Id, role: v as RoleInput })}
                            disabled={setRoleMutation.isPending}
                          >
                            <SelectTrigger className="h-8 w-[130px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {roleBadgeVariant(r).label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {m.JoinedAt?.slice(0, 10) ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!m.IsOwner && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm(`Remove ${m.Email} from this workspace?\n\nThey will lose access to all projects and their workspace role assignments will be cleared.`)) {
                                removeMutation.mutate(m.Id);
                              }
                            }}
                            disabled={removeMutation.isPending}
                            aria-label={`Remove ${m.Email}`}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSubmit={(input) => inviteMutation.mutate(input)}
        isPending={inviteMutation.isPending}
        error={(inviteMutation.error as Error | null)?.message ?? null}
      />
    </div>
  );
}

function InviteDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { email: string; role: RoleInput }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState<RoleInput>('MEMBER');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setEmail(''); setRole('MEMBER'); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ email: email.trim(), role }); }}>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="inv-email" className="text-xs font-medium text-muted-foreground">Email</label>
              <Input
                id="inv-email" type="email" required value={email} autoFocus
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@company.com"
              />
              <span className="text-xs text-muted-foreground">
                The user must already have an account. If they don't, ask them to register first.
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="inv-role" className="text-xs font-medium text-muted-foreground">Role</label>
              <Select value={role} onValueChange={(v) => setRole(v as RoleInput)}>
                <SelectTrigger id="inv-role" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{roleBadgeVariant(r).label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isPending || !email.trim()}>
              {isPending ? 'Inviting…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
