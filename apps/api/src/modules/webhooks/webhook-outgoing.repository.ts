import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { OutgoingWebhook, WebhookDelivery } from '@projectflow/types';

interface RawWebhook {
  Id:          string;
  WorkspaceId: string;
  Name:        string;
  Url:         string;
  Events:      string;  // JSON string
  IsActive:    boolean;
  CreatedAt:   string;
}

function mapWebhook(r: RawWebhook): OutgoingWebhook {
  return {
    id:          r.Id,
    workspaceId: r.WorkspaceId,
    name:        r.Name,
    url:         r.Url,
    events:      JSON.parse(r.Events ?? '[]'),
    isActive:    r.IsActive,
    createdAt:   r.CreatedAt,
  };
}

interface RawActiveWebhook {
  Id:     string;
  Url:    string;
  Secret: string;
  Events: string;
}

export interface ActiveWebhook {
  id:     string;
  url:    string;
  secret: string;
}

interface LogDeliveryInput {
  webhookId:    string;
  event:        string;
  payload:      string;
  statusCode:   number | null;
  responseBody: string;
  durationMs:   number;
  attempt:      number;
  success:      boolean;
}

export class WebhookOutgoingRepository {
  async create(input: {
    workspaceId: string;
    name:        string;
    url:         string;
    secret:      string;
    events:      string[];
  }): Promise<OutgoingWebhook> {
    const rows = await execSpOne<RawWebhook>('usp_Webhook_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: input.workspaceId },
      { name: 'Name',        type: sql.NVarChar(100),    value: input.name },
      { name: 'Url',         type: sql.NVarChar(500),    value: input.url },
      { name: 'Secret',      type: sql.NVarChar(255),    value: input.secret },
      { name: 'Events',      type: sql.NVarChar(sql.MAX),value: JSON.stringify(input.events) },
    ]);
    return mapWebhook(rows[0]);
  }

  async list(workspaceId: string): Promise<OutgoingWebhook[]> {
    const rows = await execSpOne<RawWebhook>('usp_Webhook_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return Array.from(rows).map(mapWebhook);
  }

  async delete(id: string): Promise<void> {
    await execSpOne('usp_Webhook_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Webhook_GetWorkspaceId', [
      { name: 'WebhookId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async getActive(workspaceId: string, event: string): Promise<ActiveWebhook[]> {
    const rows = await execSpOne<RawActiveWebhook>('usp_Webhook_GetActive', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'Event',       type: sql.NVarChar(50),     value: event },
    ]);
    return Array.from(rows).map(r => ({ id: r.Id, url: r.Url, secret: r.Secret }));
  }

  async logDelivery(input: LogDeliveryInput): Promise<void> {
    await execSpOne('usp_Webhook_LogDelivery', [
      { name: 'WebhookId',    type: sql.UniqueIdentifier, value: input.webhookId },
      { name: 'Event',        type: sql.NVarChar(50),     value: input.event },
      { name: 'Payload',      type: sql.NVarChar(sql.MAX),value: input.payload },
      { name: 'StatusCode',   type: sql.Int,              value: input.statusCode ?? null },
      { name: 'ResponseBody', type: sql.NVarChar(sql.MAX),value: input.responseBody },
      { name: 'DurationMs',   type: sql.Int,              value: input.durationMs },
      { name: 'Attempt',      type: sql.Int,              value: input.attempt },
      { name: 'Success',      type: sql.Bit,              value: input.success },
    ]);
  }

  async listDeliveries(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
    const rows = await execSpOne<any>('usp_Webhook_ListDeliveries', [
      { name: 'WebhookId', type: sql.UniqueIdentifier, value: webhookId },
      { name: 'Limit',     type: sql.Int,              value: limit },
    ]);
    return Array.from(rows).map(r => ({
      id:          r.Id,
      webhookId:   r.WebhookId,
      event:       r.Event,
      statusCode:  r.StatusCode,
      durationMs:  r.DurationMs,
      attempt:     r.Attempt,
      success:     r.Success,
      deliveredAt: r.DeliveredAt,
    }));
  }
}
