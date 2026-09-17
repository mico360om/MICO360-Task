/** A navigable destination the command palette can jump to. */
export interface NavCommand {
  id: string;
  label: string;
  to: string;
  keywords: string[];
  admin?: boolean;
}

export const NAV_COMMANDS: NavCommand[] = [
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', keywords: ['home', 'overview'] },
  { id: 'my-tasks', label: 'My Tasks', to: '/my-tasks', keywords: ['tasks', 'mine', 'todo'] },
  { id: 'board', label: 'Kanban Board', to: '/board', keywords: ['kanban', 'board'] },
  { id: 'projects', label: 'Projects', to: '/projects', keywords: ['project'] },
  { id: 'calendar', label: 'Calendar', to: '/calendar', keywords: ['schedule', 'due dates'] },
  { id: 'chat', label: 'Chat', to: '/chat', keywords: ['messages', 'talk'] },
  { id: 'activity', label: 'Activity', to: '/activity', keywords: ['feed', 'history'] },
  { id: 'notifications', label: 'Notifications', to: '/notifications', keywords: ['alerts', 'bell'] },
  { id: 'reports', label: 'Reports', to: '/reports', keywords: ['analytics', 'stats', 'charts', 'trends'] },
  { id: 'settings', label: 'Settings', to: '/settings', keywords: ['preferences'] },
  { id: 'profile', label: 'Profile', to: '/profile', keywords: ['account', 'me'] },
  { id: 'admin-users', label: 'User Management', to: '/admin/users', keywords: ['users', 'people', 'team', 'admin'], admin: true },
  { id: 'admin-ai', label: 'AI Management', to: '/admin/ai', keywords: ['ai', 'models', 'providers', 'admin'], admin: true },
  { id: 'admin-settings', label: 'System Settings', to: '/admin/settings', keywords: ['system', 'admin', 'config'], admin: true },
  { id: 'admin-audit', label: 'Audit Logs', to: '/admin/audit', keywords: ['audit', 'logs', 'admin'], admin: true },
];

const TASK_KEY = '[A-Za-z][A-Za-z0-9]*-\\d+';

export type ParsedCommand =
  | { type: 'assign'; taskKey: string; assignee: string }
  | { type: 'complete'; taskKey: string }
  | { type: 'move'; taskKey: string; status: string }
  | { type: 'open'; taskKey: string }
  | { type: 'navigate'; to: string; label: string };

/** Find a single nav destination whose label/keywords match the query, best-effort. */
export function findNav(query: string, isAdmin: boolean): NavCommand | undefined {
  return matchNavCommands(query, isAdmin)[0];
}

/**
 * Filter nav destinations by a free-text query (matches the label or any keyword). An empty
 * query returns them all. Admin-only destinations are hidden unless `isAdmin`.
 */
export function matchNavCommands(query: string, isAdmin: boolean): NavCommand[] {
  const q = query.trim().toLowerCase();
  const visible = NAV_COMMANDS.filter((c) => !(c.admin && !isAdmin));
  if (!q) return visible;
  // Rank by match quality so e.g. "board" prefers "Kanban Board" over "Dashboard" (contains "board").
  const score = (c: NavCommand): number => {
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

/**
 * Parse an imperative command string into an executable action. Returns null when the input is
 * plain search text. Recognises: assign/move/complete/open <KEY>, a bare task key, and "go to <page>".
 */
export function parseCommand(input: string, isAdmin = true): ParsedCommand | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text) return null;

  let m = new RegExp(`^assign\\s+(${TASK_KEY})\\s+to\\s+(.+)$`, 'i').exec(text);
  if (m) return { type: 'assign', taskKey: m[1]!.toUpperCase(), assignee: m[2]!.trim() };

  m = new RegExp(`^move\\s+(${TASK_KEY})\\s+to\\s+(.+)$`, 'i').exec(text);
  if (m) return { type: 'move', taskKey: m[1]!.toUpperCase(), status: m[2]!.trim() };

  m = new RegExp(`^(?:complete|done|finish|close)\\s+(${TASK_KEY})$`, 'i').exec(text);
  if (m) return { type: 'complete', taskKey: m[1]!.toUpperCase() };

  m = new RegExp(`^open\\s+(${TASK_KEY})$`, 'i').exec(text);
  if (m) return { type: 'open', taskKey: m[1]!.toUpperCase() };

  m = new RegExp(`^(${TASK_KEY})$`).exec(text);
  if (m) return { type: 'open', taskKey: m[1]!.toUpperCase() };

  m = /^(?:go ?to|open|navigate to)\s+(.+)$/i.exec(text);
  if (m) {
    const nav = findNav(m[1]!.trim(), isAdmin);
    return nav ? { type: 'navigate', to: nav.to, label: nav.label } : null;
  }

  return null;
}
