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
  | { type: 'stack'; screen: 'Calendar' }
  | { type: 'stack'; screen: 'Profile' }
  | { type: 'stack'; screen: 'Reports' }
  /** A signed-out destination (the password-reset screen opened from the e-mail link). */
  | { type: 'auth'; screen: 'Reset'; params: NonNullable<AuthStackParamList['Reset']> };

/** Turn a resolved deep-link/push target into a navigation action. */
export function targetToAction(target: LinkTarget): NavAction {
  switch (target.screen) {
    case 'TaskDetail':
      return { type: 'stack', screen: 'TaskDetail', params: target.params };
    case 'Board':
      return { type: 'stack', screen: 'Board', params: target.params };
    case 'Chat':
      return { type: 'tab', tab: 'Chat' };
    case 'Reset':
      return { type: 'auth', screen: 'Reset', params: target.params };
    case 'Notifications':
    default:
      return { type: 'tab', tab: 'Notifications' };
  }
}

/** True when the action needs a signed-in user (everything except the auth screens). */
export function requiresSession(action: NavAction): boolean {
  return action.type !== 'auth';
}
