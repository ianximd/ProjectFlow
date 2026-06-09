/** Default position for the first page in an empty list. */
export const FIRST_POSITION = 0;

/**
 * Compute a fractional Position strictly between `before` and `after`.
 *   - both null  → FIRST_POSITION (empty list)
 *   - before null → prepend: half of `after`
 *   - after null  → append: before + 1
 *   - both set    → arithmetic midpoint
 * FLOAT precision is ample for interactive reordering; a periodic renormalize
 * (out of scope here) handles pathological deep nesting.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return FIRST_POSITION;
  if (before === null) return (after as number) / 2;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
