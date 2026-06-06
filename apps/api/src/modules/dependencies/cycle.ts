// Pure transitive-reachability cycle check for the dependency picker / tests.
//
// Edge semantics: edges.get(t) = the set of tasks `t` waits_on. Adding the edge
// (taskId waits_on dependsOn) creates a cycle iff `dependsOn` can already reach
// `taskId` by following waits_on edges (i.e. taskId is already a transitive
// blocker of dependsOn).
export function wouldCreateCycle(
  edges: Map<string, Set<string>>,
  taskId: string,
  dependsOn: string,
): boolean {
  if (taskId === dependsOn) return true;
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === taskId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const next of edges.get(n) ?? []) stack.push(next);
  }
  return false;
}
