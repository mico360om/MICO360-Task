/**
 * The phone's Android notification channels. The server names one in every push
 * (`android.notification.channel_id`, see the website's fcm-transport.ts): meeting reminders have
 * their own, so they can sound and be set apart from the rest in the phone's settings. Both are
 * heads-up (high importance). They are created on every launch (adapters/push), so a push that
 * arrives while the app is closed or in the background is shown on its channel.
 */
export const DEFAULT_PUSH_CHANNEL_ID = 'default';
export const MEETING_PUSH_CHANNEL_ID = 'meetings';

export interface PushChannel {
  id: string;
  /** What the phone's settings call it. */
  name: string;
  description: string | null;
  importance: 'high';
}

export const PUSH_CHANNELS: readonly PushChannel[] = [
  { id: DEFAULT_PUSH_CHANNEL_ID, name: 'MICO360 Tasks', description: null, importance: 'high' },
  { id: MEETING_PUSH_CHANNEL_ID, name: 'Meeting reminders', description: 'Reminders before the meetings you organize or are invited to', importance: 'high' },
];
