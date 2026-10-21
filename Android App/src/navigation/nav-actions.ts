import type { LinkTarget } from '../lib/deep-link';
import type { LinkState } from './linking';
import type { TabsParamList, AppStackParamList, AuthStackParamList } from './types';

/**
 * A concrete navigation instruction: switch to a bottom tab, or push a stack screen. Kept as a
 * plain data descriptor (no navigation side effects) so both the deep-link handler and the drawer
 * produce it and it can be unit-tested; `applyNavAction` in RootNavigator performs it.
 */
export type NavAction =
  | { type: 'tab'; tab: keyof TabsParamList }
  | { type: 'stack'; screen: 'TaskDetail'; params: AppStackParamList['TaskDetail'] }
  | { type: 'stack'; screen: 'Board'; params: AppStackParamList['Board'] }
  /** The All projects board (4c): every open project's tasks under the six shared statuses. */
  | { type: 'stack'; screen: 'AllBoard' }
  | { type: 'stack'; screen: 'ProjectDetail'; params: AppStackParamList['ProjectDetail'] }
  | { type: 'stack'; screen: 'MeetingDetail'; params: AppStackParamList['MeetingDetail'] }
  | { type: 'stack'; screen: 'ChatThread'; params: AppStackParamList['ChatThread'] }
  | { type: 'stack'; screen: 'MyActionItems' }
  | { type: 'stack'; screen: 'Calendar' }
  | { type: 'stack'; screen: 'Profile' }
  | { type: 'stack'; screen: 'Reports' }
  | { type: 'stack'; screen: 'Activity' }
  | { type: 'stack'; screen: 'Settings' }
  | { type: 'stack'; screen: 'Search' }
  | { type: 'stack'; screen: 'About' }
  | { type: 'stack'; screen: 'Users'; params?: AppStackParamList['Users'] }
  /** A website page the app doesn't have (6b): whoever offers it opens it in the browser (lib/website). */
  | { type: 'website'; path: string }
  /** A signed-out destination (the password-reset screen opened from the e-mail link). */
  | { type: 'auth'; screen: 'Reset'; params: NonNullable<AuthStackParamList['Reset']> }
  /** A link tapped while signed out (6b review): the screens it opens, as the navigator read them, once someone signs in. */
  | { type: 'link'; state: LinkState };

/**
 * Where the website's Kanban Board (/board: every project's tasks) opens on the phone (6b review):
 * the All projects board (4c). Search uses it; the /board link (navigation/linking normalizeLinkPath
 * and linkingConfig's AllBoard) opens the same screen.
 */
export const ALL_PROJECTS_BOARD: NavAction = { type: 'stack', screen: 'AllBoard' };

/** Turn a resolved deep-link/push target into a navigation action. */
export function targetToAction(target: LinkTarget): NavAction {
  switch (target.screen) {
    case 'TaskDetail':
      return { type: 'stack', screen: 'TaskDetail', params: target.params };
    case 'Board':
      return { type: 'stack', screen: 'Board', params: target.params };
    case 'ProjectDetail':
      return { type: 'stack', screen: 'ProjectDetail', params: target.params };
    case 'MeetingDetail':
      return { type: 'stack', screen: 'MeetingDetail', params: target.params };
    case 'MyActionItems':
      return { type: 'stack', screen: 'MyActionItems' };
    case 'Meetings':
      return { type: 'tab', tab: 'Meetings' };
    case 'Chat':
      return { type: 'tab', tab: 'Chat' };
    case 'ChatThread':
      return { type: 'stack', screen: 'ChatThread', params: target.params };
    case 'Reset':
      return { type: 'auth', screen: 'Reset', params: target.params };
    case 'Notifications':
    default:
      return { type: 'tab', tab: 'Notifications' };
  }
}

/**
 * The stack screens' ids (React Navigation's `getId`): one screen per task and one per meeting. A
 * link from a meeting to its task, a task to its meeting, or a push for another meeting then adds a
 * screen — Back returns to the one before — instead of reusing a screen of the same kind further
 * down with the other's params (and its open edits).
 */
export const taskScreenId = ({ params }: { params?: { taskId?: string } }): string | undefined => params?.taskId;
export const meetingScreenId = ({ params }: { params?: { meetingId?: string } }): string | undefined => params?.meetingId;
/** One thread screen per conversation (a push for another conversation adds a screen). */
export const chatScreenId = ({ params }: { params?: { conversationId?: string } }): string | undefined => params?.conversationId;

/** Where a tap in the Alerts list goes (it navigates from inside the tabs). */
export type AlertRoute =
  | { name: 'TaskDetail'; params: AppStackParamList['TaskDetail'] }
  | { name: 'Board'; params: AppStackParamList['Board'] }
  | { name: 'ProjectDetail'; params: AppStackParamList['ProjectDetail'] }
  | { name: 'MeetingDetail'; params: AppStackParamList['MeetingDetail'] }
  | { name: 'ChatThread'; params: AppStackParamList['ChatThread'] }
  | { name: 'Tabs'; params: { screen: keyof TabsParamList } };

/** The screen an alert opens, or null to stay on the list (an alert about nothing it can open). */
export function alertRoute(action: NavAction): AlertRoute | null {
  if (action.type === 'tab') return action.tab === 'Notifications' ? null : { name: 'Tabs', params: { screen: action.tab } };
  if (action.type !== 'stack') return null;
  switch (action.screen) {
    case 'TaskDetail':
      return { name: 'TaskDetail', params: action.params };
    case 'Board':
      return { name: 'Board', params: action.params };
    case 'ProjectDetail':
      return { name: 'ProjectDetail', params: action.params };
    case 'MeetingDetail':
      return { name: 'MeetingDetail', params: action.params };
    case 'ChatThread':
      return { name: 'ChatThread', params: action.params };
    default:
      return null;
  }
}

/** True when the action needs a signed-in user (everything except the auth screens). */
export function requiresSession(action: NavAction): boolean {
  return action.type !== 'auth';
}
