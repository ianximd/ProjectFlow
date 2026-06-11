/**
 * Phase 7c — Forms integration coverage.
 * Exercises the form SPs + REST surface (incl. the unauthenticated public
 * render/submit pair) against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 *
 * Modelled on: apps/api/src/modules/whiteboards/__tests__/whiteboard.integration.test.ts
 * and:          apps/api/src/modules/customfields/__tests__/customfield-values.integration.test.ts
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// ─── Shared config builders ──────────────────────────────────────────────────

/** Form config with 4 fields and one branching rule:
 *   - summary  (short_text, required)
 *   - kind     (select, required, options bug/idea)
 *   - steps    (long_text, required — but HIDDEN unless kind === 'bug')
 *   - votes    (number, optional)
 * Branching: steps only SHOWS when kind equals 'bug', so when kind=idea the
 * required steps field is invisible → not enforced by validateAnswers.
 */
function configBugIdea() {
  return {
    fields: [
      { key: 'summary', label: 'Summary',            type: 'short_text', required: true  },
      { key: 'kind',    label: 'Kind',               type: 'select',     required: true, options: ['bug', 'idea'] },
      { key: 'steps',   label: 'Steps to reproduce', type: 'long_text',  required: true  },
      { key: 'votes',   label: 'Votes',              type: 'number',     required: false },
    ],
    branching: [
      // steps is only shown when kind === 'bug'
      { fieldKey: 'steps', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'bug' } },
    ],
  };
}

// ─── Seed helper ─────────────────────────────────────────────────────────────

/**
 * Register a user, create a workspace + space (project) + list, create a
 * LIST-scoped numeric custom field named 'Votes', and return all the handles
 * needed for the three test cases.
 *
 * Custom field: POST /custom-fields with scopeType=LIST, type=number, name='Votes'
 * List:         POST /lists with { workspaceId, spaceId, folderId:null, name, position:0 }
 * Response envelope for both: { data: { id, ... } }   (camelCase, from rowToXxx mappers)
 */
async function seedListAndField(tag: string) {
  const stamp = `${Date.now()}-${tag}`;
  const owner = await createTestUser({ email: `forms-${stamp}@projectflow.test` });
  const token = owner.accessToken;
  const ws    = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, {
    name: `Forms Space ${tag}`,
    key:  `FRM${stamp.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`,
  });

  // Create a list inside the space.
  const listRes = await request('/lists', {
    method: 'POST',
    token,
    json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Forms List', position: 0 },
  });
  const list   = (await json<{ data: any }>(listRes, 201)).data;
  const listId = list.id ?? list.Id;

  // Create a LIST-scoped numeric custom field for the votes mapping test.
  const cfRes = await request('/custom-fields', {
    method: 'POST',
    token,
    json: { scopeType: 'LIST', scopeId: listId, type: 'number', name: 'Votes' },
  });
  const field   = (await json<{ data: any }>(cfRes, 201)).data;
  const fieldId = field.id ?? field.Id;

  return { token, userId: owner.user.Id, ws, space, listId, fieldId };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('forms', () => {

  // ── 1. Public submit creates a task + records a submission ─────────────────

  it('public submit creates a task in the target list with mapped fields + records a submission', async () => {
    const { token, ws, space, listId, fieldId } = await seedListAndField('t1');
    const slug = `test-form-${Date.now()}-t1`;

    // ── Create the form ──────────────────────────────────────────────────────
    const createRes = await request('/forms', {
      method: 'POST',
      token,
      json: {
        workspaceId:  ws.Id,
        scopeType:    'LIST',
        scopeId:      listId,
        name:         'Bug/Idea Form',
        config:       configBugIdea(),
        targetListId: listId,
        fieldMapping: {
          summary: { kind: 'task',         target: 'title'   },
          votes:   { kind: 'custom_field', target: fieldId   },
        },
        isPublic:     true,
        publicSlug:   slug,
        authRequired: false,
      },
    });
    const form = (await json<{ data: any }>(createRes, 201)).data;
    // publicSlug must be echoed back.
    expect(form.publicSlug ?? form.PublicSlug).toBe(slug);

    // ── Public render (NO auth) — must return a readToken ────────────────────
    const renderRes = await request(`/forms/public/${slug}`);
    const renderBody = (await json<{ data: any }>(renderRes, 200)).data;
    const readToken: string = renderBody.readToken ?? renderBody.ReadToken;
    expect(typeof readToken).toBe('string');
    expect(readToken.length).toBeGreaterThan(0);

    // ── Submit (NO auth header) with kind=idea → steps is hidden + not enforced
    const submitRes = await request(`/forms/public/${slug}/submit`, {
      method: 'POST',
      // deliberately no token — anonymous submit
      json: {
        answers: { summary: 'Dark mode please', kind: 'idea', votes: 7 },
        readToken,
      },
    });
    const submitBody = (await json<{ data: any }>(submitRes, 201)).data;
    const createdTaskId: string = submitBody.createdTaskId ?? submitBody.CreatedTaskId;
    expect(createdTaskId).toBeTruthy();

    // ── Verify the task title (authed) ───────────────────────────────────────
    const taskRes = await request(`/tasks/${createdTaskId}`, { token });
    const task = (await json<{ data: any }>(taskRes, 200)).data;
    expect(task.title ?? task.Title).toBe('Dark mode please');

    // ── Verify the custom-field value (authed) ───────────────────────────────
    // Endpoint: GET /tasks/:id/fields  →  { data: [ { field: { id }, value } ] }
    // Confirmed from customfield-values.integration.test.ts line 33-34.
    const fieldsRes = await request(`/tasks/${createdTaskId}/fields`, { token });
    const fieldValues: any[] = (await json<{ data: any[] }>(fieldsRes, 200)).data;
    const votesEntry = fieldValues.find((e: any) => (e.field?.id ?? e.field?.Id) === fieldId);
    expect(votesEntry).toBeDefined();
    // The SP/mapper stores numbers as numbers; if the DB returns a string, accept that too.
    expect(Number(votesEntry.value)).toBe(7);
  });

  // ── 2. auth-required form rejects an anonymous submit (401) ───────────────

  it('auth-required form rejects an anonymous submit (401)', async () => {
    const { token, ws, space, listId } = await seedListAndField('t2');
    const slug = `auth-form-${Date.now()}-t2`;

    // Create an auth-required form.
    await json<{ data: any }>(
      await request('/forms', {
        method: 'POST',
        token,
        json: {
          workspaceId:  ws.Id,
          scopeType:    'LIST',
          scopeId:      listId,
          name:         'Auth-Required Form',
          config: {
            fields: [
              { key: 'summary', label: 'Summary', type: 'short_text', required: true },
            ],
            branching: [],
          },
          targetListId: listId,
          fieldMapping: {
            summary: { kind: 'task', target: 'title' },
          },
          isPublic:     true,
          publicSlug:   slug,
          authRequired: true,
        },
      }),
      201,
    );

    // Render — still public, readToken must come back.
    const renderBody = (await json<{ data: any }>(
      await request(`/forms/public/${slug}`),
      200,
    )).data;
    const readToken: string = renderBody.readToken ?? renderBody.ReadToken;

    // Anonymous submit (no Authorization header) must be rejected with 401.
    const submitRes = await request(`/forms/public/${slug}/submit`, {
      method: 'POST',
      // no token
      json: {
        answers:   { summary: 'Should be blocked' },
        readToken,
      },
    });
    expect(submitRes.status).toBe(401);
  });

  // ── 3. Rejects a submit missing a VISIBLE required field (422) ─────────────

  it('rejects a submit missing a VISIBLE required field (422)', async () => {
    const { token, ws, space, listId } = await seedListAndField('t3');
    const slug = `required-form-${Date.now()}-t3`;

    // Create a form with configBugIdea (steps is required when kind=bug).
    await json<{ data: any }>(
      await request('/forms', {
        method: 'POST',
        token,
        json: {
          workspaceId:  ws.Id,
          scopeType:    'LIST',
          scopeId:      listId,
          name:         'Required Field Form',
          config:       configBugIdea(),
          targetListId: listId,
          fieldMapping: {
            summary: { kind: 'task', target: 'title' },
          },
          isPublic:     true,
          publicSlug:   slug,
          authRequired: false,
        },
      }),
      201,
    );

    // Render — get readToken.
    const renderBody = (await json<{ data: any }>(
      await request(`/forms/public/${slug}`),
      200,
    )).data;
    const readToken: string = renderBody.readToken ?? renderBody.ReadToken;

    // Submit with kind='bug' which makes steps VISIBLE + REQUIRED, but omit steps.
    // validateAnswers must return missing=['steps'] → FormValidationError → 422.
    const submitRes = await request(`/forms/public/${slug}/submit`, {
      method: 'POST',
      // no token — anonymous is fine (authRequired=false)
      json: {
        answers:   { summary: 'crash', kind: 'bug' },
        readToken,
      },
    });
    expect(submitRes.status).toBe(422);
  });

});
