'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Users, ArrowLeft, UserPlus, Shield, Trash2,
} from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import { inviteMember, removeMember, updateMemberRole } from '@/server/actions/members';
import type { WorkspaceDetail, MemberRow } from '@/server/queries/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';

const ROLE_OPTIONS = ['ADMIN', 'MEMBER', 'VIEWER'] as const;
type RoleInput = typeof ROLE_OPTIONS[number];

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

export function MembersView({
  workspace,
  members,
}: {
  workspace: WorkspaceDetail;
  members: MemberRow[];
}) {
  const [inviteOpen, setInviteOpen]     = useState(false);
  const [inviteError, setInviteError]   = useState<string | null>(null);
  const [isPendingInvite, startInvite]  = useTransition();
  const [isPendingRemove, startRemove]  = useTransition();
  const [isPendingRole,   startRole]    = useTransition();

  function handleInvite(input: { email: string; role: RoleInput }) {
    setInviteError(null);
    startInvite(async () => {
      const res = await inviteMember(workspace.id, input.email, input.role);
      if (!res.ok) {
        setInviteError(res.error);
        notifyActionError(res);
      } else {
        setInviteError(null);
        setInviteOpen(false);
      }
    });
  }

  function handleRemove(userId: string, email: string) {
    if (!window.confirm(
      `Remove ${email} from this workspace?\n\nThey will lose access to all projects and their workspace role assignments will be cleared.`,
    )) return;
    startRemove(async () => {
      const res = await removeMember(workspace.id, userId);
      if (!res.ok) notifyActionError(res);
    });
  }

  function handleRoleChange(userId: string, role: RoleInput) {
    startRole(async () => {
      const res = await updateMemberRole(workspace.id, userId, role);
      if (!res.ok) notifyActionError(res);
    });
  }

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
            {workspace.name} · Members
          </div>
          <h2 className="text-base font-semibold text-foreground">
            {`${members.length} member${members.length === 1 ? '' : 's'}`}
          </h2>
        </div>
        <Button size="sm" variant="primary" onClick={() => { setInviteError(null); setInviteOpen(true); }}>
          <UserPlus className="size-4" /> Invite
        </Button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        {members.length === 0 ? (
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
                  const role  = effectiveRoleInput(m.roleSlugs, m.isOwner);
                  const badge = roleBadgeVariant(role);
                  return (
                    <tr key={m.id} className="border-t border-border/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar className="size-8">
                            {m.avatarUrl
                              ? <AvatarImage src={m.avatarUrl} alt={m.name ?? m.email} className="size-8" />
                              : null}
                            <AvatarFallback className="text-xs font-medium">
                              {initials(m.name || m.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate">{m.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {m.isOwner ? (
                          <Badge size="sm" variant="outline" appearance="outline" className={`gap-1 ${badge.cls}`}>
                            <Shield className="size-3" /> {badge.label}
                          </Badge>
                        ) : (
                          <Select
                            value={role as RoleInput}
                            onValueChange={(v) => handleRoleChange(m.id, v as RoleInput)}
                            disabled={isPendingRole}
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
                        {m.joinedAt?.slice(0, 10) ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!m.isOwner && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemove(m.id, m.email)}
                            disabled={isPendingRemove}
                            aria-label={`Remove ${m.email}`}
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
        onClose={() => { setInviteOpen(false); setInviteError(null); }}
        onSubmit={handleInvite}
        isPending={isPendingInvite}
        error={inviteError}
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
                The user must already have an account. If they don&apos;t, ask them to register first.
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
