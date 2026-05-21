import { Suspense } from 'react';
import { ShieldAlert } from 'lucide-react';
import { requireSession } from '@/server/session';
import { getAdminStats, getAdminUsers, getAdminWorkspaces, getAuditLog, hasAdminAccess } from '@/server/queries/admin';
import { AdminView } from './admin-view';
import AdminLoading from './loading';

type Tab = 'stats' | 'users' | 'workspaces' | 'audit' | 'roles';

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
  resource?: string;
  action?: string;
  from?: string;
  to?: string;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();

  // The Admin nav link is shown app-wide, so a non-admin can land here. Render a
  // clean "not authorized" panel instead of letting the admin.* data fetches
  // below throw ApiError(403) up to the error boundary ("A server error occurred").
  if (!(await hasAdminAccess())) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-muted p-3 text-muted-foreground">
          <ShieldAlert className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Admin access required</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          You don&apos;t have permission to view the admin area. Ask a workspace
          owner or super-admin to grant you an admin role.
        </p>
      </div>
    );
  }

  const sp  = await searchParams;

  const VALID_TABS = ['stats', 'users', 'workspaces', 'audit', 'roles'] as const;
  const tab: Tab = (VALID_TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'stats';

  const rawPage = parseInt(sp.page ?? '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  // Fetch only the active tab's data.
  let statsData      = null;
  let usersData      = null;
  let workspacesData = null;
  let auditData      = null;

  switch (tab) {
    case 'stats':
      statsData = await getAdminStats();
      break;
    case 'users':
      usersData = await getAdminUsers({ search: sp.q, page });
      break;
    case 'workspaces':
      workspacesData = await getAdminWorkspaces({ page });
      break;
    case 'audit':
      auditData = await getAuditLog({
        resource: sp.resource,
        action:   sp.action,
        fromDate: sp.from,
        toDate:   sp.to,
        page,
      });
      break;
    case 'roles':
    default:
      break;
  }

  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminView
        activeTab={tab}
        statsData={statsData}
        usersData={usersData}
        workspacesData={workspacesData}
        auditData={auditData}
        currentPage={page}
        currentSearch={sp.q ?? ''}
        currentResource={sp.resource ?? ''}
        currentAction={sp.action ?? ''}
        currentFrom={sp.from ?? ''}
        currentTo={sp.to ?? ''}
      />
    </Suspense>
  );
}
