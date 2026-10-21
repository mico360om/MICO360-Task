import type { NavAction } from './nav-actions';

export interface DrawerItem {
  key: string;
  label: string;
  icon: string;
  action: NavAction;
  /** Shown only to administrators (the server enforces the role as well). */
  adminOnly?: boolean;
}

/**
 * The side-drawer destinations: the bottom tabs first, in the tab bar's order (navigation/tabs),
 * with My Action Items under Meetings, then the screens the tabs don't reach.
 */
export const DRAWER_ITEMS: readonly DrawerItem[] = [
  { key: 'Dashboard', label: 'Home', icon: '🏠', action: { type: 'tab', tab: 'Dashboard' } },
  { key: 'MyTasks', label: 'My Tasks', icon: '✓', action: { type: 'tab', tab: 'MyTasks' } },
  { key: 'Projects', label: 'Projects', icon: '🗂', action: { type: 'tab', tab: 'Projects' } },
  { key: 'Meetings', label: 'Meetings', icon: '👥', action: { type: 'tab', tab: 'Meetings' } },
  { key: 'MyActionItems', label: 'My Action Items', icon: '☑', action: { type: 'stack', screen: 'MyActionItems' } },
  { key: 'Chat', label: 'Chat', icon: '💬', action: { type: 'tab', tab: 'Chat' } },
  { key: 'Notifications', label: 'Alerts', icon: '🔔', action: { type: 'tab', tab: 'Notifications' } },
  { key: 'Calendar', label: 'Calendar', icon: '📅', action: { type: 'stack', screen: 'Calendar' } },
  { key: 'Reports', label: 'Reports', icon: '📊', action: { type: 'stack', screen: 'Reports' }, adminOnly: true },
  { key: 'Profile', label: 'Profile', icon: '👤', action: { type: 'stack', screen: 'Profile' } },
  { key: 'Settings', label: 'Settings', icon: '⚙️', action: { type: 'stack', screen: 'Settings' } },
] as const;

/** The drawer destinations for a user with these roles. */
export function drawerItemsFor(roles: readonly string[]): DrawerItem[] {
  return DRAWER_ITEMS.filter((i) => !i.adminOnly || roles.includes('ADMIN'));
}

/** The destination route name an action lands on (a tab name or a stack screen name). */
export function actionRouteName(action: NavAction): string {
  return action.type === 'tab' ? action.tab : action.screen;
}

/** The drawer key whose destination matches the currently-focused route (for the active highlight). */
export function activeDrawerKey(routeName: string | undefined): string | undefined {
  if (!routeName) return undefined;
  return DRAWER_ITEMS.find((i) => actionRouteName(i.action) === routeName)?.key;
}
