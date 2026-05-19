import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { Comment, CommentReactionSummary, CreateCommentInput } from '@projectflow/types';

// SPs return PascalCase columns; the Comment type contract is camelCase.
// Map at the repository boundary so callers (REST, GraphQL, services) get the declared shape.
function toComment(row: any): Comment {
  const rawReactions: any[] = row.ReactionsJson ? JSON.parse(row.ReactionsJson) : [];
  return {
    id:              row.Id,
    taskId:          row.TaskId,
    authorId:        row.AuthorId,
    parentId:        row.ParentId ?? null,
    body:            row.Body,
    isEdited:        row.IsEdited,
    deletedAt:       row.DeletedAt ?? null,
    createdAt:       row.CreatedAt,
    updatedAt:       row.UpdatedAt,
    authorName:      row.AuthorName,
    authorEmail:     row.AuthorEmail,
    authorAvatarUrl: row.AuthorAvatarUrl ?? null,
    reactions:       rawReactions.map((r) => ({
      emoji: r.Emoji ?? r.emoji,
      count: r.Count ?? r.count ?? 0,
    })),
  };
}

export class CommentRepository {
  async create(input: CreateCommentInput, authorId: string): Promise<Comment> {
    const rows = await execSpOne<any>('usp_Comment_Create', [
      { name: 'TaskId',   type: sql.UniqueIdentifier,  value: input.taskId },
      { name: 'AuthorId', type: sql.UniqueIdentifier,  value: authorId },
      { name: 'Body',     type: sql.NVarChar(sql.MAX), value: input.body },
      { name: 'ParentId', type: sql.UniqueIdentifier,  value: input.parentId ?? null },
    ]);
    return toComment(rows[0]);
  }

  async list(taskId: string): Promise<Comment[]> {
    const rows = await execSpOne<any>('usp_Comment_List', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows.map(toComment);
  }

  async getById(id: string): Promise<Comment | null> {
    const rows = await execSpOne<any>('usp_Comment_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? toComment(rows[0]) : null;
  }

  async update(id: string, body: string, authorId: string): Promise<Comment | null> {
    try {
      const rows = await execSpOne<any>('usp_Comment_Update', [
        { name: 'Id',       type: sql.UniqueIdentifier,  value: id },
        { name: 'AuthorId', type: sql.UniqueIdentifier,  value: authorId },
        { name: 'Body',     type: sql.NVarChar(sql.MAX), value: body },
      ]);
      return rows[0] ? toComment(rows[0]) : null;
    } catch (err: any) {
      if (err.message?.includes('COMMENT_NOT_FOUND_OR_NOT_OWNER')) return null;
      throw err;
    }
  }

  async delete(id: string, authorId: string): Promise<boolean> {
    try {
      await execSpOne('usp_Comment_Delete', [
        { name: 'Id',       type: sql.UniqueIdentifier, value: id },
        { name: 'AuthorId', type: sql.UniqueIdentifier, value: authorId },
      ]);
      return true;
    } catch (err: any) {
      if (err.message?.includes('COMMENT_NOT_FOUND_OR_NOT_OWNER')) return false;
      throw err;
    }
  }

  async getContext(id: string): Promise<{ workspaceId: string; ownerId: string } | null> {
    const rows = await execSpOne<{ WorkspaceId: string; OwnerId: string }>('usp_Comment_GetContext', [
      { name: 'CommentId', type: sql.UniqueIdentifier, value: id },
    ]);
    const r = rows[0];
    return r ? { workspaceId: r.WorkspaceId, ownerId: r.OwnerId } : null;
  }

  async react(commentId: string, userId: string, emoji: string): Promise<CommentReactionSummary[]> {
    const rows = await execSpOne<{ Emoji: string; Count: number }>('usp_Comment_React', [
      { name: 'CommentId', type: sql.UniqueIdentifier, value: commentId },
      { name: 'UserId',    type: sql.UniqueIdentifier, value: userId },
      { name: 'Emoji',     type: sql.NVarChar(20),     value: emoji },
    ]);
    return rows.map((r) => ({ emoji: r.Emoji, count: r.Count }));
  }
}
