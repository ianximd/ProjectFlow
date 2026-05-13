import sql from 'mssql';
import { getPool, trackQueryTime } from './db.js';
import { subLogger } from './logger.js';

const log = subLogger('sp');

export type SpParam = {
  name:  string;
  type:  sql.ISqlTypeFactory | sql.ISqlType;
  value: unknown;
};

/** Accepts either an array of SpParam objects or a plain key→value object. */
export type SpParams = SpParam[] | Record<string, unknown>;

/**
 * Build a structured-friendly representation of the SP parameter set for
 * logging. We keep the names (operator wants to see which SP got which
 * shape of call) and the value types/sizes, but drop large blobs and let
 * the logger's redaction list strip secrets by key.
 */
export function paramsForLog(params: SpParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(params)) {
    for (const p of params) {
      out[`@${p.name}`] = summariseValue(p.value);
    }
  } else {
    for (const [k, v] of Object.entries(params)) {
      out[`@${k}`] = summariseValue(v);
    }
  }
  return out;
}

export function summariseValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string')  return v.length > 200 ? `${v.slice(0, 200)}…(${v.length})` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `<Buffer ${v.length}B>`;
  return typeof v; // catch-all
}

/**
 * Pull the recordset row counts out of an mssql IRecordSet[] return.
 * Useful for the operator who wants to see "did the SP actually return
 * anything?" without dumping the rows themselves.
 */
function recordsetSizes(sets: sql.IRecordSet<unknown>[]): number[] {
  return sets.map((s) => s?.length ?? 0);
}

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
  const start = Date.now();
  try {
    const result = await req.execute(spName);
    done();
    const durationMs = Date.now() - start;
    const sets       = result.recordsets as sql.IRecordSet<T>[];
    log.info(
      {
        sp:         spName,
        durationMs,
        rowCounts:  recordsetSizes(sets as any),
        params:     paramsForLog(params),
      },
      `${spName} OK`,
    );
    return sets;
  } catch (err: any) {
    done();
    const durationMs = Date.now() - start;
    log.error(
      {
        sp:           spName,
        durationMs,
        params:       paramsForLog(params),
        errNumber:    err?.number,
        errLine:      err?.lineNumber,
        errProcName:  err?.procName,
        errMessage:   err?.message,
      },
      `${spName} FAILED`,
    );
    throw err;
  }
}

export async function execSpOne<T = unknown>(
  spName: string,
  params: SpParams = []
): Promise<sql.IRecordSet<T>> {
  const sets = await execSp<T>(spName, params);
  return sets[0] ?? [];
}
