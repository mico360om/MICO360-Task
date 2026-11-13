import { taskNumberKeys } from './task-number';

/** A navigable destination the command palette can jump to. */
export interface NavCommand {
  id: string;
  label: string;
  to: string;
  keywords: string[];
  admin?: boolean;
  /** Only for administrators and the people who run a project (the Management page). */
  leads?: boolean;
}

export const NAV_COMMANDS: NavCommand[] = [
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', keywords: ['home', 'overview'] },
  { id: 'my-tasks', label: 'My Tasks', to: '/my-tasks', keywords: ['tasks', 'mine', 'todo'] },
  { id: 'board', label: 'Kanban Board', to: '/board', keywords: ['kanban', 'board'] },
  { id: 'projects', label: 'Projects', to: '/projects', keywords: ['project'] },
  { id: 'calendar', label: 'Calendar', to: '/calendar', keywords: ['schedule', 'due dates'] },
  { id: 'timeline', label: 'Timeline', to: '/timeline', keywords: ['gantt', 'roadmap', 'milestones', 'targets', 'late projects'] },
  { id: 'workload', label: 'Workload', to: '/workload', keywords: ['capacity', 'load', 'busy', 'daily limit', 'rebalance'] },
  { id: 'templates', label: 'Templates', to: '/templates', keywords: ['template', 'standard tasks', 'project template', 'task template'] },
  { id: 'chat', label: 'Chat', to: '/chat', keywords: ['messages', 'talk'] },
  { id: 'mico-ai', label: 'MICO AI', to: '/mico-ai', keywords: ['ai', 'ask', 'assistant', 'question', 'chatbot'] },
  { id: 'activity', label: 'Activity', to: '/activity', keywords: ['feed', 'history'] },
  { id: 'notifications', label: 'Notifications', to: '/notifications', keywords: ['alerts', 'bell'] },
  { id: 'management', label: 'Management', to: '/management', keywords: ['health', 'red amber green', 'leadership', 'overview', 'inspections', 'overloaded'], leads: true },
  { id: 'reports', label: 'Reports', to: '/reports', keywords: ['analytics', 'stats', 'charts', 'trends'], admin: true },
  { id: 'settings', label: 'Settings', to: '/settings', keywords: ['preferences'] },
  { id: 'profile', label: 'Profile', to: '/profile', keywords: ['account', 'me'] },
  { id: 'about', label: 'About and version history', to: '/about', keywords: ['version', 'release', 'changelog', 'what’s new', 'whats new', 'updates'] },
  { id: 'admin-users', label: 'User Management', to: '/admin/users', keywords: ['users', 'people', 'team', 'admin'], admin: true },
  { id: 'admin-companies', label: 'Companies', to: '/admin/companies', keywords: ['company', 'companies', 'logo', 'admin'], admin: true },
  { id: 'admin-ai', label: 'AI Management', to: '/admin/ai', keywords: ['ai', 'models', 'providers', 'admin'], admin: true },
  { id: 'admin-settings', label: 'System Settings', to: '/admin/settings', keywords: ['system', 'admin', 'config'], admin: true },
  { id: 'admin-notifications', label: 'Notification & Scheduling', to: '/admin/settings/notifications', keywords: ['reminders', 'holidays', 'working days', 'working hours', 'quiet hours', 'escalation', 'schedule', 'admin'], admin: true },
  { id: 'admin-audit', label: 'Audit Logs', to: '/admin/audit', keywords: ['audit', 'logs', 'admin'], admin: true },
];

/**
 * A task number as people type it (1.22.3, lib/task-number) — MICO-142, mico 142, MICO142, MICO_142,
 * #MICO-142 — in a command whose spaces are collapsed; `commandKey` then reads it (or turns it down).
 */
const TASK_KEY = /#? ?[A-Za-z][A-Za-z0-9]*(?: ?[-_‐-―−] ?| )?\d+/.source;
/**
 * A number with its hyphen, as numbers were always written ("MICO-7", any code; a dash a phone types,
 * or spaces around it, too): a command straight away. 1.22.3 review: complete, assign and move read
 * only this form, as on 1.22.2 — "close door 3" or "done step 1" is an ordinary search.
 */
const HYPHENATED = /^([A-Za-z][A-Za-z0-9]*) ?[-‐-―−] ?(\d+)$/;

export type ParsedCommand =
  | { type: 'assign'; taskKey: string; assignee: string }
  | { type: 'complete'; taskKey: string }
  | { type: 'move'; taskKey: string; status: string }
  /**
   * `onlyIfFound`: a number typed loosely, alone ("mico 142", "MICO142") or after "open" ("open mico
   * 142") — offered only once the search finds a task with that number, so a plain search such as
   * "phase 2" or "open phase 2" still opens its first result.
   */
  | { type: 'open'; taskKey: string; onlyIfFound?: true }
  | { type: 'navigate'; to: string; label: string };

/**
 * The task number a command names, as the palette shows it: "MICO-142" for one number however it
 * was typed; what was typed for a run-together one that may be several ("HR214": HR-214, HR2-14 or
 * HR21-4 — commandTaskKeys); null when it isn't a task number.
 */
function commandKey(typed: string): { key: string; hyphenated: boolean } | null {
  const text = typed.trim().replace(/^# ?/, '');
  const apart = HYPHENATED.exec(text);
  if (apart) return { key: `${apart[1]}-${apart[2]}`.toUpperCase(), hyphenated: true };
  const keys = taskNumberKeys(text);
  if (keys.length === 0) return null;
  return { key: keys.length === 1 ? keys[0]! : text.toUpperCase(), hyphenated: false };
}

/** The numbers a command's task may have: what it says, then every split of a run-together one ("HR214" → HR-214, HR2-14, HR21-4). */
export function commandTaskKeys(taskKey: string): string[] {
  return [...new Set([taskKey.toUpperCase(), ...taskNumberKeys(taskKey)])];
}

/** Find a single nav destination whose label/keywords match the query, best-effort. */
export function findNav(query: string, isAdmin: boolean, leads = isAdmin): NavCommand | undefined {
  return matchNavCommands(query, isAdmin, leads)[0];
}

/**
 * Filter nav destinations by a free-text query (matches the label or any keyword). An empty
 * query returns them all. Admin-only destinations are hidden unless `isAdmin`; the Management page
 * unless `leads` (an administrator, or someone who runs a project).
 */
export function matchNavCommands(query: string, isAdmin: boolean, leads = isAdmin): NavCommand[] {
  const q = query.trim().toLowerCase();
  const visible = NAV_COMMANDS.filter((c) => !(c.admin && !isAdmin) && !(c.leads && !leads));
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
export function parseCommand(input: string, isAdmin = true, leads = isAdmin): ParsedCommand | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text) return null;

  // Changing a task takes its number with the hyphen (1.22.3 review): "close door 3" stays a search,
  // and a run-together "complete hr214" never picks HR-214 or HR2-14 by itself.
  let m = new RegExp(`^assign\\s+(${TASK_KEY})\\s+to\\s+(.+)$`, 'i').exec(text);
  let key = m ? commandKey(m[1]!) : null;
  if (m && key?.hyphenated) return { type: 'assign', taskKey: key.key, assignee: m[2]!.trim() };

  m = new RegExp(`^move\\s+(${TASK_KEY})\\s+to\\s+(.+)$`, 'i').exec(text);
  key = m ? commandKey(m[1]!) : null;
  if (m && key?.hyphenated) return { type: 'move', taskKey: key.key, status: m[2]!.trim() };

  m = new RegExp(`^(?:complete|done|finish|close)\\s+(${TASK_KEY})$`, 'i').exec(text);
  key = m ? commandKey(m[1]!) : null;
  if (key?.hyphenated) return { type: 'complete', taskKey: key.key };

  // Opening one, or just a number: the hyphenated one is a command straight away; a loosely typed
  // one ("open mico 142", "mico142", "open phase 2") once the search finds that task.
  m = new RegExp(`^(?:open\\s+)?(${TASK_KEY})$`, 'i').exec(text);
  key = m ? commandKey(m[1]!) : null;
  if (key) return key.hyphenated ? { type: 'open', taskKey: key.key } : { type: 'open', taskKey: key.key, onlyIfFound: true };

  m = /^(?:go ?to|open|navigate to)\s+(.+)$/i.exec(text);
  if (m) {
    const nav = findNav(m[1]!.trim(), isAdmin, leads);
    return nav ? { type: 'navigate', to: nav.to, label: nav.label } : null;
  }

  return null;
}
