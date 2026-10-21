/**
 * URL deep links (A0.3, MOB-09). Pure data so it can be unit-tested with React Navigation's
 * `getStateFromPath`; RootNavigator passes it to `NavigationContainer`.
 *
 * - `mico360://task/<id>`, `mico360://project/<id>`, `mico360://notifications`, `mico360://home`
 * - `mico360://meeting/<id>`, `mico360://meetings`, `mico360://my-action-items` (2a)
 * - `mico360://chat/<conversation id>` (3a)
 * - `https://task.mico360.com/reset?token=…` — the password-reset e-mail link. Android App Links
 *   (intent filter with autoVerify in app.json + /.well-known/assetlinks.json on the web host)
 *   open it in the app, straight on the Reset screen with the token filled in. The Reset screen
 *   exists only while signed out (auth stack), the app screens only while signed in; both are
 *   listed here and React Navigation resolves whichever stack is mounted.
 */
import { isSafeId } from '../lib/ids';

export const LINKING_PREFIXES = ['mico360://', 'https://task.mico360.com'];

/**
 * The website's own address for a meeting (`/meetings/<id>`) read as the app's `meeting/<id>`, so
 * either opens the meeting (React Navigation allows one path per screen). Anything else is left as is.
 */
export function normalizeLinkPath(path: string): string {
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
    Tabs: { screens: { Notifications: 'notifications', Dashboard: 'home', Meetings: 'meetings' } },
    Board: 'project/:projectId',
    TaskDetail: 'task/:taskId',
    MeetingDetail: 'meeting/:meetingId',
    MyActionItems: 'my-action-items',
    ChatThread: 'chat/:conversationId',
  },
} as const;
