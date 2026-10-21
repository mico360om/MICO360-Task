import type { NavAction } from './nav-actions';
import { WEBSITE_ONLY_PAGES } from '../lib/website';

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
  { key: 'Activity', label: 'Activity', icon: '📈', action: { type: 'stack', screen: 'Activity' } },
  { key: 'Calendar', label: 'Calendar', icon: '📅', action: { type: 'stack', screen: 'Calendar' } },
  { key: 'Search', label: 'Search', icon: '🔍', action: { type: 'stack', screen: 'Search' } },
  { key: 'Reports', label: 'Reports', icon: '📊', action: { type: 'stack', screen: 'Reports' }, adminOnly: true },
  // The website's Admin menu (6b): User Management in the app; the other pages open on the website.
  { key: 'Users', label: 'User Management', icon: '🛡', action: { type: 'stack', screen: 'Users' }, adminOnly: true },
  ...WEBSITE_ONLY_PAGES.map((p) => ({ key: `website-${p.key}`, label: p.label, icon: p.icon, action: { type: 'website' as const, path: p.path }, adminOnly: true })),
  { key: 'Profile', label: 'Profile', icon: '👤', action: { type: 'stack', screen: 'Profile' } },
  { key: 'Settings', label: 'Settings', icon: '⚙️', action: { type: 'stack', screen: 'Settings' } },
  { key: 'About', label: 'About', icon: 'ℹ️', action: { type: 'stack', screen: 'About' } },
];

/** The drawer destinations for a user with these roles. */
export function drawerItemsFor(roles: readonly string[]): DrawerItem[] {
  return DRAWER_ITEMS.filter((i) => !i.adminOnly || roles.includes('ADMIN'));
}

/** The destination route name an action lands on (a tab name or a stack screen name; a website page's address). */
export function actionRouteName(action: NavAction): string {
  return action.type === 'tab' ? action.tab : action.type === 'website' ? action.path : action.screen;
}

/** The drawer key whose destination matches the currently-focused route (for the active highlight). */
export function activeDrawerKey(routeName: string | undefined): string | undefined {
  if (!routeName) return undefined;
  return DRAWER_ITEMS.find((i) => actionRouteName(i.action) === routeName)?.key;
}
