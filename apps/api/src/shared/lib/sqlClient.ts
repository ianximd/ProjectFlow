import sql from 'mssql';
import { getPool, trackQueryTime } from './db.js';

export type SpParam = {
  name:  string;
  type:  sql.ISqlTypeFactory | sql.ISqlType;
  value: unknown;
};

/** Accepts either an array of SpParam objects or a plain key→value object. */
export type SpParams = SpParam[] | Record<string, unknown>;

export async function execSp<T = unknown>(
  spName: string,
  params: SpParams = []
): Promise<sql.IRecordSet<T>[]> {
  const pool = await getPool();
  const req  = pool.request();
  if (Array.isArray(params)) {
    for (const p of params) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req.input(p.name, p.type as any, p.value);
    }
  } else {
    for (const [name, value] of Object.entries(params)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).input(name, value);
    }
  }
  const done = trackQueryTime(spName);
  const result = await req.execute(spName);
  done();
  return result.recordsets as sql.IRecordSet<T>[];
}

export async function execSpOne<T = unknown>(
  spName: string,
  params: SpParams = []
): Promise<sql.IRecordSet<T>> {
  const sets = await execSp<T>(spName, params);
  return sets[0] ?? [];
}
