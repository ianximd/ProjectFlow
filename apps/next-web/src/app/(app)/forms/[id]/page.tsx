import { notFound } from 'next/navigation';
import { getForm } from '@/server/actions/forms';
import { listTemplates } from '@/server/actions/templates';
import { getWorkspaceProjectContext } from '@/server/context';
import { getLists } from '@/server/queries/hierarchy';
import { FormBuilder } from '@/components/forms/FormBuilder';

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { activeWorkspaceId, projects } = await getWorkspaceProjectContext();
  if (!activeWorkspaceId) notFound();

  // No workspace-wide list loader exists — getLists is space-scoped, so flatten
  // the workspace's projects' lists into one picker set.
  const listsNested = await Promise.all((projects ?? []).map((p) => getLists(p.id)));
  const lists = listsNested.flat().map((l) => ({ id: l.id, name: l.name }));
  const templates = await listTemplates('LIST');
  const templateOptions = templates.map((tpl) => ({ id: tpl.id, name: tpl.name }));

  if (id === 'new') {
    const scopeId = lists[0]?.id ?? activeWorkspaceId;
    return (
      <main style={{ padding: 24 }}>
        <FormBuilder
          workspaceId={activeWorkspaceId}
          scopeType="LIST"
          scopeId={scopeId}
          lists={lists}
          templates={templateOptions}
        />
      </main>
    );
  }

  const form = await getForm(id);
  if (!form) notFound();
  return (
    <main style={{ padding: 24 }}>
      <FormBuilder
        workspaceId={form.workspaceId}
        scopeType={form.scopeType}
        scopeId={form.scopeId}
        lists={lists}
        templates={templateOptions}
        initial={form}
      />
    </main>
  );
}
