import type { DeviceTokenRepository } from './device-token-repository';

/** How a push is shown and kept on the phone (all optional: the default channel, kept until delivered). */
export interface PushDeliveryOptions {
  /** The Android notification channel (the app creates it); omitted = 'default'. */
  channelId?: string;
  /** Drop the push if it can't be delivered within this many seconds (out of date by then). */
  ttlSeconds?: number;
  /** A newer push with the same tag replaces the older one on the phone's list. */
  tag?: string;
}

export interface PushMessage extends PushDeliveryOptions {
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

export interface PushNotificationInput extends PushDeliveryOptions {
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** The stored notification this push is for: the app reads exactly that one when the push is tapped. */
  notificationId?: string | null;
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
        ...(notification.notificationId ? { notificationId: notification.notificationId } : {}),
      },
      ...(notification.channelId ? { channelId: notification.channelId } : {}),
      ...(notification.ttlSeconds ? { ttlSeconds: notification.ttlSeconds } : {}),
      ...(notification.tag ? { tag: notification.tag } : {}),
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
