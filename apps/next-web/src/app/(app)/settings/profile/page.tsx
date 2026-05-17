'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, KeyRound, Link2, Loader2, ShieldCheck, Trash2, Upload, UserCog,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ── api helper ──────────────────────────────────────────────────────────────

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    notifyApiError(json, res.status);
    throw new Error((json as any)?.error?.message ?? `Request failed (${res.status})`);
  }
  return json;
}

interface MeUser {
  id?:              string;
  Id?:              string;
  email?:           string;
  Email?:           string;
  name?:            string;
  Name?:            string;
  avatarUrl?:       string | null;
  AvatarUrl?:       string | null;
  isEmailVerified?: boolean;
  IsEmailVerified?: boolean | number;
  mfaEnabled?:      boolean;
  MfaEnabled?:      boolean | number;
}

const get = <T,>(o: any, pascal: string, camel: string): T | undefined =>
  o?.[pascal] ?? o?.[camel];

function initials(s: string): string {
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProfileSettingsPage() {
  const token = useStore((s) => s.accessToken);
  const setAuth = useStore((s) => s.setAuth);
  const qc = useQueryClient();

  const { data: me, isLoading } = useQuery<MeUser>({
    queryKey: ['auth', 'me'],
    queryFn:  () => api('/auth/me', token).then((j) => j.data),
  });

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <UserCog className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Settings</div>
          <h2 className="text-base font-semibold text-foreground truncate">My Profile</h2>
        </div>
      </div>

      {isLoading || !me ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading profile…
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 max-w-5xl">
          <ProfileCard
            me={me}
            token={token}
            onUpdated={(updated) => {
              qc.setQueryData(['auth', 'me'], updated);
              if (token) setAuth(token, updated);
            }}
          />
          <PasswordCard token={token} />
          <SecurityCard me={me} />
          <ConnectedAccountsCard />
        </div>
      )}
    </div>
  );
}

// ── Profile (name + avatar) ──────────────────────────────────────────────────

function ProfileCard({
  me, token, onUpdated,
}: {
  me:        MeUser;
  token:     string | null;
  onUpdated: (updated: MeUser) => void;
}) {
  const email     = get<string>(me, 'Email', 'email') ?? '';
  const startName = get<string>(me, 'Name', 'name') ?? '';
  const avatarUrl = get<string | null>(me, 'AvatarUrl', 'avatarUrl') ?? '';
  const verified  = !!get<boolean | number>(me, 'IsEmailVerified', 'isEmailVerified');

  const [name, setName] = useState(startName);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-sync the name field if a different user payload arrives (e.g. cache
  // refresh). Avatar isn't tracked locally — it lives on `me` directly so the
  // upload/remove mutations swap it in atomically.
  useEffect(() => { setName(startName); }, [startName]);

  const nameDirty = name.trim() !== startName;

  // Save button: name only. Avatar has its own mutations because each upload
  // also has to clean up the previous MinIO object server-side.
  const updateMut = useMutation({
    mutationFn: () =>
      api('/auth/me', token, {
        method: 'PATCH',
        body:   JSON.stringify({ name: name.trim() }),
      }),
    onSuccess: (json) => onUpdated(json.data),
  });

  // Avatar upload: multipart POST to /avatars/me. Server uploads to MinIO,
  // updates the user row, and returns the refreshed user — we hand it
  // straight to onUpdated so the avatar swaps in immediately.
  const uploadAvatarMut = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/v1/avatars/me', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        notifyApiError(json, res.status);
        throw new Error((json as any)?.error?.message ?? `Upload failed (${res.status})`);
      }
      return json;
    },
    onSuccess: (json) => { setAvatarErr(null); onUpdated(json.data); },
    onError:   (err: Error) => setAvatarErr(err.message),
  });

  const removeAvatarMut = useMutation({
    mutationFn: () => api('/avatars/me', token, { method: 'DELETE' }),
    onSuccess: (json) => { setAvatarErr(null); onUpdated(json.data); },
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Reset so picking the same file twice still fires onChange.
    e.target.value = '';
    if (!f) return;
    setAvatarErr(null);
    uploadAvatarMut.mutate(f);
  };

  const avatarBusy = uploadAvatarMut.isPending || removeAvatarMut.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="size-4" /> Profile information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-14">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
            <AvatarFallback className="text-base font-medium">
              {initials(name || email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{name}</div>
            <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
              {email}
              {verified ? (
                <Badge variant="secondary" size="sm" className="gap-1">
                  <CheckCircle2 className="size-3" /> verified
                </Badge>
              ) : (
                <Badge variant="outline" size="sm">unverified</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Avatar</Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={onPickFile}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={avatarBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadAvatarMut.isPending
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Upload className="size-3.5" />}
              {avatarUrl ? 'Replace' : 'Upload'}
            </Button>
            {avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={avatarBusy}
                onClick={() => removeAvatarMut.mutate()}
              >
                {removeAvatarMut.isPending
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <Trash2 className="size-3.5" />}
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, GIF, or WebP — up to 3 MB.
          </p>
          {avatarErr && <p className="text-xs text-destructive">{avatarErr}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Display name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            maxLength={255}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Email cannot be changed here yet.
          </p>
          <Button
            type="button"
            disabled={!nameDirty || !name.trim() || updateMut.isPending}
            onClick={() => updateMut.mutate()}
          >
            {updateMut.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save changes
          </Button>
        </div>

        {updateMut.isSuccess && (
          <p className="text-xs text-emerald-500">Profile updated.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Password change ──────────────────────────────────────────────────────────

function PasswordCard({ token }: { token: string | null }) {
  const [current, setCurrent] = useState('');
  const [next1,   setNext1]   = useState('');
  const [next2,   setNext2]   = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);

  const mismatch = next1 && next2 && next1 !== next2;
  const tooShort = next1.length > 0 && next1.length < 8;

  const mut = useMutation({
    mutationFn: () =>
      api('/auth/change-password', token, {
        method: 'POST',
        body:   JSON.stringify({ currentPassword: current, newPassword: next1 }),
      }),
    onSuccess: () => {
      setCurrent(''); setNext1(''); setNext2(''); setLocalErr(null);
    },
  });

  const submit = () => {
    setLocalErr(null);
    if (!current)            return setLocalErr('Enter your current password.');
    if (next1.length < 8)    return setLocalErr('New password must be at least 8 characters.');
    if (next1 !== next2)     return setLocalErr('New password and confirmation do not match.');
    if (next1 === current)   return setLocalErr('New password must differ from the current one.');
    mut.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" /> Change password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">Current password</Label>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-next1">New password</Label>
          <Input
            id="pw-next1"
            type="password"
            autoComplete="new-password"
            value={next1}
            onChange={(e) => setNext1(e.target.value)}
          />
          {tooShort && (
            <p className="text-xs text-destructive">Must be at least 8 characters.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-next2">Confirm new password</Label>
          <Input
            id="pw-next2"
            type="password"
            autoComplete="new-password"
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
          />
          {mismatch && (
            <p className="text-xs text-destructive">Passwords don&apos;t match.</p>
          )}
        </div>

        {localErr && <p className="text-xs text-destructive">{localErr}</p>}

        <div className="flex items-center justify-end">
          <Button
            type="button"
            disabled={mut.isPending}
            onClick={submit}
          >
            {mut.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Update password
          </Button>
        </div>

        {mut.isSuccess && (
          <p className="text-xs text-emerald-500">Password updated.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Security (MFA status — link only for now) ────────────────────────────────

function SecurityCard({ me }: { me: MeUser }) {
  const mfaOn = !!get<boolean | number>(me, 'MfaEnabled', 'mfaEnabled');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4" /> Two-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span>Status</span>
          {mfaOn ? (
            <Badge variant="secondary" size="sm" className="gap-1">
              <CheckCircle2 className="size-3" /> Enabled
            </Badge>
          ) : (
            <Badge variant="outline" size="sm">Disabled</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Manage MFA from the API endpoints (<code className="font-mono">POST /auth/mfa/setup</code>,
          <code className="font-mono"> POST /auth/mfa/verify-setup</code>,
          <code className="font-mono"> POST /auth/mfa/disable</code>). UI controls are coming.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Connected accounts (link out) ────────────────────────────────────────────

function ConnectedAccountsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" /> Connected accounts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Link or unlink Google, GitHub, and other OAuth providers.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/connected-accounts">Manage providers</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
