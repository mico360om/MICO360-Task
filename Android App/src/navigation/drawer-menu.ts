import type { NavAction } from './nav-actions';

export interface DrawerItem {
  key: string;
  label: string;
  icon: string;
  action: NavAction;
}

/** The side-drawer destinations (a superset of the bottom tabs + the stack-only screens). */
export const DRAWER_ITEMS: readonly DrawerItem[] = [
  { key: 'Dashboard', label: 'Home', icon: '🏠', action: { type: 'tab', tab: 'Dashboard' } },
  { key: 'MyTasks', label: 'My Tasks', icon: '✓', action: { type: 'tab', tab: 'MyTasks' } },
  { key: 'Projects', label: 'Projects', icon: '🗂', action: { type: 'tab', tab: 'Projects' } },
  { key: 'Chat', label: 'Chat', icon: '💬', action: { type: 'tab', tab: 'Chat' } },
  { key: 'Calendar', label: 'Calendar', icon: '📅', action: { type: 'stack', screen: 'Calendar' } },
  { key: 'Notifications', label: 'Alerts', icon: '🔔', action: { type: 'tab', tab: 'Notifications' } },
  { key: 'Profile', label: 'Profile', icon: '👤', action: { type: 'stack', screen: 'Profile' } },
  { key: 'Settings', label: 'Settings', icon: '⚙️', action: { type: 'tab', tab: 'Settings' } },
] as const;

/** The destination route name an action lands on (a tab name or a stack screen name). */
export function actionRouteName(action: NavAction): string {
  return action.type === 'tab' ? action.tab : action.screen;
}

/** The drawer key whose destination matches the currently-focused route (for the active highlight). */
export function activeDrawerKey(routeName: string | undefined): string | undefined {
  if (!routeName) return undefined;
  return DRAWER_ITEMS.find((i) => actionRouteName(i.action) === routeName)?.key;
}
