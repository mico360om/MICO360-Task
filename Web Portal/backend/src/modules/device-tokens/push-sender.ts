import type { DeviceTokenRepository } from './device-token-repository';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Payload the mobile app maps to a screen on tap (entityType/entityId → deep link). */
  data: Record<string, unknown>;
}

/** Transport that actually delivers push messages (FCM / Expo Push). Injected so it's swappable + testable. */
export interface PushTransport {
  send(messages: PushMessage[]): Promise<void>;
}

export interface PushNotificationInput {
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface PushSenderDeps {
  deviceTokens: DeviceTokenRepository;
  transport: PushTransport;
}

/**
 * Fans a notification out to all of a user's registered devices (A6.2, extends
 * T3.10). Push is best-effort — a transport failure is swallowed so it never
 * breaks the in-app notification write that triggered it.
 */
export function createPushSender({ deviceTokens, transport }: PushSenderDeps) {
  async function sendToUser(userId: string, notification: PushNotificationInput): Promise<number> {
    const tokens = await deviceTokens.listForUser(userId);
    if (tokens.length === 0) return 0;

    const messages: PushMessage[] = tokens.map((t) => ({
      to: t.token,
      title: notification.title,
      body: notification.body ?? '',
      data: {
        ...(notification.entityType ? { entityType: notification.entityType } : {}),
        ...(notification.entityId ? { entityId: notification.entityId } : {}),
      },
    }));

    try {
      await transport.send(messages);
      return messages.length;
    } catch {
      return 0; // best-effort; the in-app notification is the source of truth
    }
  }

  return { sendToUser };
}

export type PushSender = ReturnType<typeof createPushSender>;
