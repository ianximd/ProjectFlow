import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
import { WorkflowService } from '../../workflows/workflow.service.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';

// The engine Board sources its columns from the scope's EFFECTIVE WORKFLOW (parity
// with the legacy board). A scope's project is the first segment of its
// materialized path, and a space IS a project here, so SPACE → that project's
// workflow; EVERYTHING (spans projects) and a workflow-less project → null
// (the Board then derives columns from the task set).
describe('ViewService.effectiveWorkflowStatuses', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('resolves a SPACE scope to its project workflow statuses', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    await new WorkflowService().create(p.Id, 'WF'); // DEFAULT template seeds statuses

    const statuses = await viewService.effectiveWorkflowStatuses('SPACE', p.Id, ws.Id);
    expect(statuses).not.toBeNull();
    expect(statuses!.length).toBeGreaterThan(0);
    expect(statuses![0]).toMatchObject({
      name: expect.any(String), category: expect.any(String), position: expect.any(Number),
    });
  });

  it('returns null for EVERYTHING scope (spans projects → no single workflow)', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    expect(await viewService.effectiveWorkflowStatuses('EVERYTHING', null, ws.Id)).toBeNull();
  });

  it('returns null for a SPACE whose project has no workflow', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    expect(await viewService.effectiveWorkflowStatuses('SPACE', p.Id, ws.Id)).toBeNull();
  });
});
