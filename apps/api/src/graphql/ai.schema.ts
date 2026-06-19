import { builder } from './builder.js';
import { qaService } from '../modules/ai/qa/qa.service.js';
import { requireWorkspacePermission } from './authz.js';

/**
 * AI Q&A GraphQL mirror (Phase 11b). REST (`POST /ai/ask`) stays primary; both
 * delegate to the SAME qaService. The `aiAsk` query is gated on `ai.use` in the
 * target workspace. Citations resolve only to objects the caller can VIEW
 * (derived from the permission-filtered retrieved sources), so the GraphQL
 * surface carries the same guarantee as REST.
 */
export function registerAiGraphql(): void {
  const AiCitationType = builder.objectRef<{ objectType: string; objectId: string }>('AiCitation');
  AiCitationType.implement({
    description: 'A reference to a workspace object the answer cited (always VIEW-able by the caller).',
    fields: (t) => ({
      objectType: t.string({ resolve: (c) => c.objectType }),
      objectId: t.string({ resolve: (c) => c.objectId }),
    }),
  });

  const AiAnswerType = builder.objectRef<{
    answer: string;
    citations: { objectType: string; objectId: string }[];
  }>('AiAnswer');
  AiAnswerType.implement({
    description: 'An AI answer grounded in permission-scoped retrieved sources.',
    fields: (t) => ({
      answer: t.string({ resolve: (a) => a.answer }),
      citations: t.field({ type: [AiCitationType], resolve: (a) => a.citations }),
    }),
  });

  builder.queryFields((t) => ({
    /** Ask a question over the workspace's accessible content (ai.use gated). */
    aiAsk: t.field({
      type: AiAnswerType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        question: t.arg.string({ required: true }),
        scopeType: t.arg.string({ required: false }),
        scopeId: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx as any, a.workspaceId, 'ai.use');
        const userId = (ctx.user as any).userId as string;
        const scope =
          a.scopeType && a.scopeId ? { type: a.scopeType, id: a.scopeId } : undefined;
        return qaService.ask(userId, a.workspaceId, a.question, scope);
      },
    }),
  }));
}
