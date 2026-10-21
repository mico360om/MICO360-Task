import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import {
  conversationSubtitle,
  directWith,
  dmCandidates,
  fileProblem,
  linkParts,
  listTime,
  memberRows,
  pickedFile,
  prefsFailure,
  prefsMenu,
  receiptText,
  startDirectError,
  uploadFailure,
  withPrefs,
} from './chat-ui';
import type { ApiConversationSummary, ApiDirectoryUser } from './types';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const user = (id: string, first: string, last: string, over: Partial<ApiDirectoryUser> = {}): ApiDirectoryUser => ({ id, username: first.toLowerCase(), firstName: first, lastName: last, ...over });
const directory = [
  user('me', 'Khurram', 'Shah'),
  user('u2', 'Sara', 'Ali', { lastActiveAt: '2026-10-21T11:50:00.000Z' }),
  user('u3', 'Omar', 'Said'),
  user('u4', 'Old', 'Account', { active: false }),
  user('u5', 'Aisha', 'Noor'),
];
const dm = (id: string, other: string, over: Partial<ApiConversationSummary> = {}): ApiConversationSummary => ({
  conversation: { id, kind: 'DIRECT', projectId: null, createdAt: '' },
  participants: [
    { conversationId: id, userId: 'me', lastReadAt: null, addedAt: '' },
    { conversationId: id, userId: other, lastReadAt: null, addedAt: '' },
  ],
  unread: 0,
  lastMessage: null,
  ...over,
});

describe('New direct message: the people picker (3b)', () => {
  it('offers active people other than me, by name, and finds them by name or username', () => {
    expect(dmCandidates(directory, 'me', '').map((p) => p.id)).toEqual(['u5', 'u3', 'u2']);
    expect(dmCandidates(directory, 'me', 'sa').map((p) => p.id)).toEqual(['u3', 'u2']);
    expect(dmCandidates(directory, 'me', 'aisha').map((p) => p.label)).toEqual(['Aisha Noor']);
    expect(dmCandidates(directory, 'me', 'old')).toEqual([]);
    expect(dmCandidates(directory, 'me', '')[0]).toEqual({ id: 'u5', label: 'Aisha Noor', hint: '@aisha' });
  });
  it('says why a conversation couldn’t be started: it needs a connection, or the server’s reason', () => {
    expect(startDirectError(new NetworkError('offline'), 'Sara Ali')).toBe('Couldn’t start a conversation with Sara Ali — you’re offline. Try again when connected.');
    expect(startDirectError(new ApiError(404, 'NOT_FOUND', 'User not found.'), 'Sara Ali')).toBe('Couldn’t start a conversation with Sara Ali. User not found.');
    expect(startDirectError(new ApiError(500, 'ERROR', 'Request failed (500)'), 'Sara Ali')).toBe('Couldn’t start a conversation with Sara Ali.');
  });

  it('opens the conversation with them that already exists', () => {
    const inbox = [dm('d1', 'u2'), dm('d2', 'u3')];
    expect(directWith(inbox, 'me', 'u3')).toBe('d2');
    expect(directWith(inbox, 'me', 'u5')).toBeNull();
    expect(directWith(undefined, 'me', 'u2')).toBeNull();
  });
});

describe('a conversation’s members and its header line (3b)', () => {
  it('lists me first, then who is online, then by name — each with when they were last active', () => {
    const rows = memberRows(['u3', 'me', 'u2'], directory, 'me', (id) => id === 'u3', NOW);
    expect(rows.map((r) => [r.name, r.me, r.online, r.presence])).toEqual([
      ['Khurram Shah', true, true, 'Active now'],
      ['Omar Said', false, true, 'Active now'],
      ['Sara Ali', false, false, 'Last active 10m ago'],
    ]);
  });
  it('a direct conversation says when the other person was last active; a channel how many are in it and online', () => {
    expect(conversationSubtitle({ kind: 'DIRECT', partner: directory[1]!, online: false, members: [], now: NOW })).toBe('Last active 10m ago');
    expect(conversationSubtitle({ kind: 'DIRECT', partner: directory[1]!, online: true, members: [], now: NOW })).toBe('Active now');
    const members = memberRows(['me', 'u2', 'u3'], directory, 'me', (id) => id === 'u3', NOW);
    expect(conversationSubtitle({ kind: 'PROJECT', members, online: false, now: NOW })).toBe('Project channel · 3 members · 1 online');
    expect(conversationSubtitle({ kind: 'PROJECT', members: [], online: false, now: NOW })).toBe('Project channel');
  });
});

describe('my settings for a conversation: favorite, mute, archive (3b)', () => {
  it('offers each the way round it is, in the website’s words', () => {
    expect(prefsMenu({ favorite: false, muted: false, archived: false }).map((i) => i.label)).toEqual(['Add to favorites', 'Mute notifications', 'Archive']);
    expect(prefsMenu({ favorite: true, muted: true, archived: true }).map((i) => [i.label, i.patch])).toEqual([
      ['Remove from favorites', { favorite: false }],
      ['Unmute notifications', { muted: false }],
      ['Move out of archive', { archived: false }],
    ]);
  });
  it('shows a change at once in the list (a channel not in it yet is added)', () => {
    const inbox = [dm('d1', 'u2')];
    const next = withPrefs(inbox, { id: 'd1', kind: 'DIRECT' }, { muted: true });
    expect(next[0]!.prefs).toEqual({ favorite: false, archived: false, muted: true });
    const added = withPrefs(inbox, { id: 'ch9', kind: 'PROJECT', projectId: 'p9' }, { favorite: true });
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ conversation: { id: 'ch9', kind: 'PROJECT', projectId: 'p9' }, prefs: { favorite: true, archived: false, muted: false }, unread: 0 });
  });
  it('says plainly when it needs a connection, or why the server said no', () => {
    expect(prefsFailure(new NetworkError('offline'))).toBe('Changing this needs a connection. Try again when you’re online.');
    expect(prefsFailure(new ApiError(403, 'FORBIDDEN', 'You do not have access to this conversation.'))).toBe('Couldn’t change that setting. You do not have access to this conversation.');
    expect(prefsFailure(new ApiError(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t change that setting.');
  });
});

describe('web addresses in a message open in the browser (3b, the website’s linkify)', () => {
  it('finds http(s) addresses, leaving the sentence’s own punctuation outside the link', () => {
    expect(linkParts('See https://x.co/a, then (https://y.org/b).')).toEqual([
      { text: 'See ', url: null },
      { text: 'https://x.co/a', url: 'https://x.co/a' },
      { text: ', then (', url: null },
      { text: 'https://y.org/b', url: 'https://y.org/b' },
      { text: ').', url: null },
    ]);
    expect(linkParts('no links here')).toEqual([{ text: 'no links here', url: null }]);
    expect(linkParts('javascript:alert(1) ftp://x')).toEqual([{ text: 'javascript:alert(1) ftp://x', url: null }]);
  });
});

describe('when a conversation’s last message came, in the list (3b, the website’s words)', () => {
  it('the time today, "Yesterday", the weekday this week, else the date', () => {
    const now = new Date(2026, 9, 21, 15, 0);
    expect(listTime(new Date(2026, 9, 21, 9, 5).toISOString(), now)).toMatch(/09.05|9.05/);
    expect(listTime(new Date(2026, 9, 20, 9, 5).toISOString(), now)).toBe('Yesterday');
    expect(listTime(new Date(2026, 9, 17, 9, 5).toISOString(), now)).toMatch(/Sat/);
    expect(listTime(new Date(2026, 8, 2, 9, 5).toISOString(), now)).toMatch(/Sep/);
  });
});

describe('receipts, and files picked to send (3b)', () => {
  it('says where my message stands, in the website’s words, with its ticks', () => {
    expect(receiptText({ status: 'sent' })).toEqual({ label: 'Sent', ticks: '✓' });
    expect(receiptText({ status: 'delivered' })).toEqual({ label: 'Delivered', ticks: '✓✓' });
    expect(receiptText({ status: 'read' })).toEqual({ label: 'Read', ticks: '✓✓' });
    expect(receiptText({ status: 'read', seenBy: 3 })).toEqual({ label: 'Seen by 3', ticks: '✓✓ 3' });
    expect(receiptText({ status: 'sending' })).toEqual({ label: 'Sending', ticks: '' });
  });
  it('reads a picked file (its type from its name when the picker gives none), and why an upload failed', () => {
    expect(pickedFile({ uri: 'file:///a.JPG', name: 'a.JPG', size: 1200, mimeType: null })).toEqual({ uri: 'file:///a.JPG', name: 'a.JPG', size: 1200, type: 'image/jpeg' });
    // A size the picker doesn't know is unknown (the server checks it), not "empty".
    expect(pickedFile({ uri: 'file:///b', name: 'notes.txt', size: undefined, mimeType: 'text/plain' })).toEqual({ uri: 'file:///b', name: 'notes.txt', size: null, type: 'text/plain' });
    expect(fileProblem({ name: 'notes.txt', size: null, type: 'text/plain' })).toBeNull();
    expect(fileProblem({ name: 'x.exe', size: null, type: 'application/x-msdownload' })).toMatch(/can’t be sent/);
    expect(fileProblem({ name: 'e.txt', size: 0, type: 'text/plain' })).toBe('“e.txt” is empty.');
    expect(uploadFailure(new NetworkError('offline'))).toBe('You’re offline — files can be sent when you’re connected.');
    expect(uploadFailure(new ApiError(400, 'VALIDATION', 'The file content does not match its type.'))).toBe('The file content does not match its type.');
    expect(uploadFailure(new ApiError(500, 'ERROR', 'Request failed (500)'))).toBe('The server couldn’t save the file. Please try again in a moment.');
  });
});
