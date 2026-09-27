/**
 * Pure chat helpers for the extension popup + service worker. Framework-free and testable.
 * The popup fetches `/conversations` (inbox summaries) and `/users/directory`; these turn
 * that raw data into display rows and an unread total for the toolbar badge.
 */

/** Inbox preview shown for a conversation whose latest message was deleted. */
export const DELETED_PREVIEW = 'Message deleted';

/**
 * A chat message that is safe to store and show: a deleted message keeps no text and no
 * attachments (CHAT-01), whatever an older server sent. Applied before anything is cached.
 */
export function sanitizeMessage(m) {
  if (!m || !m.deletedAt) return m;
  return { ...m, body: '', attachments: [] };
}

export function sanitizeMessages(list) {
  return Array.isArray(list) ? list.map(sanitizeMessage) : list;
}

/** Inbox summaries with each `lastMessage` sanitized. */
export function sanitizeSummaries(list) {
  return Array.isArray(list)
    ? list.map((s) => (s && s.lastMessage ? { ...s, lastMessage: sanitizeMessage(s.lastMessage) } : s))
    : list;
}

/** One-line inbox preview of a conversation's latest message — never a deleted message's text. */
export function messagePreview(m) {
  if (!m) return '';
  if (m.deletedAt) return DELETED_PREVIEW;
  return m.body || '';
}

/** Total unread messages across all of the user's conversations (for the badge). */
export function unreadTotal(summaries) {
  return (summaries ?? []).reduce((sum, s) => sum + (s?.unread || 0), 0);
}

/**
 * Turn inbox summaries into compact display rows, most-unread first.
 * @param summaries  the `/conversations` payload
 * @param opts.directory   `/users/directory` rows (id + name), for DM titles
 * @param opts.myId        the current user's id (to find the "other" DM participant)
 * @param opts.projectNames map of projectId → project name, for channel titles
 */
export function describeConversations(summaries, { directory = [], myId, projectNames = {} } = {}) {
  return (summaries ?? [])
    .map((s) => {
      const conv = s.conversation;
      let title;
      if (conv.kind === 'PROJECT') {
        title = projectNames[conv.projectId] || 'Project channel';
      } else {
        const otherId = (s.participants || []).map((p) => p.userId).find((id) => id !== myId);
        const u = directory.find((d) => d.id === otherId);
        title = u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Direct message';
      }
      return {
        id: conv.id,
        kind: conv.kind,
        title,
        unread: s.unread || 0,
        preview: messagePreview(s.lastMessage),
      };
    })
    .sort((a, b) => b.unread - a.unread);
}

/** Badge text for a count: '' for 0, the number up to 9, then '9+'. */
export function badgeText(count) {
  if (!count || count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}
