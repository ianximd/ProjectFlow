# Decisions Log

## 2026-06-03 — Phase 1 Hierarchy

1. Dual API surface (REST primary + GraphQL mirror) — frontend is REST/SSR; @projectflow/types is hand-written. Both delegate to shared services.
2. Full per-object ACL implemented now via new ObjectPermissions table + usp_ObjectAccess_Resolve (existing RBAC has no object rows).
3. Idempotency-Key deferred (no existing mutation honors it; not a Phase 1 acceptance criterion).
4. Migration reversibility via committed rollback script infra/sql/migrations/rollback/0029_hierarchy.down.sql (runner is forward-only).
5. Projects table physically retained; relabeled "Space" only in API/UI via a single label constant.
