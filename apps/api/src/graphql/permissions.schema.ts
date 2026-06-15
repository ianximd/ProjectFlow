import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { roleService } from '../modules/roles/role.service.js';
import { accessService } from '../modules/access/access.service.js';
import { HierarchyRepository } from '../modules/hierarchy/hierarchy.repository.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { RoleWithCounts, ObjectPermissionGrant, HierarchyNodeType } from '@projectflow/types';

const hierarchyRepo = new HierarchyRepository();

function forbid(message: string): never {
  throw new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } });
}

/**
 * GraphQL mirror of the permissions/roles REST surface (Phase 10b).
 * Exposes workspace-role CRUD/assign and per-object permission read/write,
 * gated with the same authz as the REST routes.
 */
export function registerPermissionsGraphql(): void {
  const WorkspaceRoleType = builder.objectRef<RoleWithCounts>('WorkspaceRole');
  WorkspaceRoleType.implement({ fields: (t) => ({
    id:              t.exposeString('id'),
    name:            t.exposeString('name'),
    slug:            t.exposeString('slug'),
    description:     t.string({ nullable: true, resolve: (r) => r.description ?? null }),
    scope:           t.exposeString('scope'),
    isSystem:        t.boolean({ resolve: (r) => r.isSystem }),
    workspaceId:     t.string({ nullable: true, resolve: (r) => r.workspaceId ?? null }),
    permissionCount: t.exposeInt('permissionCount'),
    memberCount:     t.exposeInt('memberCount'),
  }) });

  const ObjectPermissionGrantType = builder.objectRef<ObjectPermissionGrant>('ObjectPermissionGrant');
  ObjectPermissionGrantType.implement({ fields: (t) => ({
    id:                t.exposeString('id'),
    subjectType:       t.exposeString('subjectType'),
    subjectId:         t.exposeString('subjectId'),
    subjectName:       t.string({ nullable: true, resolve: (g) => g.subjectName ?? null }),
    subjectEmail:      t.string({ nullable: true, resolve: (g) => g.subjectEmail ?? null }),
    objectType:        t.exposeString('objectType'),
    objectId:          t.exposeString('objectId'),
    level:             t.exposeString('level'),
    inherited:         t.boolean({ resolve: (g) => g.inherited }),
    inheritedFromName: t.string({ nullable: true, resolve: (g) => g.inheritedFromName ?? null }),
  }) });

  builder.queryFields((t) => ({
    workspaceRoles: t.field({
      type: [WorkspaceRoleType],
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        return roleService.listWorkspaceRoles(a.workspaceId);
      },
    }),
    objectPermissions: t.field({
      type: [ObjectPermissionGrantType],
      args: {
        objectType: t.arg.string({ required: true }),
        objectId:   t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.objectType as HierarchyNodeType, a.objectId, 'FULL');
        return accessService.listObjectPermissions(a.objectType as HierarchyNodeType, a.objectId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createWorkspaceRole: t.field({
      type: WorkspaceRoleType,
      args: {
        workspaceId:   t.arg.string({ required: true }),
        name:          t.arg.string({ required: true }),
        description:   t.arg.string({ required: false }),
        permissionIds: t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        const role = await roleService.createWorkspaceRole({
          workspaceId:   a.workspaceId,
          name:          a.name,
          description:   a.description ?? null,
          permissionIds: a.permissionIds ?? [],
          actorId:       (ctx.user as any).userId,
          actorEmail:    (ctx.user as any).email ?? null,
        });
        return {
          ...role,
          permissionCount: role.permissions.length,
          memberCount:     0,
        } as any;
      },
    }),

    updateWorkspaceRole: t.field({
      type: 'Boolean',
      args: {
        workspaceId:   t.arg.string({ required: true }),
        roleId:        t.arg.string({ required: true }),
        name:          t.arg.string({ required: false }),
        description:   t.arg.string({ required: false }),
        permissionIds: t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        const res = await roleService.updateWorkspaceRole({
          workspaceId:   a.workspaceId,
          roleId:        a.roleId,
          name:          a.name          ?? undefined,
          description:   a.description   ?? undefined,
          permissionIds: a.permissionIds ?? undefined,
          actorId:       (ctx.user as any).userId,
          actorEmail:    (ctx.user as any).email ?? null,
        });
        if (!res.ok) {
          if (res.code === 'IMMUTABLE') forbid('System roles are immutable');
          notFound('Role not found');
        }
        return true;
      },
    }),

    deleteWorkspaceRole: t.field({
      type: 'Boolean',
      args: {
        workspaceId: t.arg.string({ required: true }),
        roleId:      t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        const res = await roleService.deleteWorkspaceRole({
          workspaceId: a.workspaceId,
          roleId:      a.roleId,
          actorId:     (ctx.user as any).userId,
          actorEmail:  (ctx.user as any).email ?? null,
        });
        if (!res.ok) {
          if (res.code === 'IMMUTABLE') forbid('System roles are immutable');
          notFound('Role not found');
        }
        return true;
      },
    }),

    assignWorkspaceRole: t.field({
      type: 'Boolean',
      args: {
        workspaceId: t.arg.string({ required: true }),
        roleId:      t.arg.string({ required: true }),
        userId:      t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'role.manage');
        const res = await roleService.assignWorkspaceRole({
          workspaceId: a.workspaceId,
          roleId:      a.roleId,
          userId:      a.userId,
          actorId:     (ctx.user as any).userId,
          actorEmail:  (ctx.user as any).email ?? null,
        });
        if (!res.ok) notFound('Role not found in this workspace');
        return true;
      },
    }),

    setObjectPermission: t.field({
      type: [ObjectPermissionGrantType],
      args: {
        objectType:  t.arg.string({ required: true }),
        objectId:    t.arg.string({ required: true }),
        subjectType: t.arg.string({ required: true }),
        subjectId:   t.arg.string({ required: true }),
        level:       t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.objectType as HierarchyNodeType, a.objectId, 'FULL');
        const workspaceId = await hierarchyRepo.getWorkspaceIdForNode(
          a.objectType as HierarchyNodeType,
          a.objectId,
        );
        if (!workspaceId) notFound('Resource not found');
        await accessService.setObjectPermission({
          workspaceId:  workspaceId!,
          subjectType:  a.subjectType as 'USER' | 'ROLE',
          subjectId:    a.subjectId,
          objectType:   a.objectType as HierarchyNodeType,
          objectId:     a.objectId,
          level:        a.level as any,
          actorId:      (ctx.user as any).userId,
          actorEmail:   (ctx.user as any).email ?? null,
        });
        return accessService.listObjectPermissions(a.objectType as HierarchyNodeType, a.objectId);
      },
    }),

    removeObjectPermission: t.field({
      type: [ObjectPermissionGrantType],
      args: {
        objectType:  t.arg.string({ required: true }),
        objectId:    t.arg.string({ required: true }),
        subjectType: t.arg.string({ required: true }),
        subjectId:   t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.objectType as HierarchyNodeType, a.objectId, 'FULL');
        const workspaceId = await hierarchyRepo.getWorkspaceIdForNode(
          a.objectType as HierarchyNodeType,
          a.objectId,
        );
        if (!workspaceId) notFound('Resource not found');
        await accessService.removeObjectPermission({
          workspaceId:  workspaceId!,
          subjectType:  a.subjectType as 'USER' | 'ROLE',
          subjectId:    a.subjectId,
          objectType:   a.objectType as HierarchyNodeType,
          objectId:     a.objectId,
          actorId:      (ctx.user as any).userId,
          actorEmail:   (ctx.user as any).email ?? null,
        });
        return accessService.listObjectPermissions(a.objectType as HierarchyNodeType, a.objectId);
      },
    }),
  }));
}
