/** Task 20: chat, notifications, account and sign-in in the new look (source text: the screens need React Native). */
import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';
import { receiptText } from '../lib/chat-ui';

it('sign-in shows the logo for the theme', () => {
  const s = src('screens/auth/LoginScreen.tsx');
  expect(s).toContain('<BrandLogo');
  expect(s).not.toMatch(/assets\/logo\.png/);
});

it('message ticks are drawn icons', () => {
  expect(receiptText({ status: 'sent' })).toEqual({ label: 'Sent', ticks: 'ui.tick' });
  expect(receiptText({ status: 'read', seenBy: 3 })).toEqual({ label: 'Seen by 3', ticks: 'ui.tickDouble', seenBy: 3, read: true });
  expect(receiptText({ status: 'failed' }).ticks).toBeNull();
  expect(receiptText({ status: 'delivered' })).toEqual({ label: 'Delivered', ticks: 'ui.tickDouble' });
  expect(receiptText({ status: 'sending' })).toEqual({ label: 'Sending', ticks: null });
  // The bubble draws them, and the number of people beside them is text.
  expect(src('components/chat/MessageParts.tsx')).toMatch(/<Icon name=\{receipt\.ticks\}/);
});

it('the profile shows the shared avatar and settings use Toggles', () => {
  expect(src('screens/ProfileScreen.tsx')).toMatch(/<Avatar [^>]*size="xl"/); // the website's Profile size (final review 17)
  expect(src('screens/SettingsScreen.tsx')).not.toMatch(/\bSwitch\b/);
});

it('the new-messages pill points down with a drawn arrow', () => expect(src('screens/ChatThreadScreen.tsx')).toMatch(/name="ui\.arrowDown"/));

it('Search rows lead with their group’s icon', () => {
  const s = src('screens/SearchScreen.tsx');
  for (const icon of ['kit.task', 'nav.projects', 'kit.user', 'nav.meetings', 'kit.globe']) expect(s, icon).toContain(`'${icon}'`);
});

it('the lock screen draws the lock; the push channel takes the brand colour from the palette', () => {
  expect(src('components/LockGate.tsx')).toMatch(/<Icon name="kit\.lock"/);
  expect(src('adapters/push.ts')).toMatch(/lightColor: lightColors\.brand/);
});
