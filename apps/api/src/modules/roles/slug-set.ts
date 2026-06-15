export interface RoleSlugs { roleId: string; slugs: string[]; }

/** Effective slug set for a user = union of the slug sets of exactly the roles they hold. */
export function resolveRoleSlugSet(allRoles: RoleSlugs[], heldRoleIds: string[]): Set<string> {
  const held = new Set(heldRoleIds);
  const out = new Set<string>();
  for (const r of allRoles) {
    if (!held.has(r.roleId)) continue;
    for (const s of r.slugs) out.add(s);
  }
  return out;
}
