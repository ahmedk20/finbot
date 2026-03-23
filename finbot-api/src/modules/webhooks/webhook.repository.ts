import { prisma }     from '../../shared/db/postgres.client';
import { prismaRead } from '../../shared/db/postgres.read';
import type { WebhookRecord, WebhookEvent } from './webhook.types';

export async function createWebhook(data: {
  userId:    string;
  url:       string;
  asset?:    string;
  event:     WebhookEvent;
  threshold?: number;
  secret:    string;
}): Promise<WebhookRecord> {
  return prisma.webhook.create({ data }) as Promise<WebhookRecord>;
}

export async function listWebhooks(userId: string): Promise<WebhookRecord[]> {
  return prismaRead.webhook.findMany({
    where:   { userId, active: true },
    orderBy: { createdAt: 'desc' },
  }) as Promise<WebhookRecord[]>;
}

export async function deleteWebhook(id: string, userId: string): Promise<boolean> {
  const result = await prisma.webhook.updateMany({
    where:  { id, userId },
    data:   { active: false },  // soft delete — keep for audit trail
  });
  return result.count > 0;
}

export async function findMatchingWebhooks(asset: string, event: WebhookEvent): Promise<WebhookRecord[]> {
  return prismaRead.webhook.findMany({
    where: {
      active: true,
      event,
      OR: [
        { asset },             // exact asset match
        { asset: null },       // null = all assets
      ],
    },
  }) as Promise<WebhookRecord[]>;
}
