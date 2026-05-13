'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertIcon } from '@/components/ui/alert';

// Provider name → display label + brand color. Adding a 4th provider
// is one row per provider here.
const PROVIDER_META: Record<string, { label: string; bg: string }> = {
  google:    { label: 'Continue with Google',    bg: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50' },
  github:    { label: 'Continue with GitHub',    bg: 'bg-gray-900 text-white hover:bg-gray-800' },
  microsoft: { label: 'Continue with Microsoft', bg: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50' },
};

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [providers, setProviders] = useState<{ name: string }[]>([]);

  // Fetch the configured-provider list on mount. The endpoint is public
  // and returns [] when no OAuth credentials are wired — in which case we
  // simply render no social-sign-in section.
  useEffect(() => {
    fetch('/api/v1/auth/oauth/providers')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setProviders(j.data ?? []))
      .catch(() => setProviders([]));
  }, []);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Login failed');
      return data.data;
    },
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      router.push('/board');
    },
    onError: (error: Error) => {
      setErrorMsg(error.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    loginMutation.mutate();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2 grow">
      {/* Form column */}
      <div className="flex justify-center items-center p-8 lg:p-10 order-2 lg:order-1 bg-background">
        <Card className="w-full max-w-[420px]">
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Sign in to ProjectFlow
              </h1>
              <p className="text-sm text-muted-foreground">
                Don&apos;t have an account?{' '}
                <Link
                  href="/register"
                  className="font-medium text-primary hover:underline"
                >
                  Create one
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
                    // Top-level navigation (not fetch) so the browser
                    // follows the 302 redirect chain and ends up on the
                    // provider's consent page.
                    <a
                      key={p.name}
                      href={`/api/v1/auth/oauth/${p.name}/start`}
                      className={`flex items-center justify-center w-full h-10 rounded-md text-sm font-medium transition-colors ${meta.bg}`}
                    >
                      {meta.label}
                    </a>
                  );
                })}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or</span>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="#"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground">
              By continuing you agree to our Terms and Privacy Policy.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Brand column */}
      <div className="relative hidden lg:flex lg:order-2 overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        {/* Decorative blurred shapes */}
        <div
          className="absolute -top-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-white/10 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-32 -left-24 w-[24rem] h-[24rem] rounded-full bg-white/10 blur-3xl"
          aria-hidden="true"
        />
        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <Link href="/" className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-foreground/15 backdrop-blur font-bold"
              aria-hidden="true"
            >
              PF
            </div>
            <span className="text-lg font-semibold">ProjectFlow</span>
          </Link>

          <div className="space-y-5 max-w-md">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/10 px-3 py-1 text-xs font-medium backdrop-blur">
              <ShieldCheck className="size-3.5" />
              Secure dashboard access
            </div>
            <h2 className="text-3xl xl:text-4xl font-semibold leading-tight tracking-tight">
              Modern project management for engineering teams.
            </h2>
            <p className="text-base text-primary-foreground/80">
              Plan sprints, run boards, and ship faster — all in one place.
            </p>
          </div>

          <div className="text-xs text-primary-foreground/60">
            © {new Date().getFullYear()} ProjectFlow
          </div>
        </div>
      </div>
    </div>
  );
}
