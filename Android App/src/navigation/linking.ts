/**
 * URL deep links (A0.3, MOB-09). Pure data so it can be unit-tested with React Navigation's
 * `getStateFromPath`; RootNavigator passes it to `NavigationContainer`.
 *
 * - `mico360://task/<id>`, `mico360://project/<id>`, `mico360://notifications`, `mico360://home`
 * - `mico360://meeting/<id>`, `mico360://meetings`, `mico360://my-action-items` (2a)
 * - the website's own addresses (6b): `https://task.mico360.com/my-tasks?task=<id>`, `/projects/<id>`,
 *   `/meetings/<id>`, `/chat?conversation=<id>` and the pages the app has (normalizeLinkPath). The
 *   App Links in app.json name these paths; the website's admin pages but Users stay in the browser.
 * - `https://task.mico360.com/reset?token=…` — the password-reset e-mail link. Android App Links
 *   (intent filter with autoVerify in app.json + /.well-known/assetlinks.json on the web host)
 *   open it in the app, straight on the Reset screen with the token filled in. The Reset screen
 *   exists only while signed out (auth stack), the app screens only while signed in; both are
 *   listed here and React Navigation resolves whichever stack is mounted.
 */
import { isSafeId } from '../lib/ids';

export const LINKING_PREFIXES = ['mico360://', 'https://task.mico360.com'];

/** One value from a link's query (decoded), or null. */
function queryValue(query: string, name: string): string | null {
  const m = new RegExp(`(?:^|[?&])${name}=([^&#]*)`).exec(query);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** A value put into a path, encoded: one that isn't an id stays in its place and opens nothing (withoutLinkTitles). */
const segment = (v: string) => encodeURIComponent(v);

/**
 * The website's own addresses read as the app's paths, so either opens the same screen (React
 * Navigation allows one path per screen). 6b adds the website's pages to the App Links (app.json):
 * - a task: `?task=<id>` on any page (how the website opens one, and what its emails send) → `task/<id>`;
 * - `/projects/<id>` → `project/<id>`; `/board?project=<id>` → its board; `/board` → the projects;
 * - `/meetings/<id>` → `meeting/<id>` (2a); `/chat?conversation=<id>` → the thread; `/dashboard` → `home`.
 * Anything else is left as is.
 */
export function normalizeLinkPath(path: string): string {
  const m = /^(\/?)([^?#]*)(\?[^#]*)?/.exec(path);
  const lead = m?.[1] ?? '';
  const page = (m?.[2] ?? '').replace(/\/+$/, '');
  const query = m?.[3] ?? '';
  const task = queryValue(query, 'task');
  if (task) return `${lead}task/${segment(task)}`;
  const project = /^projects\/([^/]+)/.exec(page);
  if (project) return `${lead}project/${project[1]}`;
  if (page === 'board') {
    const id = queryValue(query, 'project');
    return id ? `${lead}project/${segment(id)}/board` : `${lead}projects`;
  }
  if (page === 'chat') {
    const id = queryValue(query, 'conversation');
    return id ? `${lead}chat/${segment(id)}` : `${lead}chat`;
  }
  if (page === 'dashboard') return `${lead}home`;
  return path.replace(/^(\/?)meetings\/(?=[^/?#])/, '$1meeting/');
}

/** Params that name a screen in its header: set by the app as it opens one, never by a link. */
const TITLE_PARAMS = ['title', 'projectName'];

/** Params a link fills with an id (they go into API paths). */
const ID_PARAMS = ['taskId', 'projectId', 'meetingId', 'conversationId'];

interface LinkState {
  routes: Array<{ params?: object; state?: LinkState }>;
}

/** Does any route of the state carry an id that isn't an id (3a review)? */
function hasBadId(state: LinkState): boolean {
  return state.routes.some(
    (r) => (r.params ? Object.entries(r.params).some(([k, v]) => ID_PARAMS.includes(k) && !isSafeId(v)) : false) || (r.state ? hasBadId(r.state) : false),
  );
}

/**
 * The navigation state a link gives, without any header title it carried (`?title=…`,
 * `?projectName=…`): a link from an email or a web page can't make a screen call itself something
 * else. The screen shows its own name until its data says otherwise. Everything else a link
 * carries (the ids, a reset token) stays — and a link whose id isn't an id (`chat/..%2F..%2Fx`)
 * opens nothing at all (3a review).
 */
export function withoutLinkTitles<S extends LinkState | undefined>(state: S): S {
  if (!state) return state;
  if (hasBadId(state)) return undefined as S;
  return {
    ...state,
    routes: state.routes.map((r) => {
      const params = r.params ? Object.fromEntries(Object.entries(r.params).filter(([k]) => !TITLE_PARAMS.includes(k))) : r.params;
      return { ...r, params, ...(r.state ? { state: withoutLinkTitles(r.state) } : {}) };
    }),
  };
}

export const linkingConfig = {
  screens: {
    // Signed-out (auth stack)
    Login: 'login',
    Forgot: 'forgot',
    Reset: 'reset',
    // Signed-in (app stack)
    Tabs: { screens: { Notifications: 'notifications', Dashboard: 'home', Meetings: 'meetings', MyTasks: 'my-tasks', Projects: 'projects', Chat: 'chat' } },
    // A project link opens its dashboard, as the website's /projects/<id> does (5c); /board its board.
    ProjectDetail: 'project/:projectId',
    Board: 'project/:projectId/board',
    Activity: 'activity',
    TaskDetail: 'task/:taskId',
    MeetingDetail: 'meeting/:meetingId',
    MyActionItems: 'my-action-items',
    ChatThread: 'chat/:conversationId',
    // The website's other pages the app has (6b); its admin pages but Users stay on the website.
    Calendar: 'calendar',
    Profile: 'profile',
    Settings: 'settings',
    Reports: 'reports',
    About: 'about',
    Users: 'admin/users',
  },
} as const;
