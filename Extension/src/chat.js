/**
 * Pure chat helpers for the extension popup + service worker. Framework-free and testable.
 * The popup fetches `/conversations` (inbox summaries) and `/users/directory`; these turn
 * that raw data into display rows and an unread total for the toolbar badge.
 */

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
        preview: (s.lastMessage && s.lastMessage.body) || '',
      };
    })
    .sort((a, b) => b.unread - a.unread);
}

/** Badge text for a count: '' for 0, the number up to 9, then '9+'. */
export function badgeText(count) {
  if (!count || count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}
