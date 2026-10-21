/**
 * What was typed in a conversation and not sent yet, and the messages the server refused — kept per
 * conversation for the person who wrote them, so going Back, opening another conversation from an
 * alert, or coming back later doesn't lose them (as on the web). They live in memory-only storage
 * (chrome.storage.session): gone when the browser closes, on sign-out, and when someone else signs
 * in (src/session.js). Files are never kept: only text.
 */
export const CHAT_DRAFTS_KEY = 'mico360.chatDrafts';
/** Conversations kept at most (the least recently changed go first). */
const MAX_CONVERSATIONS = 50;
/** Longest text kept (a message can be up to 4,000 characters; a little more is kept to say so). */
const MAX_TEXT = 20000;

const text = (v) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');

function cleanFailed(list) {
  return (Array.isArray(list) ? list : [])
    .filter((f) => f && typeof f.clientId === 'string' && f.clientId)
    .map((f) => ({ clientId: f.clientId, body: text(f.body), createdAt: f.createdAt || null, error: typeof f.error === 'string' ? f.error : '' }));
}

/**
 * The store for `userId` in `area` (chrome.storage.session, or a stand-in): `get(conversationId)`
 * → `{ draft, failed }`, `setDraft(conversationId, text)`, `setFailed(conversationId, list)`.
 * Writes go one after another, so quick ones don't undo each other. Best effort: storage that can't
 * be written keeps nothing.
 */
export function createChatDrafts(area, userId) {
  let chain = Promise.resolve();

  async function readAll() {
    try {
      const v = ((await area.get(CHAT_DRAFTS_KEY)) || {})[CHAT_DRAFTS_KEY];
      return v && v.userId === userId && v.conversations && typeof v.conversations === 'object' ? v.conversations : {};
    } catch {
      return {};
    }
  }

  function change(conversationId, patch) {
    const run = chain.then(async () => {
      const all = { ...(await readAll()) };
      const next = { ...(all[conversationId] || {}), ...patch, at: Date.now() };
      if (!next.draft && !(next.failed && next.failed.length)) delete all[conversationId];
      else all[conversationId] = next;
      const kept = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_CONVERSATIONS);
      try {
        await area.set({ [CHAT_DRAFTS_KEY]: { userId, conversations: Object.fromEntries(kept) } });
      } catch {
        /* not kept: the screen still has it */
      }
    });
    chain = run.catch(() => undefined);
    return run;
  }

  return {
    async get(conversationId) {
      await chain;
      const c = (await readAll())[conversationId] || {};
      return { draft: text(c.draft), failed: cleanFailed(c.failed) };
    },
    setDraft: (conversationId, value) => change(conversationId, { draft: text(value) }),
    setFailed: (conversationId, list) => change(conversationId, { failed: cleanFailed(list) }),
  };
}
