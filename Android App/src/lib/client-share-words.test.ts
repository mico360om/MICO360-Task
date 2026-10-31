import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, normalise, readWeb } from '../testing/web-source';
import { websiteSays } from '../testing/phone-words';
import { SHARE_ACTION_LABEL, SHARE_WORDS, checkShare, removeTitle, shareNotice, shareSeen } from './client-share-words';
import type { ClientShare } from './client-share';

/** The Share with client panel's words and rules (Stage 4 Task 17). */
const SHARE: ClientShare = { id: 's1', name: 'Sam Lee', email: 'sam@client.com', createdAt: '2026-10-20T06:00:00Z', linkSentAt: null, lastViewedAt: null };
const PANEL = 'frontend/src/components/client-share/ClientSharePanel.tsx';

describe.skipIf(!hasWeb(PANEL, 'frontend/src/pages/ProjectDetailPage.tsx'))('the website’s panel', () => {
  it('the project header’s action is named as the website’s', () => expect(readWeb('frontend/src/pages/ProjectDetailPage.tsx')).toContain(`title="${SHARE_ACTION_LABEL}"`));
  it('says what Resend does in the 1.19 words', () => expect(normalise(readWeb(PANEL)).replace(/\s+/g, ' ')).toContain(SHARE_WORDS.resendExplains));
  it('every word is the website’s', () => {
    const web = readWeb(PANEL);
    // websiteSays reads the text between tags; a word in an attribute (title) is read as written.
    for (const [k, v] of Object.entries(SHARE_WORDS)) expect(websiteSays(web, v) || web.includes(`"${v}"`), k).toBe(true);
  });
});

it('the 1.19 Resend sentence, exactly', () => expect(SHARE_WORDS.resendExplains).toBe('Resend emails a new link. The old link stops working, and devices signed in with it are signed out.'));

it('checks, notices and the last-looked line', () => {
  expect(checkShare(' ', 'a@b.co')).toEqual({ field: 'name', message: 'Enter the client’s name.' });
  expect(checkShare('Sam', 'sam@')).toEqual({ field: 'email', message: 'Enter a valid email address.' });
  expect(checkShare('Sam', ' sam@client.com ')).toBeNull();
  expect(shareNotice('added', { name: 'Sam', email: 'sam@client.com' })).toBe('Invitation sent to sam@client.com.');
  expect(shareNotice('resent', { name: 'Sam', email: 'sam@client.com' })).toBe('A new link was sent to sam@client.com. The old link no longer works, and devices signed in with it were signed out.');
  expect(shareNotice('removed', { name: 'Sam', email: 'sam@client.com' })).toBe('Sam can no longer view this project.');
  expect(shareSeen({ ...SHARE, lastViewedAt: null, linkSentAt: '2026-10-30T06:00:00Z' }, 'Asia/Muscat')).toBe('Not viewed yet · Link sent 30 Oct 2026');
  expect(shareSeen({ ...SHARE, lastViewedAt: '2026-10-30T06:00:00Z', linkSentAt: null }, 'Asia/Muscat', Date.parse('2026-10-30T09:00:00Z'))).toBe('Last viewed 3h ago');
  // The company's calendar day: 21:30 UTC on the 29th is already the 30th in Muscat.
  expect(shareSeen({ ...SHARE, linkSentAt: '2026-10-29T21:30:00Z' }, 'Asia/Muscat')).toBe('Not viewed yet · Link sent 30 Oct 2026');
  expect(removeTitle('Sam')).toBe('Remove Sam’s access?');
});

it('the panel is read-only for an archived project and Resend explains itself', () => {
  const s = src('screens/ClientShareScreen.tsx');
  expect(s).toMatch(/archived \?[^:]*SHARE_WORDS\.archived/);
  expect(s).toMatch(/accessibilityHint=\{SHARE_WORDS\.resendExplains\}/);
  expect(s).toMatch(/!archived && shares\.length > 0/);
  expect(s).toMatch(/disabled=\{[^}]*emailEnabled === false/);
});

it('only the people who run the project see Share with client', () => expect(src('screens/ProjectDetailScreen.tsx')).toMatch(/canManageProject\(user, project, members\)[^]*navigate\('ClientShare'/));

it('the panel has its own screen, named as the website’s dialog', () => {
  expect(src('navigation/types.ts')).toMatch(/ClientShare: \{ projectId: string; projectName\?: string \};/);
  expect(src('navigation/RootNavigator.tsx')).toMatch(/name="ClientShare" component=\{ClientShareScreen\} options=\{\{ title: 'Share with client' \}\}/);
  const q = src('core/client-share-queries.ts');
  expect(q).toMatch(/queryKey: \['client-shares', projectId\]/);
  expect(q).toMatch(/add\(projectId, input, key\)/);
});
