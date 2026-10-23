/**
 * Search, as the website's Ctrl+K search (Web Portal/frontend/src/components/GlobalSearch.tsx):
 * the pages to go to, a task by its key, and what GET /search finds — tasks, projects, people and
 * meetings. What the extension has a screen for opens here (a task's panel, a project's board, a
 * meeting, a direct message); everything else opens on the website. The page list and its ranking
 * are copies of the web's lib/commands.ts (a test runs both). Pure (no DOM, no chrome APIs).
 */

/** Searching starts at two letters, as on the web. */
export const MIN_QUERY = 2;

/** How many of each kind are shown, as on the web. */
const LIMITS = { tasks: 6, projects: 5, users: 5, meetings: 6 };

/**
 * The pages, in the web's order with its names and words. `hash`: a screen of the extension;
 * `web`: a page of the website (the extension has none). Meetings is the extension's own addition.
 */
export const PAGES = [
  { id: 'dashboard', label: 'Dashboard', hash: '#/', keywords: ['home', 'overview'] },
  { id: 'my-tasks', label: 'My Tasks', hash: '#/my-tasks', keywords: ['tasks', 'mine', 'todo'] },
  { id: 'board', label: 'Kanban Board', web: '/board', keywords: ['kanban', 'board'] },
  { id: 'projects', label: 'Projects', hash: '#/projects', keywords: ['project'] },
  { id: 'calendar', label: 'Calendar', hash: '#/calendar', keywords: ['schedule', 'due dates'] },
  { id: 'timeline', label: 'Timeline', web: '/timeline', keywords: ['gantt', 'roadmap', 'milestones', 'targets', 'late projects'] },
  { id: 'workload', label: 'Workload', web: '/workload', keywords: ['capacity', 'load', 'busy', 'daily limit', 'rebalance'] },
  { id: 'meetings', label: 'Meetings', hash: '#/meetings', keywords: ['meeting', 'invitations', 'minutes'] },
  { id: 'chat', label: 'Chat', hash: '#/chat', keywords: ['messages', 'talk'] },
  { id: 'activity', label: 'Activity', web: '/activity', keywords: ['feed', 'history'] },
  { id: 'notifications', label: 'Notifications', hash: '#/notifications', keywords: ['alerts', 'bell'] },
  { id: 'reports', label: 'Reports', hash: '#/reports', keywords: ['analytics', 'stats', 'charts', 'trends'], admin: true },
  { id: 'settings', label: 'Settings', hash: '#/settings', keywords: ['preferences'] },
  { id: 'profile', label: 'Profile', web: '/profile', keywords: ['account', 'me'] },
  { id: 'about', label: 'About and version history', web: '/about', keywords: ['version', 'release', 'changelog', 'what’s new', 'whats new', 'updates'] },
  { id: 'admin-users', label: 'User Management', web: '/admin/users', keywords: ['users', 'people', 'team', 'admin'], admin: true },
  { id: 'admin-ai', label: 'AI Management', web: '/admin/ai', keywords: ['ai', 'models', 'providers', 'admin'], admin: true },
  { id: 'admin-settings', label: 'System Settings', web: '/admin/settings', keywords: ['system', 'admin', 'config'], admin: true },
  { id: 'admin-audit', label: 'Audit Logs', web: '/admin/audit', keywords: ['audit', 'logs', 'admin'], admin: true },
];

/**
 * Pages matching what was typed, best first: an exact name or word, then one that starts with it,
 * then one that contains it (so "board" finds "Kanban Board" before "Dashboard"). Nothing typed:
 * all of them. Admin pages only for admins. The web's `matchNavCommands`, over any list.
 */
export function rankPages(pages, query, isAdmin) {
  const q = String(query || '').trim().toLowerCase();
  const visible = pages.filter((c) => !(c.admin && !isAdmin));
  if (!q) return visible;
  const score = (c) => {
    const label = c.label.toLowerCase();
    if (label === q || c.keywords.includes(q)) return 0;
    if (label.startsWith(q) || c.keywords.some((k) => k.startsWith(q))) return 1;
    if (label.includes(q) || c.keywords.some((k) => k.includes(q))) return 2;
    return 99;
  };
  return visible
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.c);
}

export const matchPages = (query, isAdmin) => rankPages(PAGES, query, isAdmin);

const TASK_KEY = '[A-Za-z][A-Za-z0-9]*-\\d+';

/**
 * A command typed in the search box, or null for words to search. As on the web: a task key (or
 * "open KEY") opens that task, "go to <page>" goes there. The web's changes from the box (complete,
 * assign, move) stay on the website: here they are searched as words.
 */
export function parseCommand(input, isAdmin = true) {
  const text = String(input || '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  let m = new RegExp(`^open\\s+(${TASK_KEY})$`, 'i').exec(text);
  if (m) return { type: 'open', taskKey: m[1].toUpperCase() };
  m = new RegExp(`^(${TASK_KEY})$`).exec(text);
  if (m) return { type: 'open', taskKey: m[1].toUpperCase() };
  m = /^(?:go ?to|open|navigate to)\s+(.+)$/i.exec(text);
  if (m) {
    const page = matchPages(m[1].trim(), isAdmin)[0];
    return page ? { type: 'navigate', page } : null;
  }
  return null;
}

/** Whether the words are long enough to ask the server. */
export function searchable(term) {
  return String(term || '').trim().length >= MIN_QUERY;
}

const enc = encodeURIComponent;
const list = (v) => (Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string' && r.id) : []);
const webUrl = (appBase, path) => {
  const base = String(appBase || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : null;
};

/** Where a page leads: `{ hash }` for a screen here, `{ url }` on the website (null when it has no address). */
export function pageTarget(page, appBase) {
  if (page.hash) return { hash: page.hash };
  const url = webUrl(appBase, page.web);
  return url ? { url } : null;
}

/** A person's name as the web writes it: first and last, else the username. */
export function personName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || '';
}

/**
 * Where a person in the results leads, as on the web: yourself, your profile (on the website); an
 * admin, the user list (on the website); anyone else, a direct message with them (here).
 */
function personTarget(userId, { myId, isAdmin, appBase }) {
  if (userId !== myId && !isAdmin) return { dm: userId };
  const url = webUrl(appBase, userId === myId ? '/profile' : '/admin/users');
  return url ? { url } : null;
}

/**
 * The rows to show for `term`: groups `{ group, items }` in the web's order — a command, pages
 * ("Go to"), then what the server found (`results`, GET /search's answer, or null while there is
 * none). Each item: `{ id, group, label, hint?, secondary?, target, web? }`; `target` is `{ hash }`
 * (a screen here), `{ url }` (the website), `{ dm: userId }` (a direct message here), or
 * `{ taskKey }` (a task to find by its key). Rows that can't be opened are left out.
 */
export function buildResults({ term, results, isAdmin = false, myId = null, appBase = '' }) {
  const raw = String(term || '').trim();
  const out = [];
  const add = (group, item) => {
    if (!item.target) return;
    let g = out.find((x) => x.group === group);
    if (!g) out.push((g = { group, items: [] }));
    g.items.push({ ...item, group });
  };

  const cmd = raw ? parseCommand(raw, isAdmin) : null;
  if (cmd && cmd.type === 'open') add('Command', { id: 'cmd-open', label: `Open ${cmd.taskKey}`, target: { taskKey: cmd.taskKey } });
  if (cmd && cmd.type === 'navigate') {
    const target = pageTarget(cmd.page, appBase);
    add('Command', { id: 'cmd-nav', label: `Go to ${cmd.page.label}`, target, web: Boolean(target && target.url) });
  }

  for (const page of matchPages(raw, isAdmin).slice(0, raw ? 6 : 5)) {
    const target = pageTarget(page, appBase);
    add('Go to', { id: `nav-${page.id}`, label: page.label, target, web: Boolean(target && target.url) });
  }

  if (searchable(raw) && results) {
    for (const t of list(results.tasks).slice(0, LIMITS.tasks)) {
      // A task that moved project shows the key it had too, as the website does: "OPS-17 (was RIG-4)".
      const former = (Array.isArray(t.formerKeys) ? t.formerKeys : []).filter((k) => typeof k === 'string');
      const hint = former.length > 0 ? `${t.key || ''} (was ${former.join(', ')})` : t.key || '';
      add('Tasks', { id: `task-${t.id}`, label: t.title || t.key || '', hint, target: { hash: `#/task/${enc(t.id)}` } });
    }
    for (const p of list(results.projects).slice(0, LIMITS.projects)) {
      add('Projects', { id: `proj-${p.id}`, label: p.name || p.code || '', hint: p.code || '', projectId: p.id, target: { hash: `#/board/${enc(p.id)}` } });
    }
    for (const u of list(results.users).slice(0, LIMITS.users)) {
      const target = personTarget(u.id, { myId, isAdmin, appBase });
      add('People', { id: `user-${u.id}`, label: personName(u), target, web: Boolean(target && target.url) });
    }
    for (const m of list(results.meetings).slice(0, LIMITS.meetings)) {
      add('Meetings', { id: `meeting-${m.id}`, label: m.title || '', secondary: m.snippet || '', target: { hash: `#/meeting/${enc(m.id)}` } });
    }
  }
  return out;
}

/** The groups' items in one list, in the order shown (the keyboard's order). */
export function flatItems(groups) {
  return groups.flatMap((g) => g.items);
}

/**
 * The task a key names, from GET /search's answer: only an exact match (search finds parts of
 * words, so "RIG-5" must never open RIG-50), as on the web. A key a task had before it moved project
 * counts too ("RIG-4" opens what is OPS-17 now), after the keys tasks have now. Null when there is none.
 */
export function taskByKey(results, key) {
  const k = String(key || '').toLowerCase();
  const tasks = list(results && results.tasks);
  return (
    tasks.find((t) => String(t.key || '').toLowerCase() === k) ||
    tasks.find((t) => (Array.isArray(t.formerKeys) ? t.formerKeys : []).some((f) => String(f).toLowerCase() === k)) ||
    null
  );
}
