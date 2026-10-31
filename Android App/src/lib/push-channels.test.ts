import { describe, it, expect } from 'vitest';
import { DEFAULT_PUSH_CHANNEL_ID, MEETING_PUSH_CHANNEL_ID, PUSH_CHANNELS } from './push-channels';
import { appSource, hasWeb, readWeb } from '../testing/web-source';
import { pushPresentation } from './chat-viewing';
import { notificationToTarget } from './deep-link';

describe('the phone’s notification channels (meeting reminders have their own)', () => {
  it('two channels: everything else, and meeting reminders — both heads-up (high importance)', () => {
    expect(DEFAULT_PUSH_CHANNEL_ID).toBe('default');
    expect(MEETING_PUSH_CHANNEL_ID).toBe('meetings');
    expect(PUSH_CHANNELS).toEqual([
      { id: 'default', name: 'MICO360 Tasks', description: null, importance: 'high' },
      { id: 'meetings', name: 'Meeting reminders', description: 'Reminders before the meetings you organize or are invited to', importance: 'high' },
    ]);
  });

  it('the phone creates every channel on launch (so a push on one shows, also when the app is closed)', () => {
    const push = appSource('adapters/push.ts');
    expect(push).toMatch(/for \(const ch of PUSH_CHANNELS\)/);
    expect(push).toMatch(/setNotificationChannelAsync\(ch\.id,/);
    expect(push).toMatch(/AndroidImportance\.HIGH/);
  });

  it.skipIf(!hasWeb('backend/src/modules/device-tokens/fcm-transport.ts'))('the server sends to the same channel ids', () => {
    const fcm = readWeb('backend/src/modules/device-tokens/fcm-transport.ts');
    expect(fcm).toContain(`export const DEFAULT_PUSH_CHANNEL = '${DEFAULT_PUSH_CHANNEL_ID}';`);
    expect(fcm).toContain(`export const MEETING_PUSH_CHANNEL = '${MEETING_PUSH_CHANNEL_ID}';`);
  });
});

describe('a meeting reminder push on the phone', () => {
  const data = { entityType: 'meeting', entityId: 'm1', notificationId: 'n7' };
  it('shows with its sound while the app is open, whatever screen is open', () => {
    expect(pushPresentation(data, null)).toEqual({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false });
    expect(pushPresentation(data, 'c1')).toMatchObject({ shouldShowAlert: true });
  });
  it('a tap opens the meeting (also when the tap started the app)', () => {
    expect(notificationToTarget(data)).toEqual({ screen: 'MeetingDetail', params: { meetingId: 'm1' } });
  });
});
