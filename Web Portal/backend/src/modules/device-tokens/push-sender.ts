import type { DeviceTokenRepository } from './device-token-repository';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Payload the mobile app maps to a screen on tap (entityType/entityId → deep link). */
  data: Record<string, unknown>;
}

/** What a transport learned while sending: device tokens the provider says are dead. */
export interface PushSendResult {
  /** Tokens that are unregistered / invalid — the device uninstalled the app or the token rotated. */
  invalidTokens: string[];
}

/** Transport that actually delivers push messages (FCM / Expo Push). Injected so it's swappable + testable. */
export interface PushTransport {
  send(messages: PushMessage[]): Promise<PushSendResult | void>;
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

    let result: PushSendResult | void;
    try {
      result = await transport.send(messages);
    } catch {
      return 0; // best-effort; the in-app notification is the source of truth
    }
    // Forget tokens the provider rejected so they aren't retried on every notification.
    const dead = new Set(result?.invalidTokens ?? []);
    for (const token of dead) await deviceTokens.deleteByToken(token).catch(() => {});
    return messages.filter((m) => !dead.has(m.to)).length;
  }

  return { sendToUser };
}

export type PushSender = ReturnType<typeof createPushSender>;
