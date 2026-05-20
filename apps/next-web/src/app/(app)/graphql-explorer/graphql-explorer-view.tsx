'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Braces, Play, Copy, Check, AlertTriangle, CheckCircle2, ExternalLink,
  KeyRound, RotateCcw,
} from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { runGraphql } from '@/server/actions/graphql';

// ── Sample operations ───────────────────────────────────────────────────────

const EXAMPLES: Array<{
  name: string; query: string; variables: string;
}> = [
  {
    name: 'Me',
    query: `query Me {
  me {
    id
    name
    email
    avatarUrl
    isEmailVerified
  }
}`,
    variables: '{}',
  },
  {
    name: 'Projects',
    query: `query Projects($workspaceId: String!) {
  projects(workspaceId: $workspaceId) {
    id
    name
    key
    type
    status
    createdAt
  }
}`,
    variables: `{
  "workspaceId": "<workspace-uuid>"
}`,
  },
  {
    name: 'Tasks',
    query: `query Tasks($projectId: String!) {
  tasks(projectId: $projectId, pageSize: 10) {
    id
    issueKey
    title
    status
    priority
    storyPoints
    createdAt
  }
}`,
    variables: `{
  "projectId": "<project-uuid>"
}`,
  },
  {
    name: 'Create task',
    query: `mutation CreateTask($input: CreateTaskInput!) {
  createTask(input: $input) {
    id
    issueKey
    title
    status
  }
}`,
    variables: `{
  "input": {
    "workspaceId": "<workspace-uuid>",
    "projectId":   "<project-uuid>",
    "title":       "Example issue",
    "priority":    "MEDIUM"
  }
}`,
  },
  {
    name: 'Transition task',
    query: `mutation TransitionTask($id: String!, $status: String!) {
  transitionTask(id: $id, status: $status) {
    id
    issueKey
    status
    updatedAt
  }
}`,
    variables: `{
  "id":     "<task-uuid>",
  "status": "In Progress"
}`,
  },
  {
    name: 'Task subscription (SSE)',
    query: `subscription TaskUpdated($projectId: String!) {
  taskUpdated(projectId: $projectId) {
    id
    issueKey
    title
    status
    updatedAt
  }
}`,
    variables: `{
  "projectId": "<project-uuid>"
}`,
  },
];

// Live reference (rendered in the side panel)
const SCHEMA_DOCS = [
  {
    group: 'Queries',
    items: [
      { sig: 'me',                                                        desc: 'Authenticated user' },
      { sig: 'workspaces',                                                desc: 'All workspaces the caller belongs to' },
      { sig: 'workspace(id)',                                             desc: 'Single workspace by id' },
      { sig: 'projects(workspaceId)',                                     desc: 'Projects in a workspace' },
      { sig: 'project(id)',                                               desc: 'Single project by id' },
      { sig: 'sprints(projectId)',                                        desc: 'Sprints in a project' },
      { sig: 'tasks(projectId, status?, sprintId?, page?, pageSize?)',    desc: 'Filtered task list' },
      { sig: 'task(id)',                                                  desc: 'Single task by id' },
      { sig: 'comments(taskId)',                                          desc: 'Comments on a task' },
      { sig: 'notifications(page?, pageSize?, unreadOnly?)',              desc: "Caller's notifications" },
    ],
  },
  {
    group: 'Mutations',
    items: [
      { sig: 'createTask(input)',                desc: 'Create a new task' },
      { sig: 'updateTask(id, input)',            desc: 'Patch task fields' },
      { sig: 'transitionTask(id, status)',       desc: 'Move a task through the workflow' },
      { sig: 'deleteTask(id)',                   desc: 'Soft-delete a task' },
      { sig: 'createComment(taskId, body)',      desc: 'Add a comment' },
      { sig: 'markNotificationRead(id)',         desc: 'Mark one notification read' },
      { sig: 'markAllNotificationsRead',         desc: 'Bulk mark-as-read' },
    ],
  },
  {
    group: 'Subscriptions (SSE)',
    items: [
      { sig: 'taskUpdated(projectId)', desc: 'Streamed when any task in the project updates' },
      { sig: 'commentAdded(taskId)',   desc: 'Streamed when a comment is added' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────

const API_PATH = '/api/v1/graphql';

export function GraphqlExplorerView() {
  // Operation editor state
  const [query, setQuery]         = useState(EXAMPLES[0]!.query);
  const [variables, setVariables] = useState(EXAMPLES[0]!.variables);
  const [activeExample, setActiveExample] = useState(EXAMPLES[0]!.name);

  // Token: default path uses the server cookie (no client-side token).
  // The override allows a user to paste a custom JWT for testing.
  const [overrideToken, setOverrideToken] = useState(false);
  const [tokenOverride, setTokenOverride] = useState('');

  // Run result
  const [result,     setResult]     = useState<string>('');
  const [error,      setError]      = useState<string>('');
  const [lastStatus, setLastStatus] = useState<{ ok: boolean; statusCode: number; ms: number } | null>(null);
  const [isPending,  startTransition] = useTransition();

  // The full URL (with origin) so the user can copy a curl-able value.
  const [apiUrl, setApiUrl] = useState(API_PATH);
  useEffect(() => {
    setApiUrl(`${window.location.origin}${API_PATH}`);
  }, []);

  // ── Run ────────────────────────────────────────────────────────────────────
  const run = () => {
    setError(''); setResult(''); setLastStatus(null);
    let vars: Record<string, unknown> = {};
    try {
      vars = variables.trim() ? JSON.parse(variables) : {};
    } catch {
      setError('Variables are not valid JSON.');
      return;
    }
    startTransition(async () => {
      try {
        const { status, ms, body } = await runGraphql(
          query,
          vars,
          overrideToken && tokenOverride ? tokenOverride : undefined,
        );
        const json = body as Record<string, unknown>;
        setResult(JSON.stringify(json, null, 2));
        const hasErrors = Array.isArray(json?.errors) && (json.errors as unknown[]).length > 0;
        setLastStatus({ ok: status >= 200 && status < 300 && !hasErrors, statusCode: status, ms });
        if (hasErrors) {
          const firstMsg = (json.errors as Array<{ message?: string }>)[0]?.message;
          if (firstMsg) setError(firstMsg);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
      }
    });
  };

  // ── Cmd/Ctrl + Enter shortcut ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, variables, overrideToken, tokenOverride]);

  const pickExample = (name: string) => {
    const ex = EXAMPLES.find((x) => x.name === name);
    if (!ex) return;
    setActiveExample(name);
    setQuery(ex.query);
    setVariables(ex.variables);
    setResult(''); setError(''); setLastStatus(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Braces className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">System</div>
            <h2 className="text-base font-semibold text-foreground truncate">GraphQL API Explorer</h2>
          </div>
        </div>

        <a
          href={API_PATH}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Open built-in playground <ExternalLink className="size-3" />
        </a>
      </div>

      {/* ── Endpoint + auth row ────────────────────────────────────────────── */}
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
            <CopyField value={apiUrl} />
          </div>

          <div className="flex flex-col gap-1.5 md:w-[260px]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1">
                <KeyRound className="size-3.5" /> Authorization
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <Switch
                  size="sm"
                  checked={overrideToken}
                  onCheckedChange={(v) => setOverrideToken(!!v)}
                />
                Custom token
              </label>
            </div>
            {overrideToken ? (
              <Input
                type="password"
                placeholder="Paste a JWT…"
                value={tokenOverride}
                onChange={(e) => setTokenOverride(e.target.value)}
                className="h-8 text-xs font-mono"
                autoComplete="off"
              />
            ) : (
              /* The session token is no longer available client-side (httpOnly cookie).
                 We show a neutral indicator confirming the server cookie will be used. */
              <div className="rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground inline-flex items-center gap-1.5 h-8">
                <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                Using your session token
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Example chips ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">Examples:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.name}
            onClick={() => pickExample(ex.name)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
              activeExample === ex.name
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-foreground hover:bg-muted/40',
            )}
          >
            {ex.name}
          </button>
        ))}
        <Button
          size="sm" variant="ghost" className="h-7 px-2 text-xs ml-1"
          onClick={() => {
            const ex = EXAMPLES.find((x) => x.name === activeExample);
            if (ex) { setQuery(ex.query); setVariables(ex.variables); }
          }}
          aria-label="Reset to example"
        >
          <RotateCcw className="size-3" /> Reset
        </Button>
      </div>

      {/* ── Body: editors + schema sidebar ─────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-3 flex-1 min-h-0">
        {/* Editors + result */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <EditorPane title="Query / Mutation" value={query} onChange={setQuery} />
            <EditorPane title="Variables (JSON)" value={variables} onChange={setVariables} />
          </div>

          {/* Run + status */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={run} variant="primary" disabled={isPending}>
              <Play className="size-4" />
              {isPending ? 'Running…' : 'Run'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Tip: <kbd className="font-mono text-[10px] rounded border border-border bg-muted px-1 py-0.5">⌘/Ctrl + Enter</kbd>
            </span>

            {lastStatus && (
              <Badge
                size="sm"
                variant="outline"
                appearance="outline"
                className={cn(
                  'gap-1',
                  lastStatus.ok
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                    : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-900',
                )}
              >
                {lastStatus.ok
                  ? <CheckCircle2 className="size-3" />
                  : <AlertTriangle className="size-3" />}
                HTTP {lastStatus.statusCode} · {lastStatus.ms}ms
              </Badge>
            )}

            {error && (
              <span className="text-xs text-destructive inline-flex items-center gap-1">
                <AlertTriangle className="size-3.5" /> {error}
              </span>
            )}
          </div>

          {/* Response */}
          <Card className="p-0 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
              <Braces className="size-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Response</h3>
              <CopyButton value={result} disabled={!result} className="ml-auto" />
            </div>
            <pre
              className="text-xs font-mono whitespace-pre-wrap p-3 overflow-auto bg-muted/20 min-h-[180px] max-h-[420px]"
              aria-label="GraphQL response"
            >
              {result || <span className="text-muted-foreground italic">Run a query to see the response here.</span>}
            </pre>
          </Card>
        </div>

        {/* Schema sidebar */}
        <Card className="p-0 overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-border/60">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schema reference</h3>
          </div>
          <div className="p-3 overflow-y-auto flex flex-col gap-4 text-xs">
            {SCHEMA_DOCS.map((group) => (
              <div key={group.group} className="flex flex-col gap-1.5">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                  {group.group}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {group.items.map((it) => (
                    <li key={it.sig}>
                      <code className="block font-mono text-xs text-foreground bg-muted/50 px-2 py-1 rounded">
                        {it.sig}
                      </code>
                      <span className="text-xs text-muted-foreground block mt-0.5">{it.desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor pane (textarea with a header bar)
// ─────────────────────────────────────────────────────────────────────────────

function EditorPane({
  title, value, onChange,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Card className="p-0 overflow-hidden flex flex-col min-h-[260px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <CopyButton value={value} className="ml-auto" />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-[200px] resize-none p-3 text-xs font-mono bg-card text-foreground focus:outline-none placeholder:text-muted-foreground"
        aria-label={title}
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy-to-clipboard helpers
// ─────────────────────────────────────────────────────────────────────────────

function CopyButton({
  value, disabled, className,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked in insecure contexts — let the user
      // select manually rather than dropping a UI alert.
    }
  };
  return (
    <Button
      type="button" size="sm" variant="ghost"
      className={cn('h-7 px-2 text-xs', className)}
      onClick={copy}
      disabled={disabled || !value}
      aria-label="Copy to clipboard"
    >
      {copied
        ? <Check className="size-3.5 text-emerald-500" />
        : <Copy  className="size-3.5" />}
    </Button>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* silently fall through */ }
  };
  return (
    <div className="flex items-stretch gap-0 rounded-md border border-input bg-background overflow-hidden">
      <input
        readOnly value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 px-3 py-1.5 text-xs font-mono bg-transparent focus:outline-none"
        aria-label="API endpoint URL"
      />
      <Button
        type="button" variant="ghost" size="sm"
        className="rounded-none border-l border-input shrink-0"
        onClick={copy}
        aria-label="Copy endpoint"
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}
