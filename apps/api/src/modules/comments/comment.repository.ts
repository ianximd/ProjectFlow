import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { Comment, CreateCommentInput } from '@projectflow/types';

export class CommentRepository {
  async create(input: CreateCommentInput, authorId: string): Promise<Comment> {
    const rows = await execSpOne<Comment>('usp_Comment_Create', [
      { name: 'TaskId',   type: sql.UniqueIdentifier,  value: input.taskId },
      { name: 'AuthorId', type: sql.UniqueIdentifier,  value: authorId },
      { name: 'Body',     type: sql.NVarChar(sql.MAX), value: input.body },
      { name: 'ParentId', type: sql.UniqueIdentifier,  value: input.parentId ?? null },
    ]);
    return rows[0];
  }

  async list(taskId: string): Promise<Comment[]> {
    const rows = await execSpOne<any>('usp_Comment_List', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rows.map((r: any) => ({
      ...r,
      reactions: r.ReactionsJson ? JSON.parse(r.ReactionsJson) : [],
    })) as Comment[];
  }

  async getById(id: string): Promise<Comment | null> {
    const rows = await execSpOne<Comment>('usp_Comment_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  async update(id: string, body: string, authorId: string): Promise<Comment | null> {
    try {
      const rows = await execSpOne<Comment>('usp_Comment_Update', [
        { name: 'Id',       type: sql.UniqueIdentifier,  value: id },
        { name: 'AuthorId', type: sql.UniqueIdentifier,  value: authorId },
        { name: 'Body',     type: sql.NVarChar(sql.MAX), value: body },
      ]);
      return rows[0] ?? null;
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

  async react(commentId: string, userId: string, emoji: string) {
    const rows = await execSpOne<{ Emoji: string; Count: number }>('usp_Comment_React', [
      { name: 'CommentId', type: sql.UniqueIdentifier, value: commentId },
      { name: 'UserId',    type: sql.UniqueIdentifier, value: userId },
      { name: 'Emoji',     type: sql.NVarChar(20),     value: emoji },
    ]);
    return rows as { Emoji: string; Count: number }[];
  }
}
