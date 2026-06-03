import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { HierarchyNodeType } from '@projectflow/types';

export class HierarchyRepository {
  async descendantTasks(nodeType: HierarchyNodeType, nodeId: string) {
    return execSpOne('usp_Hierarchy_DescendantTasks', [
      { name: 'NodeType', type: sql.NVarChar(8),      value: nodeType },
      { name: 'NodeId',   type: sql.UniqueIdentifier, value: nodeId },
    ]);
  }
}
