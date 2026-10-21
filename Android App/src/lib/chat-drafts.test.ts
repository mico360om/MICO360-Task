import { describe, it, expect } from 'vitest';
import { createChatDrafts } from './chat-drafts';
import { createReadCache } from './read-cache';
import { createMemoryStore } from './storage';

describe('a message typed and not sent stays for its conversation, on this phone (3b)', () => {
  it('comes back when the conversation is opened again; an empty box forgets it', async () => {
    const store = createMemoryStore();
    const drafts = createChatDrafts({ store, getUserId: () => 'u1' });
    await drafts.save('c1', 'Half a thought');
    await drafts.save('c2', 'Another');
    expect(await drafts.load('c1')).toBe('Half a thought');
    expect(await drafts.load('c3')).toBe('');
    await drafts.save('c1', '   ');
    expect(await drafts.load('c1')).toBe('');
    expect(await drafts.load('c2')).toBe('Another');
  });

  it('is one person’s: another person signed in on the phone never sees it, and nothing is kept signed out', async () => {
    const store = createMemoryStore();
    let user: string | null = 'u1';
    const drafts = createChatDrafts({ store, getUserId: () => user });
    await drafts.save('c1', 'Mine');
    user = 'u2';
    expect(await drafts.load('c1')).toBe('');
    user = null;
    await drafts.save('c1', 'nobody');
    expect(await drafts.load('c1')).toBe('');
  });

  it('goes at sign-out with the rest of the phone’s copy', async () => {
    const store = createMemoryStore();
    const drafts = createChatDrafts({ store, getUserId: () => 'u1' });
    await drafts.save('c1', 'Private words');
    await createReadCache({ store, getUserId: () => 'u1' }).clear();
    expect(await drafts.load('c1')).toBe('');
  });
});
