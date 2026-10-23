/**
 * Search on the phone (6b), as the website's search box: what you type finds tasks, projects,
 * people and meetings (GET /search, which only finds what you may see), the pages of the app, and
 * "open MICO-7". The same groups, in the same order, with the same numbers, after the same pause in
 * typing. Pure TypeScript: the screen asks the server and opens what is chosen.
 *
 * The task-changing commands of the website's box ("complete", "assign", "move") are left to the
 * task's own screen on the phone.
 */
import { ApiError, isNetworkError } from './api-client';
import { matchNavCommands, parseCommand } from './commands';
import { isSafeId } from './ids';
import { websiteLinkLabel } from './website';
import { ALL_PROJECTS_BOARD, type NavAction } from '../navigation/nav-actions';

/** GET /search: what the server found that you may see. */
export interface SearchResults {
  /** `formerKeys`: keys a task had before it moved to another project (searching one finds it). */
  tasks: { id: string; key: string; title: string; projectId: string; formerKeys?: string[] }[];
  projects: { id: string; code: string; name: string }[];
  users: { id: string; username: string; firstName: string; lastName: string }[];
  /** Meetings by title, agenda, notes and decisions (servers since meeting search). */
  meetings?: { id: string; title: string; projectId: string | null; snippet: string }[];
}

/** The website's wait after the last key before asking the server. */
export const SEARCH_DEBOUNCE_MS = 250;

/** How many of each the website's box shows. */
export const SEARCH_LIMITS = { tasks: 6, projects: 5, people: 5, meetings: 6, pages: 6, pagesEmpty: 5 } as const;

/** The server is asked from 2 letters on. */
export const searchEnabled = (debounced: string): boolean => debounced.trim().length >= 2;

export type SearchTarget =
  | { kind: 'screen'; action: NavAction }
  /** A website page the app doesn't have: it opens in the browser. */
  | { kind: 'website'; path: string }
  /** "Open MICO-7": the task with exactly that key, found first. */
  | { kind: 'openKey'; key: string }
  /** Someone else: a conversation with them. */
  | { kind: 'directMessage'; userId: string; name: string };

export type SearchGroup = 'Command' | 'Go to' | 'Tasks' | 'Projects' | 'People' | 'Meetings';

export interface SearchItem {
  id: string;
  group: SearchGroup;
  primary: string;
  /** The task key or project code, before the name; "On the website" for a website page. */
  hint?: string;
  /** A meeting's words around what matched. */
  secondary?: string;
  /** What TalkBack reads. */
  label: string;
  target: SearchTarget;
}

/** Where each of the website's search pages opens on the phone (its own name, where the app's differs). */
export const APP_PAGES: Record<string, { label?: string; target: SearchTarget }> = {
  dashboard: { label: 'Home', target: { kind: 'screen', action: { type: 'tab', tab: 'Dashboard' } } },
  'my-tasks': { target: { kind: 'screen', action: { type: 'tab', tab: 'MyTasks' } } },
  // The website's Kanban Board, by its name: where it opens on the phone is ALL_PROJECTS_BOARD (6b review).
  board: { target: { kind: 'screen', action: ALL_PROJECTS_BOARD } },
  projects: { target: { kind: 'screen', action: { type: 'tab', tab: 'Projects' } } },
  calendar: { target: { kind: 'screen', action: { type: 'stack', screen: 'Calendar' } } },
  chat: { target: { kind: 'screen', action: { type: 'tab', tab: 'Chat' } } },
  activity: { target: { kind: 'screen', action: { type: 'stack', screen: 'Activity' } } },
  notifications: { label: 'Alerts', target: { kind: 'screen', action: { type: 'tab', tab: 'Notifications' } } },
  reports: { target: { kind: 'screen', action: { type: 'stack', screen: 'Reports' } } },
  settings: { target: { kind: 'screen', action: { type: 'stack', screen: 'Settings' } } },
  profile: { target: { kind: 'screen', action: { type: 'stack', screen: 'Profile' } } },
  about: { target: { kind: 'screen', action: { type: 'stack', screen: 'About' } } },
  'admin-users': { target: { kind: 'screen', action: { type: 'stack', screen: 'Users' } } },
  // Website pages the app has no screen for yet (planning, MICO AI): they open on the website.
  timeline: { target: { kind: 'website', path: '/timeline' } },
  workload: { target: { kind: 'website', path: '/workload' } },
  'mico-ai': { target: { kind: 'website', path: '/mico-ai' } },
  'admin-ai': { target: { kind: 'website', path: '/admin/ai' } },
  'admin-settings': { target: { kind: 'website', path: '/admin/settings' } },
  'admin-audit': { target: { kind: 'website', path: '/admin/audit' } },
};

/** The website's pages for these words that the phone has, best match first. */
function pagesFor(raw: string, isAdmin: boolean) {
  return matchNavCommands(raw, isAdmin)
    .filter((c) => APP_PAGES[c.id])
    .map((c) => ({ command: c, page: APP_PAGES[c.id]!, label: APP_PAGES[c.id]!.label ?? c.label }));
}

function pageItem(id: string, group: SearchGroup, primary: string, target: SearchTarget): SearchItem {
  const website = target.kind === 'website';
  return { id, group, primary, ...(website ? { hint: 'On the website' } : {}), label: website ? websiteLinkLabel(primary) : `${group === 'Command' ? '' : 'Go to '}${primary}`, target };
}

const personName = (u: { firstName?: string; lastName?: string; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

/**
 * The list under the box: a command, then pages, then (from 2 letters, once the server answered)
 * tasks, projects, people and meetings. A result whose id isn't an id is left out — ids go into
 * the addresses the app asks the server for.
 */
export function searchItems({ raw, results, isAdmin, myId }: { raw: string; results: SearchResults | undefined; isAdmin: boolean; myId: string | null | undefined }): SearchItem[] {
  const out: SearchItem[] = [];
  const text = raw.trim();
  const parsed = text ? parseCommand(text, isAdmin) : null;
  if (parsed?.type === 'open') {
    out.push({ id: 'cmd-open', group: 'Command', primary: `Open ${parsed.taskKey}`, label: `Open task ${parsed.taskKey}`, target: { kind: 'openKey', key: parsed.taskKey } });
  } else if (parsed?.type === 'navigate') {
    const page = pagesFor(parsed.label, isAdmin).find((p) => p.command.to === parsed.to);
    if (page) out.push(pageItem('cmd-nav', 'Command', `Go to ${page.label}`, page.page.target));
  }

  for (const p of pagesFor(text, isAdmin).slice(0, text ? SEARCH_LIMITS.pages : SEARCH_LIMITS.pagesEmpty)) {
    out.push(pageItem(`nav-${p.command.id}`, 'Go to', p.label, p.page.target));
  }

  if (!results) return out;
  for (const t of (results.tasks ?? []).filter((x) => isSafeId(x.id)).slice(0, SEARCH_LIMITS.tasks)) {
    // A task that moved project shows the key it had too, as the website does: "OPS-17 (was RIG-4)".
    const hint = t.formerKeys && t.formerKeys.length > 0 ? `${t.key} (was ${t.formerKeys.join(', ')})` : t.key;
    out.push({
      id: `task-${t.id}`,
      group: 'Tasks',
      primary: t.title,
      hint,
      label: `Task ${hint}, ${t.title}`,
      target: { kind: 'screen', action: { type: 'stack', screen: 'TaskDetail', params: { taskId: t.id, title: t.title } } },
    });
  }
  for (const p of (results.projects ?? []).filter((x) => isSafeId(x.id)).slice(0, SEARCH_LIMITS.projects)) {
    out.push({
      id: `proj-${p.id}`,
      group: 'Projects',
      primary: p.name,
      hint: p.code,
      label: `Project ${p.code}, ${p.name}`,
      target: { kind: 'screen', action: { type: 'stack', screen: 'ProjectDetail', params: { projectId: p.id, projectName: p.name } } },
    });
  }
  for (const u of (results.users ?? []).filter((x) => isSafeId(x.id)).slice(0, SEARCH_LIMITS.people)) {
    const name = personName(u);
    // You → your profile; an administrator → User Management; anyone else → a conversation (the website's rule).
    const target: SearchTarget =
      u.id === myId
        ? { kind: 'screen', action: { type: 'stack', screen: 'Profile' } }
        : isAdmin
          ? { kind: 'screen', action: { type: 'stack', screen: 'Users', params: { q: u.username } } }
          : { kind: 'directMessage', userId: u.id, name };
    out.push({ id: `user-${u.id}`, group: 'People', primary: name, label: `Person ${name}${target.kind === 'directMessage' ? ', opens a chat' : ''}`, target });
  }
  for (const m of (results.meetings ?? []).filter((x) => isSafeId(x.id)).slice(0, SEARCH_LIMITS.meetings)) {
    out.push({
      id: `meeting-${m.id}`,
      group: 'Meetings',
      primary: m.title,
      ...(m.snippet ? { secondary: m.snippet } : {}),
      label: `Meeting ${m.title}${m.snippet ? `, ${m.snippet}` : ''}`,
      target: { kind: 'screen', action: { type: 'stack', screen: 'MeetingDetail', params: { meetingId: m.id, title: m.title } } },
    });
  }
  return out;
}

/**
 * "Open WEB-5" opens WEB-5 only — search finds WEB-50 too, so the key must match exactly. A key a task
 * had before it moved project counts too ("open RIG-4" opens what is OPS-17 now), after the keys tasks
 * have now — as on the website.
 */
export function exactTask(results: SearchResults | undefined, key: string): SearchResults['tasks'][number] | null {
  const k = key.toLowerCase();
  const tasks = (results?.tasks ?? []).filter((t) => isSafeId(t.id));
  return tasks.find((t) => t.key.toLowerCase() === k) ?? tasks.find((t) => (t.formerKeys ?? []).some((f) => f.toLowerCase() === k)) ?? null;
}

/** The line under the box (null: nothing to say). */
export function searchStatus({
  term,
  debounced,
  loading,
  error,
  resultCount,
}: {
  term: string;
  debounced: string;
  loading: boolean;
  error: unknown;
  resultCount: number;
}): string | null {
  const typed = term.trim();
  if (!typed) return null;
  if (!searchEnabled(typed)) return 'Type 2 or more letters to search tasks, projects, people and meetings.';
  if (error) {
    if (isNetworkError(error)) return 'You’re offline — search needs a connection. The pages above still open.';
    return error instanceof ApiError || error instanceof Error ? 'Couldn’t search. Please try again.' : null;
  }
  if (loading || debounced.trim() !== typed) return resultCount ? null : 'Searching…';
  return resultCount ? null : `No matches for “${debounced.trim()}”.`;
}

/** The screen an action opens (null for a website page: the browser opens that). */
export function routeOf(action: NavAction): { name: string; params: object | undefined } | null {
  if (action.type === 'tab') return { name: 'Tabs', params: { screen: action.tab } };
  if (action.type === 'stack') return { name: action.screen, params: 'params' in action ? action.params : undefined };
  return null;
}
