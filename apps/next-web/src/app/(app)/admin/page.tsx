import { Suspense } from 'react';
import { requireSession } from '@/server/session';
import { getAdminStats } from '@/server/queries/admin';
import { getAdminUsers } from '@/server/queries/admin';
import { getAdminWorkspaces } from '@/server/queries/admin';
import { getAuditLog } from '@/server/queries/admin';
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

  const sp  = await searchParams;
  const tab = (sp.tab ?? 'stats') as Tab;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

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
