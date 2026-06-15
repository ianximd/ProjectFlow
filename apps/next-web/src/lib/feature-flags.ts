// ── Feature flags ─────────────────────────────────────────────────────────────
// Simple compile-time flags. Set to `true` here (or gate on an env var) to
// activate the corresponding feature surface.

/**
 * Doc view ships as a flag-gated stub for Phase 9e v1. Phase 7a docs now exist
 * (Phase 7a/7b/7c have landed) — a follow-up can flip this to `true` and wire
 * the real doc reader here. The stub branch is the only compiled path for now.
 */
export const DOCS_FEATURE_ENABLED = false;
