import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { IntegrationConnection, IntegrationEvent, IntegrationProvider } from '@projectflow/types';

function mapRow(row: any): IntegrationConnection {
  return {
    id:          row.Id,
    workspaceId: row.WorkspaceId,
    provider:    row.Provider as IntegrationProvider,
    channelName: row.ChannelName,
    webhookUrl:  row.WebhookUrl,
    events:      (() => { try { return JSON.parse(row.Events ?? '[]') as IntegrationEvent[]; } catch { return [] as IntegrationEvent[]; } })(),
    isActive:    Boolean(row.IsActive),
    createdAt:   String(row.CreatedAt),
  };
}

export class IntegrationRepository {
  async list(workspaceId: string): Promise<IntegrationConnection[]> {
    const rs = await execSpOne<any>('usp_Integration_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rs.map(mapRow);
  }

  async create(
    workspaceId: string,
    provider: string,
    channelName: string,
    webhookUrl: string,
    events: string[] | null,
  ): Promise<IntegrationConnection> {
    const rs = await execSpOne<any>('usp_Integration_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'Provider',    type: sql.NVarChar(20),     value: provider },
      { name: 'ChannelName', type: sql.NVarChar(255),    value: channelName },
      { name: 'WebhookUrl',  type: sql.NVarChar(2000),   value: webhookUrl },
      { name: 'Events',      type: sql.NVarChar(sql.MAX), value: events ? JSON.stringify(events) : null },
    ]);
    return mapRow(rs[0]);
  }

  async delete(id: string): Promise<void> {
    await execSpOne('usp_Integration_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }
}
