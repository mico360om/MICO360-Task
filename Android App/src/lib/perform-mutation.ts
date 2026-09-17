import { ApiError } from './api-client';
import type { ResourcesApi } from './resources';
import type { QueuedMutation } from './sync-queue';

/**
 * Replay one queued offline mutation against the API (A8). Every write the app can make offline maps
 * to a case here; an unknown kind is a permanent failure so a stale entry drains rather than wedging
 * the queue. Pure (no native imports) so the kind → resource mapping is unit-testable.
 */
export async function performMutation(resources: ResourcesApi, m: QueuedMutation): Promise<void> {
  switch (m.kind) {
    case 'task.create': {
      const p = m.payload as Parameters<ResourcesApi['tasks']['create']>[0];
      await resources.tasks.create(p);
      return;
    }
    case 'task.move': {
      const p = m.payload as { id: string; columnId: string; position?: number };
      await resources.tasks.move(p.id, p.columnId, p.position);
      return;
    }
    case 'task.update': {
      const p = m.payload as { id: string; patch: Record<string, unknown> };
      await resources.tasks.update(p.id, p.patch);
      return;
    }
    case 'task.assign': {
      const p = m.payload as { id: string; userIds: string[] };
      await resources.tasks.assign(p.id, p.userIds);
      return;
    }
    case 'task.unassign': {
      const p = m.payload as { id: string; userId: string };
      await resources.tasks.unassign(p.id, p.userId);
      return;
    }
    case 'checklist.add': {
      const p = m.payload as { id: string; text: string };
      await resources.tasks.addChecklistItem(p.id, p.text);
      return;
    }
    case 'checklist.update': {
      const p = m.payload as { itemId: string; patch: { done?: boolean; text?: string } };
      await resources.tasks.updateChecklistItem(p.itemId, p.patch);
      return;
    }
    case 'comment.add': {
      const p = m.payload as { id: string; body: string };
      await resources.tasks.addComment(p.id, p.body);
      return;
    }
    case 'notification.read': {
      const p = m.payload as { id: string };
      await resources.notifications.markRead(p.id);
      return;
    }
    case 'chat.send': {
      const p = m.payload as { conversationId: string; body: string };
      await resources.chat.send(p.conversationId, p.body);
      return;
    }
    default:
      throw new ApiError(422, 'UNKNOWN_MUTATION', `Unknown queued mutation: ${m.kind}`);
  }
}
