'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { register as registerAction } from '@/server/actions/auth';
import { scorePassword } from '@/lib/password-strength';
import { Button } from '@/components/ui/button';
import { Input, InputWrapper } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertIcon } from '@/components/ui/alert';

// Provider name → display label + brand color. Mirrors the login page.
const PROVIDER_META: Record<string, { labelKey: string; bg: string }> = {
  google:    { labelKey: 'continueWithGoogle',    bg: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50' },
  github:    { labelKey: 'continueWithGitHub',    bg: 'bg-gray-900 text-white hover:bg-gray-800' },
  microsoft: { labelKey: 'continueWithMicrosoft', bg: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50' },
};

const STRENGTH_META: Record<string, { labelKey: string; bar: string }> = {
  weak:   { labelKey: 'strengthWeak',   bar: 'bg-destructive' },
  fair:   { labelKey: 'strengthFair',   bar: 'bg-amber-500' },
  good:   { labelKey: 'strengthGood',   bar: 'bg-blue-500' },
  strong: { labelKey: 'strengthStrong', bar: 'bg-emerald-500' },
};

export default function RegisterPage() {
  const t = useTranslations('Auth');
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [providers, setProviders] = useState<{ name: string }[]>([]);
  const [isPending, startTransition] = useTransition();

  // Configured-provider list (public endpoint; [] when no OAuth is wired).
  useEffect(() => {
    fetch('/api/v1/auth/oauth/providers')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setProviders(j.data ?? []))
      .catch(() => setProviders([]));
  }, []);

  const strength = useMemo(() => scorePassword(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirm === password &&
    !isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await registerAction(email, name, password);
      if (result.ok) {
        router.push('/login?registered=1');
      } else {
        setErrorMsg(result.error ?? t('registrationFailed'));
      }
    });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2 grow">
      {/* Form column */}
      <div className="flex justify-center items-center p-8 lg:p-10 order-2 lg:order-1 bg-background">
        <Card className="w-full max-w-[420px]">
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {t('createYourAccount')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('alreadyHaveAccount')}{' '}
                <Link href="/login" className="font-medium text-primary hover:underline">
                  {t('signIn')}
                </Link>
              </p>
            </div>

            {errorMsg && (
              <Alert variant="destructive">
                <AlertIcon>
                  <AlertCircle />
                </AlertIcon>
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            {providers.length > 0 && (
              <div className="space-y-3">
                {providers.map((p) => {
                  const meta = PROVIDER_META[p.name];
                  if (!meta) return null;
                  return (
                    <a
                      key={p.name}
                      href={`/api/v1/auth/oauth/${p.name}/start`}
                      className={`flex items-center justify-center w-full h-10 rounded-md text-sm font-medium transition-colors ${meta.bg}`}
                    >
                      {t(meta.labelKey)}
                    </a>
                  );
                })}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">{t('orDivider')}</span>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('fullNameLabel')}</Label>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  placeholder={t('fullNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">{t('emailLabel')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">{t('passwordLabel')}</Label>
                <InputWrapper>
                  <Input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t('hidePassword') : t('showPassword')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </InputWrapper>
                {password.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex gap-1" aria-hidden="true">
                      {[1, 2, 3, 4].map((seg) => (
                        <div
                          key={seg}
                          className={`h-1 flex-1 rounded-full ${
                            seg <= strength.score ? STRENGTH_META[strength.level].bar : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('passwordStrengthLabel')}: {t(STRENGTH_META[strength.level].labelKey)}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">{t('confirmPasswordLabel')}</Label>
                <InputWrapper>
                  <Input
                    id="confirm"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={t('confirmPasswordPlaceholder')}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    aria-invalid={mismatch}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? t('hidePassword') : t('showPassword')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </InputWrapper>
                {mismatch && <p className="text-xs text-destructive">{t('passwordsDoNotMatch')}</p>}
              </div>

              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? t('creatingAccount') : t('signUp')}
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground">{t('termsNotice')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Brand column */}
      <div className="relative hidden lg:flex lg:order-2 overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        <div className="absolute -top-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-24 w-[24rem] h-[24rem] rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-foreground/15 backdrop-blur font-bold" aria-hidden="true">
              PF
            </div>
            <span className="text-lg font-semibold">ProjectFlow</span>
          </Link>

          <div className="space-y-5 max-w-md">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/10 px-3 py-1 text-xs font-medium backdrop-blur">
              <ShieldCheck className="size-3.5" />
              {t('secureAccess')}
            </div>
            <h2 className="text-3xl xl:text-4xl font-semibold leading-tight tracking-tight">
              {t('heroTagline')}
            </h2>
            <p className="text-base text-primary-foreground/80">{t('heroSubtitle')}</p>
          </div>

          <div className="text-xs text-primary-foreground/60">© {new Date().getFullYear()} ProjectFlow</div>
        </div>
      </div>
    </div>
  );
}
