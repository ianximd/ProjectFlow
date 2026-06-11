export interface RollupRow {
  taskId:                string;
  ownLoggedSeconds:      number;
  ownEstimateSeconds:    number | null;
  rollupLoggedSeconds:   number;
  rollupEstimateSeconds: number;
}

export interface EstimateVsActual {
  taskId:           string;
  loggedSeconds:    number;
  estimateSeconds:  number;
  ratio:            number | null;
  remainingSeconds: number | null;
  overBudget:       boolean;
}

/** Whole-second elapsed between two ISO timestamps; never negative. */
export function elapsedSeconds(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

/** Derive estimate-vs-actual from a subtree rollup row. */
export function estimateVsActual(row: RollupRow): EstimateVsActual {
  const logged   = row.rollupLoggedSeconds;
  const estimate = row.rollupEstimateSeconds;
  const hasEstimate = estimate > 0;
  return {
    taskId:           row.taskId,
    loggedSeconds:    logged,
    estimateSeconds:  estimate,
    ratio:            hasEstimate ? logged / estimate : null,
    remainingSeconds: hasEstimate ? Math.max(0, estimate - logged) : null,
    overBudget:       hasEstimate && logged > estimate,
  };
}
