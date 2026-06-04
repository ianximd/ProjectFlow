import type { FieldDescriptor } from './types.js';

/**
 * Built-in queryable fields. Keys are stable FieldRef.key values; values map to
 * physical Tasks columns (aliased `t`) or EXISTS-joins. This is an allow-list:
 * any FieldRef.key not present here is rejected by the catalog.
 *
 * Column names verified against migrations:
 *   0001_init.sql          — Tasks base definition
 *   0024_task_duedate_datetime.sql — DueDate altered to DATETIME2
 *   0029_hierarchy.sql     — ListId, ListPath, ArchivedAt added
 *   0030_custom_fields.sql — TaskTypeId added; TaskWatchers created
 *   0011_versions_components_labels.sql — Labels + TaskLabelLinks created
 *
 * Join tables:
 *   TaskAssignees  (TaskId, UserId)  — 0001_init.sql
 *   TaskWatchers   (TaskId, UserId)  — 0030_custom_fields.sql
 *   TaskLabelLinks (TaskId, LabelId) — 0011_versions_components_labels.sql
 *     NOTE: "tags" in the Phase 2 API are backed by Labels/TaskLabelLinks,
 *     NOT a TaskTags table (which does not exist).
 */
export const BUILTIN_FIELDS: Record<string, FieldDescriptor> = {
  status:      { logical: 'enum',   column: 'Status' },
  priority:    { logical: 'enum',   column: 'Priority' },
  type:        { logical: 'enum',   column: 'TaskTypeId' }, // Phase-2 user-defined task type (FK to TaskTypes.Id)
  title:       { logical: 'string', column: 'Title' },
  storyPoints: { logical: 'number', column: 'StoryPoints' },
  dueDate:     { logical: 'date',   column: 'DueDate' },
  startDate:   { logical: 'date',   column: 'StartDate' },
  createdAt:   { logical: 'date',   column: 'CreatedAt' },
  updatedAt:   { logical: 'date',   column: 'UpdatedAt' },
  position:    { logical: 'number', column: 'Position' },
  reporter:    { logical: 'user',   column: 'ReporterId' },
  sprint:      { logical: 'enum',   column: 'SprintId' },
  assignee:    { logical: 'user',   exists: (p) => `EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId = t.Id AND a.UserId = ${p})` },
  tags:        { logical: 'array',  exists: (p) => `EXISTS (SELECT 1 FROM TaskLabelLinks tl WHERE tl.TaskId = t.Id AND tl.LabelId = ${p})` },
  watchers:    { logical: 'array',  exists: (p) => `EXISTS (SELECT 1 FROM TaskWatchers w WHERE w.TaskId = t.Id AND w.UserId = ${p})` },
};
