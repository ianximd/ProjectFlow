'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, KeyRound, Link2, Loader2, ShieldCheck, Trash2, Upload, UserCog,
} from 'lucide-react';

import { toast } from 'sonner';

import { notifyActionError } from '@/lib/apiErrorToast';
import { updateMyName, uploadMyAvatar, removeMyAvatar } from '@/server/actions/profile';
import { changePassword } from '@/server/actions/auth';
import type { MeProfile } from '@/server/queries/profile';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ── helpers ──────────────────────────────────────────────────────────────────

function initials(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

// Mirror of the API's avatar cap (apps/api …/avatars/avatar.routes.ts MAX_BYTES).
// Guarding here lets oversized files fail instantly with a clear message instead
// of bouncing off the Server Action body limit as an uncaught runtime error.
const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB

// ── ProfileView (root) ───────────────────────────────────────────────────────

export function ProfileView({ me }: { me: MeProfile }) {
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

      <div className="grid gap-4 md:grid-cols-2 max-w-5xl">
        <ProfileCard me={me} />
        <PasswordCard />
        <SecurityCard me={me} />
        <ConnectedAccountsCard />
      </div>
    </div>
  );
}

// ── Profile card (name + avatar) ──────────────────────────────────────────────

function ProfileCard({ me }: { me: MeProfile }) {
  const router = useRouter();
  const [avatarPending, startAvatar] = useTransition();
  const [namePending,   startName]   = useTransition();

  const [name, setName]           = useState(me.name);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-sync name field when the server refreshes the prop (revalidatePath).
  useEffect(() => { setName(me.name); }, [me.name]);

  const nameDirty = name.trim() !== me.name;

  // ── save name ──────────────────────────────────────────────────────────────
  function handleSaveName() {
    setSaveSuccess(false);
    startName(async () => {
      const res = await updateMyName(name.trim());
      if (!res.ok) {
        notifyActionError(res);
      } else {
        setSaveSuccess(true);
      }
    });
  }

  // ── avatar upload ──────────────────────────────────────────────────────────
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    // Reset immediately so picking the same file twice re-fires onChange.
    e.target.value = '';
    if (!f) return;
    setSaveSuccess(false);
    setAvatarErr(null);

    // Catch oversized files before they hit the network: the Server Action
    // body limit would otherwise reject the request as an uncaught throw and
    // crash the page with the Next.js error overlay.
    if (f.size > MAX_AVATAR_BYTES) {
      const msg = 'Image is too large — choose a file under 3 MB.';
      setAvatarErr(msg);
      toast.error('Avatar too large', { description: msg });
      return;
    }

    startAvatar(async () => {
      try {
        const formData = new FormData();
        formData.append('file', f);
        const res = await uploadMyAvatar(formData);
        if (!res.ok) {
          setAvatarErr(res.error);
          notifyActionError(res);
        } else {
          setAvatarErr(null);
          router.refresh();
        }
      } catch {
        // The Server Action threw before returning a result — e.g. the
        // framework body-size guard or a network failure. Surface it as a
        // toast instead of letting it bubble up as a runtime crash.
        const msg = 'Could not upload the image. Please try again.';
        setAvatarErr(msg);
        toast.error('Upload failed', { description: msg });
      }
    });
  }

  // ── avatar remove ──────────────────────────────────────────────────────────
  function handleRemoveAvatar() {
    setSaveSuccess(false);
    setAvatarErr(null);
    startAvatar(async () => {
      const res = await removeMyAvatar();
      if (!res.ok) {
        setAvatarErr(res.error);
        notifyActionError(res);
      } else {
        setAvatarErr(null);
        router.refresh();
      }
    });
  }

  const avatarBusy = avatarPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="size-4" /> Profile information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Avatar + identity row */}
        <div className="flex items-center gap-3">
          <Avatar className="size-14">
            {me.avatarUrl ? <AvatarImage src={me.avatarUrl} alt={me.name} /> : null}
            <AvatarFallback className="text-base font-medium">
              {initials(me.name || me.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{name}</div>
            <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
              {me.email}
              {me.isEmailVerified ? (
                <Badge variant="secondary" size="sm" className="gap-1">
                  <CheckCircle2 className="size-3" /> verified
                </Badge>
              ) : (
                <Badge variant="outline" size="sm">unverified</Badge>
              )}
            </div>
          </div>
        </div>

        {/* Avatar controls */}
        <div className="space-y-1.5">
          <Label>Avatar</Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            aria-label="Upload avatar"
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
              {avatarPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {me.avatarUrl ? 'Replace' : 'Upload'}
            </Button>
            {me.avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={avatarBusy}
                onClick={handleRemoveAvatar}
              >
                {avatarPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, GIF, or WebP — up to 3 MB.
          </p>
          {avatarErr && <p className="text-xs text-destructive">{avatarErr}</p>}
        </div>

        {/* Display name field */}
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Display name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaveSuccess(false); }}
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
            disabled={!nameDirty || !name.trim() || namePending}
            onClick={handleSaveName}
          >
            {namePending && <Loader2 className="size-3.5 animate-spin" />}
            Save changes
          </Button>
        </div>

        {saveSuccess && (
          <p className="text-xs text-emerald-500">Profile updated.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Password card ─────────────────────────────────────────────────────────────
// Change-password goes through the changePassword Server Action (Phase 3 Batch I).

function PasswordCard() {
  const [current,  setCurrent]  = useState('');
  const [next1,    setNext1]    = useState('');
  const [next2,    setNext2]    = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [success,  setSuccess]  = useState(false);
  const [isPending, startTransition] = useTransition();

  const mismatch = next1 && next2 && next1 !== next2;
  const tooShort = next1.length > 0 && next1.length < 8;

  function submit() {
    setLocalErr(null);
    setSuccess(false);
    if (!current)          return setLocalErr('Enter your current password.');
    if (next1.length < 8)  return setLocalErr('New password must be at least 8 characters.');
    if (next1 !== next2)   return setLocalErr('New password and confirmation do not match.');
    if (next1 === current) return setLocalErr('New password must differ from the current one.');
    startTransition(async () => {
      const res = await changePassword(current, next1);
      if (!res.ok) {
        setLocalErr(res.error ?? 'Something went wrong.');
        notifyActionError(res);
      } else {
        setCurrent(''); setNext1(''); setNext2('');
        setLocalErr(null);
        setSuccess(true);
      }
    });
  }

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
            disabled={isPending}
            onClick={submit}
          >
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Update password
          </Button>
        </div>

        {success && (
          <p className="text-xs text-emerald-500">Password updated.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Security card (MFA status) ────────────────────────────────────────────────

function SecurityCard({ me }: { me: MeProfile }) {
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
          {me.mfaEnabled ? (
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

// ── Connected accounts card ───────────────────────────────────────────────────

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
