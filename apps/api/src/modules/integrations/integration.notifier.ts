/**
 * integration.notifier.ts
 *
 * Sends formatted messages to Slack (Block Kit) and Microsoft Teams
 * (Adaptive Card / legacy MessageCard) via their incoming webhook URLs.
 *
 * All outbound HTTP calls are fire-and-forget.  Errors are only logged so
 * they never surface to the caller.
 */

import { subLogger } from '../../shared/lib/logger.js';

const log = subLogger('integrations');

export interface IntegrationMessage {
  event:       string;   // e.g. 'task.created'
  title:       string;   // Short summary line
  detail?:     string;   // Optional secondary text
  url?:        string;   // Link to the item in ProjectFlow
  color?:      string;   // Hex colour without '#', defaults to '0052CC' (Jira blue)
}

/**
 * POST a Slack Block-Kit payload to `webhookUrl`.
 */
export async function sendSlackMessage(
  webhookUrl: string,
  msg: IntegrationMessage,
): Promise<void> {
  const color  = `#${msg.color ?? '0052CC'}`;
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${msg.title}*${msg.detail ? `\n${msg.detail}` : ''}` },
      ...(msg.url
        ? {
            accessory: {
              type:  'button',
              text:  { type: 'plain_text', text: 'View', emoji: true },
              url:   msg.url,
              style: 'primary',
            },
          }
        : {}),
    },
    { type: 'divider' },
  ];

  const body = {
    attachments: [
      {
        color,
        blocks,
        fallback: msg.title,
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      log.warn({ status: res.status, event: msg.event }, 'Slack webhook non-2xx');
    }
  } catch (err: any) {
    log.error({ err: err?.message }, 'Slack delivery failed');
  }
}

/**
 * POST a Teams MessageCard payload to `webhookUrl`.
 * Uses the "legacy" Office 365 connector card format which all Teams
 * incoming webhook URLs support without extra configuration.
 */
export async function sendTeamsMessage(
  webhookUrl: string,
  msg: IntegrationMessage,
): Promise<void> {
  const themeColor = msg.color ?? '0052CC';

  const body: Record<string, unknown> = {
    '@type':      'MessageCard',
    '@context':   'http://schema.org/extensions',
    themeColor,
    summary:      msg.title,
    sections: [
      {
        activityTitle:    msg.title,
        activitySubtitle: msg.detail ?? '',
        markdown:         true,
      },
    ],
  };

  if (msg.url) {
    body.potentialAction = [
      {
        '@type': 'OpenUri',
        name:    'View in ProjectFlow',
        targets: [{ os: 'default', uri: msg.url }],
      },
    ];
  }

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      log.warn({ status: res.status, event: msg.event }, 'Teams webhook non-2xx');
    }
  } catch (err: any) {
    log.error({ err: err?.message }, 'Teams delivery failed');
  }
}

/**
 * Dispatch a message to a single integration connection.
 * Picks the right sender based on `provider`.
 */
export async function dispatchToIntegration(
  provider:   string,
  webhookUrl: string,
  msg:        IntegrationMessage,
): Promise<void> {
  if (provider === 'slack') {
    await sendSlackMessage(webhookUrl, msg);
  } else if (provider === 'msteams') {
    await sendTeamsMessage(webhookUrl, msg);
  } else {
    log.warn({ provider }, 'unknown provider — skipping dispatch');
  }
}
