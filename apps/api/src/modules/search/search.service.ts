import { SearchRepository } from './search.repository.js';
import type { SearchParams } from './search.repository.js';
import { parsePQL } from './pql.parser.js';

const repo = new SearchRepository();

export const searchService = {
  /** Simple filter-based search (no PQL string) */
  async search(params: SearchParams) {
    return repo.search(params);
  },

  /** PQL string → parse → search */
  async searchPQL(pql: string, workspaceId: string, userId: string, page = 1, pageSize = 25) {
    const parsed = parsePQL(pql, userId);
    return repo.search({
      workspaceId,
      q:            parsed.q,
      type:         parsed.type,
      status:       parsed.status,
      priority:     parsed.priority,
      assigneeId:   parsed.assigneeId,
      reporterId:   parsed.reporterId,
      sprintId:     parsed.sprintId,
      openSprints:  parsed.openSprints,
      dueAfter:     parsed.dueAfter,
      dueBefore:    parsed.dueBefore,
      createdAfter: parsed.createdAfter,
      updatedAfter: parsed.updatedAfter,
      orderBy:      parsed.orderBy,
      orderDir:     parsed.orderDir,
      page,
      pageSize,
    });
  },
};
