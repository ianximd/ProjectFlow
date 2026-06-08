/**
 * Automation condition evaluation entry point (Phase 6b).
 *
 * The real engine is the pure, recursive evaluateConditionTree in
 * condition.tree.ts. This module re-exports it + parseConditionTree + the
 * ConditionContext type for the worker. The legacy AND-only evaluateConditions
 * (with ISSUE_MATCHES_FILTER / USER_HAS_ROLE return-true stubs) is removed —
 * the worker now evaluates the full tree with real PQL-filter + RBAC resolvers.
 */
export { evaluateConditionTree, parseConditionTree, compareOperator } from './condition.tree.js';
export type { ConditionContext } from './condition.tree.js';
