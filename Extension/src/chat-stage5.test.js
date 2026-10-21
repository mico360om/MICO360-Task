import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  inboxSections, previewOf, needsDeliveryAck, mergeMessages, validateAttachment, formatSize, ALLOWED_TYPES, MAX_UPLOAD_BYTES,
  MAX_MESSAGE_LENGTH, CHAT_PAGE_SIZE, hasOlderPage, placeholderFor, reactionLabel, NO_PREFS,
} from './chat.js';

// Stage 5: chat the way the web shows it (Web Portal/frontend/src/lib/chat-model.ts) — the sidebar's
// sections with favorites and the archive, a conversation's one-line preview, when to tell the server
// a direct message has arrived, pages of history merged with messages on their way, and which files
// can be sent.

const summary = (over = {}) => ({
  conversation: { id: 'c1', kind: 'DIRECT', projectId: null, createdAt: '2026-10-01T08:00:00Z', ...over.conversation },
  participants: over.participants ?? [{ conversationId: 'c1', userId: 'me', lastReadAt: null, addedAt: '2026-10-01T08:00:00Z', lastDeliveredAt: null }, { conversationId: 'c1', userId: 'omar', lastReadAt: null, addedAt: '2026-10-01T08:00:00Z' }],
  unread: over.unread ?? 0,
  lastMessage: over.lastMessage === undefined ? null : over.lastMessage,
  ...(over.prefs ? { prefs: over.prefs } : {}),
});
const msg = (id, at, over = {}) => ({ id, conversationId: 'c1', userId: 'omar', body: `m ${id}`, editedAt: null, deletedAt: null, createdAt: at, reactions: [], attachments: [], ...over });
const names = { me: 'Mariam Al Hinai', omar: 'Omar Ahmed', aisha: 'Aisha Khan' };
const nameOf = (id) => names[id] || 'Someone';

describe('the inbox: favorites, project channels, direct messages and the archive', () => {
  it('every project gets a channel (opened or not), most recent first; favorites and archived ones apart', () => {
    const inbox = [
      summary({ conversation: { id: 'ch1', kind: 'PROJECT', projectId: 'p1' }, unread: 2, lastMessage: msg('a', '2026-10-20T09:00:00Z') }),
      summary({ conversation: { id: 'd1' }, lastMessage: msg('b', '2026-10-21T09:00:00Z'), prefs: { favorite: true, archived: false, muted: false } }),
      summary({ conversation: { id: 'd2' }, participants: [{ userId: 'me' }, { userId: 'aisha' }], lastMessage: msg('c', '2026-10-19T09:00:00Z', { userId: 'aisha' }), prefs: { favorite: false, archived: true, muted: true }, unread: 3 }),
    ];
    const s = inboxSections({ inbox, projects: [{ id: 'p1', name: 'Rig' }, { id: 'p2', name: 'Office' }], myId: 'me', nameOf, query: '' });
    expect(s.favorites.map((r) => r.title)).toEqual(['Omar Ahmed']);
    expect(s.channels.map((r) => [r.title, r.conversationId, r.unread])).toEqual([['Rig', 'ch1', 2], ['Office', null, 0]]);
    expect(s.directs).toEqual([]);
    expect(s.archived.map((r) => r.title)).toEqual(['Aisha Khan']);
    expect(s.archivedUnread).toBe(3);
    expect(s.archived[0].prefs).toEqual({ favorite: false, archived: true, muted: true });
    expect(s.channels[1].prefs).toEqual(NO_PREFS); // an older server sends no prefs: all off
  });

  it('a conversation’s one line: who wrote it in a channel, “You:” for your own, a file’s name, never a deleted message', () => {
    expect(previewOf(msg('a', '2026-10-20T09:00:00Z', { body: 'Pump  is\nfixed' }), { myId: 'me', kind: 'PROJECT', nameOf })).toBe('Omar: Pump is fixed');
    expect(previewOf(msg('a', '2026-10-20T09:00:00Z', { userId: 'me', body: 'On my way' }), { myId: 'me', kind: 'DIRECT', nameOf })).toBe('You: On my way');
    expect(previewOf(msg('a', '2026-10-20T09:00:00Z', { body: '', attachments: [{ fileName: 'gauge.png' }] }), { myId: 'me', kind: 'DIRECT', nameOf })).toBe('📎 gauge.png');
    expect(previewOf(msg('a', '2026-10-20T09:00:00Z', { deletedAt: '2026-10-20T10:00:00Z', body: 'secret' }), { myId: 'me', kind: 'DIRECT', nameOf })).toBe('Message deleted');
    expect(previewOf(null, { myId: 'me', kind: 'DIRECT', nameOf })).toBe('');
  });

  it('tells the server a direct message has arrived only for someone else’s newest message it hasn’t heard about', () => {
    const last = msg('a', '2026-10-20T09:00:00Z');
    expect(needsDeliveryAck(summary({ lastMessage: last }), 'me')).toBe(true);
    expect(needsDeliveryAck(summary({ lastMessage: { ...last, userId: 'me' } }), 'me')).toBe(false);
    expect(needsDeliveryAck(summary({ lastMessage: last, participants: [{ userId: 'me', lastDeliveredAt: '2026-10-20T09:00:00Z', lastReadAt: null }] }), 'me')).toBe(false);
    expect(needsDeliveryAck(summary({ lastMessage: last, participants: [{ userId: 'me', lastReadAt: '2026-10-20T09:05:00Z' }] }), 'me')).toBe(false);
    expect(needsDeliveryAck(summary({ conversation: { kind: 'PROJECT', projectId: 'p1' }, lastMessage: last }), 'me')).toBe(false);
  });
});

describe('pages of history and messages on their way', () => {
  it('pages (newest first) come out oldest first without repeats; a message on its way shows until the server has it (same clientId)', () => {
    const newest = [msg('3', '2026-10-20T09:03:00Z'), msg('4', '2026-10-20T09:04:00Z', { userId: 'me', clientId: 'k1' })];
    const older = [msg('1', '2026-10-20T09:01:00Z'), msg('2', '2026-10-20T09:02:00Z'), msg('3', '2026-10-20T09:03:00Z')];
    const pending = [
      { clientId: 'k1', conversationId: 'c1', body: 'm 4', createdAt: '2026-10-20T09:04:00Z', state: 'sending', replyTo: null, files: [] },
      { clientId: 'k2', conversationId: 'c1', body: '', createdAt: '2026-10-20T09:05:00Z', state: 'failed', error: 'Too large', replyTo: null, files: [{ name: 'big.zip', size: 5, type: 'application/zip', progress: 0 }] },
    ];
    const shown = mergeMessages([newest, older], pending, 'me');
    expect(shown.map((m) => m.id)).toEqual(['1', '2', '3', '4', 'pending-k2']);
    expect(shown[4]).toMatchObject({ userId: 'me', pending: 'failed', error: 'Too large', pendingFiles: pending[1].files });
  });

  it('a full page means there may be older messages', () => {
    expect(CHAT_PAGE_SIZE).toBe(50);
    expect(hasOlderPage(Array.from({ length: 50 }, (_, i) => i))).toBe(true);
    expect(hasOlderPage(Array.from({ length: 49 }, (_, i) => i))).toBe(false);
    expect(hasOlderPage(null)).toBe(false);
  });
});

describe('files that can be sent', () => {
  it('pictures, PDFs, text, CSV, ZIP and Office files up to 10 MB — anything else says why', () => {
    expect(validateAttachment({ name: 'gauge.png', size: 2048, type: 'image/png' })).toBeNull();
    expect(validateAttachment({ name: 'empty.txt', size: 0, type: 'text/plain' })).toBe('“empty.txt” is empty.');
    expect(validateAttachment({ name: 'film.mp4', size: 2048, type: 'video/mp4' })).toBe('“film.mp4” can’t be sent: only pictures, PDFs, text, CSV, ZIP and Word / Excel / PowerPoint files are allowed.');
    expect(validateAttachment({ name: 'big.pdf', size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf' })).toBe('“big.pdf” is 10 MB — files can be up to 10 MB.');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});

describe('the words around a conversation', () => {
  it('the message box says where it goes', () => {
    expect(placeholderFor('PROJECT', 'Rig Inspection')).toBe('Message #⁨Rig Inspection⁩');
    expect(placeholderFor('DIRECT', 'Omar Ahmed')).toBe('Message ⁨Omar Ahmed⁩');
  });

  it('a reaction says who reacted', () => {
    expect(reactionLabel({ emoji: '👍', userIds: ['me', 'omar'] }, { myId: 'me', nameOf })).toBe('👍 2: You and Omar Ahmed');
    expect(reactionLabel({ emoji: '🎉', userIds: ['omar', 'aisha', 'x'] }, { myId: 'me', nameOf })).toBe('🎉 3: Omar Ahmed, Aisha Khan and Someone');
  });
});

// The copy can't be compared as text: both run over the same inputs (skipped where the website
// isn't checked out next to the extension).
const repo = resolve(__dirname, '../..');
const WEB_CHAT = resolve(repo, 'Web Portal/frontend/src/lib/chat-model.ts');
const web = existsSync(WEB_CHAT) ? await import(pathToFileURL(WEB_CHAT).href) : null;

describe.skipIf(!web)('chat: src/chat.js matches the web (lib/chat-model.ts)', () => {
  it('the same limits and file types', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(web.MAX_MESSAGE_LENGTH);
    expect(MAX_UPLOAD_BYTES).toBe(web.MAX_UPLOAD_BYTES);
    expect([...ALLOWED_TYPES].sort()).toEqual([...web.ALLOWED_TYPES].sort());
  });

  it('the same files refused, with the same words, and the same sizes', () => {
    const files = [
      { name: 'a.png', size: 1, type: 'image/png' }, { name: 'b.txt', size: 0, type: 'text/plain' }, { name: 'c.mp4', size: 10, type: 'video/mp4' },
      { name: 'd.pdf', size: MAX_UPLOAD_BYTES, type: 'application/pdf' }, { name: 'e.pdf', size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf' },
      { name: 'f.zip', size: 50 * 1024 * 1024, type: 'application/zip' }, { name: 'g.svg', size: 10, type: 'image/svg+xml' }, { name: 'h', size: 10, type: '' },
    ];
    for (const f of files) expect(validateAttachment(f), f.name).toBe(web.validateAttachment(f));
    for (const n of [0, 1, 1023, 1024, 1536, 1024 * 1024 - 1, 1024 * 1024, 3.5 * 1024 * 1024, 10 * 1024 * 1024, 123456789]) expect(formatSize(n), String(n)).toBe(web.formatSize(n));
  });

  it('the same sections, previews and delivery reports', () => {
    const inbox = [
      summary({ conversation: { id: 'ch1', kind: 'PROJECT', projectId: 'p1' }, unread: 2, lastMessage: msg('a', '2026-10-20T09:00:00Z') }),
      summary({ conversation: { id: 'ch2', kind: 'PROJECT', projectId: 'p2' }, lastMessage: msg('a2', '2026-10-21T09:00:00Z'), prefs: { favorite: true, archived: false, muted: false } }),
      summary({ conversation: { id: 'd1' }, lastMessage: msg('b', '2026-10-21T09:00:00Z', { body: '' , attachments: [{ fileName: 'x.pdf' }] }) }),
      summary({ conversation: { id: 'd2', createdAt: '2026-10-22T00:00:00Z' }, participants: [{ userId: 'me' }, { userId: 'aisha' }], lastMessage: null, prefs: { favorite: false, archived: true, muted: true }, unread: 1 }),
      summary({ conversation: { id: 'd3' }, participants: [{ userId: 'me', lastReadAt: '2026-10-21T10:00:00Z' }, { userId: 'omar' }], lastMessage: msg('z', '2026-10-21T09:30:00Z', { deletedAt: '2026-10-21T09:31:00Z' }) }),
    ];
    const projects = [{ id: 'p1', name: 'Rig' }, { id: 'p2', name: 'Office' }, { id: 'p3', name: 'مشروع' }];
    for (const query of ['', 'om', 'RIG', 'مش', 'zzz']) {
      expect(inboxSections({ inbox, projects, myId: 'me', nameOf, query }), query).toEqual(web.inboxSections({ inbox, projects, myId: 'me', nameOf, query }));
    }
    for (const s of inbox) {
      for (const kind of ['PROJECT', 'DIRECT']) expect(previewOf(s.lastMessage, { myId: 'me', kind, nameOf })).toBe(web.previewOf(s.lastMessage, { myId: 'me', kind, nameOf }));
      expect(needsDeliveryAck(s, 'me')).toBe(web.needsDeliveryAck(s, 'me'));
    }
  });

  it('the same history merge', () => {
    const newest = [msg('3', '2026-10-20T09:03:00Z'), msg('4', '2026-10-20T09:04:00Z', { userId: 'me', clientId: 'k1' })];
    const older = [msg('1', '2026-10-20T09:01:00Z'), msg('3', '2026-10-20T09:03:00Z')];
    const pending = [
      { clientId: 'k1', conversationId: 'c1', body: 'm 4', createdAt: '2026-10-20T09:04:00Z', state: 'sending', replyTo: null, files: [] },
      { clientId: 'k2', conversationId: 'c1', body: 'later', createdAt: '2026-10-20T09:05:00Z', state: 'queued', replyTo: null, files: [] },
    ];
    expect(mergeMessages([newest, older], pending, 'me')).toEqual(web.mergeMessages([newest, older], pending, 'me'));
  });
});
