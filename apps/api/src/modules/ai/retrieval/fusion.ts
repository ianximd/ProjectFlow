/**
 * Reciprocal-rank fusion (RRF).
 *
 * Combines multiple ranked id-lists into a single merged ranking by summing
 * reciprocal-rank scores. Items that appear near the top of multiple lists
 * receive higher combined scores.
 *
 * @param lists  Arrays of item ids ordered best→worst.
 * @param k      Smoothing constant (default 60; higher k flattens rank differences).
 * @returns      Merged id list ordered best→worst.
 */
export function reciprocalRankFusion(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}
