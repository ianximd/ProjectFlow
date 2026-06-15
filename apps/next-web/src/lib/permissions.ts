import type { HierarchyNodeType, ObjectPermissionGrant, ObjectPermissionLevel } from '@projectflow/types';

const RANK: Record<ObjectPermissionLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };

/** Is a grant direct (on this object) or inherited from an ancestor? */
export function computeInheritedFrom(
  objectType: HierarchyNodeType, objectId: string, grant: ObjectPermissionGrant,
): { inherited: boolean; fromName: string | null } {
  const direct = grant.objectType === objectType && grant.objectId === objectId;
  return direct ? { inherited: false, fromName: null } : { inherited: true, fromName: grant.inheritedFromName };
}

export interface SubjectGrantRow {
  subjectType:       ObjectPermissionGrant['subjectType'];
  subjectId:         string;
  subjectName:       string | null;
  subjectEmail:      string | null;
  effectiveLevel:    ObjectPermissionLevel;        // the most-specific (direct wins over inherited)
  directGrantId:     string | null;                // present only when editable on THIS object
  inheritedLevel:    ObjectPermissionLevel | null; // surfaced as the "inherited from <ancestor>" hint
  inheritedFromName: string | null;
}

/** Collapse the raw ancestry grant list into one row per subject for the editor. */
export function groupGrantsBySubject(
  objectType: HierarchyNodeType, objectId: string, grants: ObjectPermissionGrant[],
): SubjectGrantRow[] {
  const map = new Map<string, SubjectGrantRow>();
  for (const g of grants) {
    const key = `${g.subjectType}:${g.subjectId}`;
    const { inherited } = computeInheritedFrom(objectType, objectId, g);
    let row = map.get(key);
    if (!row) {
      row = {
        subjectType: g.subjectType, subjectId: g.subjectId, subjectName: g.subjectName, subjectEmail: g.subjectEmail,
        effectiveLevel: g.level, directGrantId: null, inheritedLevel: null, inheritedFromName: null,
      };
      map.set(key, row);
    }
    if (inherited) {
      if (row.inheritedLevel === null || RANK[g.level] > RANK[row.inheritedLevel]) {
        row.inheritedLevel = g.level;
        row.inheritedFromName = g.inheritedFromName;
      }
    } else {
      row.directGrantId = g.id;
    }
    const directLevel = !inherited ? g.level : null;
    if (directLevel) row.effectiveLevel = directLevel;
    else if (row.directGrantId === null && row.inheritedLevel) row.effectiveLevel = row.inheritedLevel;
  }
  return [...map.values()];
}
