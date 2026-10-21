import type { LinkTarget } from '../lib/deep-link';
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
  | { type: 'stack'; screen: 'MeetingDetail'; params: AppStackParamList['MeetingDetail'] }
  | { type: 'stack'; screen: 'ChatThread'; params: AppStackParamList['ChatThread'] }
  | { type: 'stack'; screen: 'MyActionItems' }
  | { type: 'stack'; screen: 'Calendar' }
  | { type: 'stack'; screen: 'Profile' }
  | { type: 'stack'; screen: 'Reports' }
  | { type: 'stack'; screen: 'Settings' }
  /** A signed-out destination (the password-reset screen opened from the e-mail link). */
  | { type: 'auth'; screen: 'Reset'; params: NonNullable<AuthStackParamList['Reset']> };

/** Turn a resolved deep-link/push target into a navigation action. */
export function targetToAction(target: LinkTarget): NavAction {
  switch (target.screen) {
    case 'TaskDetail':
      return { type: 'stack', screen: 'TaskDetail', params: target.params };
    case 'Board':
      return { type: 'stack', screen: 'Board', params: target.params };
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

/** True when the action needs a signed-in user (everything except the auth screens). */
export function requiresSession(action: NavAction): boolean {
  return action.type !== 'auth';
}
