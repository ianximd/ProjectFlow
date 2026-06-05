'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { bootstrapWorkspace } from '@/server/actions/setup';

export function SetupView() {
  const t = useTranslations('Setup');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [workspaceName, setWorkspaceName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    startTransition(async () => {
      const res = await bootstrapWorkspace({ workspaceName, projectName });
      if (res.ok) {
        router.push('/board');
      } else {
        setErrorMsg(res.error);
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('welcomeTitle')}</CardTitle>
          <CardDescription>
            {t('welcomeDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMsg && (
            <div role="alert" className="mb-4 rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workspace-name">{t('workspaceNameLabel')}</Label>
              <Input
                id="workspace-name"
                type="text"
                required
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder={t('workspaceNamePlaceholder')}
                disabled={isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">{t('projectNameLabel')}</Label>
              <Input
                id="project-name"
                type="text"
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={t('projectNamePlaceholder')}
                disabled={isPending}
              />
            </div>
            <Button type="submit" variant="primary" disabled={isPending} className="mt-2">
              {isPending ? t('submitting') : t('submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
