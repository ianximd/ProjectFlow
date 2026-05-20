'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { bootstrapWorkspace } from '@/server/actions/setup';

export function SetupView() {
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
          <CardTitle>Welcome to ProjectFlow!</CardTitle>
          <CardDescription>
            Let&apos;s set up your first Workspace and Project to get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMsg && (
            <div className="mb-4 rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workspace-name">Workspace Name</Label>
              <Input
                id="workspace-name"
                type="text"
                required
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="e.g. Acme Corp"
                disabled={isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                type="text"
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Website Redesign"
                disabled={isPending}
              />
            </div>
            <Button type="submit" variant="primary" disabled={isPending} className="mt-2">
              {isPending ? 'Setting up...' : 'Create and Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
