import { ALL_PROJECTS_BOARD, type NavAction } from './nav-actions';
import type { IconName } from '../lib/icons';

export interface DrawerItem {
  key: string;
  label: string;
  icon: IconName;
  action: NavAction;
  /** Shown only to administrators (the server enforces the role as well). */
  adminOnly?: boolean;
  /** Shown to administrators and to people who run a project (the website's Management page). */
  leadsOnly?: boolean;
}

export interface DrawerSection {
  key: 'workspace' | 'communication' | 'admin' | 'account';
  /** The section's heading; the account rows have none. */
  title: string | null;
  items: readonly DrawerItem[];
}

const tab = (t: 'Dashboard' | 'MyTasks' | 'Projects' | 'Meetings' | 'Chat'): NavAction => ({ type: 'tab', tab: t });
const website = (path: string): NavAction => ({ type: 'website', path });

/**
 * The side menu, grouped and ordered as the website's sidebar (Workspace / Communication / Admin),
 * with the account pages under them. Rows for pages the app doesn't have yet open the website.
 * Search is not here: it is in the top bar on every tab.
 */
export const DRAWER_SECTIONS: readonly DrawerSection[] = [
  {
    key: 'workspace',
    title: 'Workspace',
    items: [
      { key: 'Dashboard', label: 'Dashboard', icon: 'nav.dashboard', action: tab('Dashboard') },
      { key: 'MyTasks', label: 'My Tasks', icon: 'nav.tasks', action: tab('MyTasks') },
      { key: 'AllBoard', label: 'Kanban Board', icon: 'nav.board', action: ALL_PROJECTS_BOARD },
      { key: 'Projects', label: 'Projects', icon: 'nav.projects', action: tab('Projects') },
      { key: 'Calendar', label: 'Calendar', icon: 'nav.calendar', action: { type: 'stack', screen: 'Calendar' } },
      { key: 'Timeline', label: 'Timeline', icon: 'nav.timeline', action: website('/timeline') },
      { key: 'Workload', label: 'Workload', icon: 'nav.workload', action: website('/workload') },
      { key: 'Meetings', label: 'Meetings', icon: 'nav.meetings', action: tab('Meetings') },
      { key: 'MyActionItems', label: 'My Action Items', icon: 'nav.actionItems', action: { type: 'stack', screen: 'MyActionItems' } },
      { key: 'Templates', label: 'Templates', icon: 'nav.templates', action: website('/templates') },
      { key: 'Management', label: 'Management', icon: 'nav.management', action: website('/management'), leadsOnly: true },
      { key: 'Reports', label: 'Reports', icon: 'nav.reports', action: { type: 'stack', screen: 'Reports' }, adminOnly: true },
    ],
  },
  {
    key: 'communication',
    title: 'Communication',
    items: [
      { key: 'Chat', label: 'Chat', icon: 'nav.chat', action: tab('Chat') },
      { key: 'MicoAi', label: 'MICO AI', icon: 'nav.ai', action: website('/mico-ai') },
      { key: 'Notifications', label: 'Notifications', icon: 'nav.notifications', action: { type: 'stack', screen: 'Notifications' } },
      { key: 'Activity', label: 'Activity', icon: 'nav.activity', action: { type: 'stack', screen: 'Activity' } },
    ],
  },
  {
    // The website's Admin menu (6b): User Management in the app; the other pages open on the website.
    key: 'admin',
    title: 'Admin',
    items: [
      { key: 'Users', label: 'User Management', icon: 'nav.users', action: { type: 'stack', screen: 'Users' }, adminOnly: true },
      { key: 'website-ai', label: 'AI Management', icon: 'nav.aiManagement', action: website('/admin/ai'), adminOnly: true },
      { key: 'website-settings', label: 'System Settings', icon: 'nav.sliders', action: website('/admin/settings'), adminOnly: true },
      { key: 'website-audit', label: 'Audit Logs', icon: 'nav.audit', action: website('/admin/audit'), adminOnly: true },
    ],
  },
  {
    key: 'account',
    title: null,
    items: [
      { key: 'Settings', label: 'Settings', icon: 'nav.settings', action: { type: 'stack', screen: 'Settings' } },
      { key: 'Profile', label: 'Profile', icon: 'kit.user', action: { type: 'stack', screen: 'Profile' } },
      { key: 'About', label: 'About', icon: 'misc.info', action: { type: 'stack', screen: 'About' } },
    ],
  },
];

/**
 * The menu for someone with these roles: Admin rows for administrators only, Management for
 * administrators and people who run a project (`canLead`); a section left empty is dropped.
 */
export function drawerSectionsFor(roles: readonly string[], canLead: boolean): DrawerSection[] {
  const admin = roles.includes('ADMIN');
  return DRAWER_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => (!i.adminOnly || admin) && (!i.leadsOnly || admin || canLead)) })).filter(
    (s) => s.items.length > 0,
  );
}

/** The destination route name an action lands on (a tab name or a stack screen name; a website page's address; a held link's first screen). */
export function actionRouteName(action: NavAction): string {
  if (action.type === 'link') return action.state.routes[0]?.name ?? '';
  return action.type === 'tab' ? action.tab : action.type === 'website' ? action.path : action.screen;
}

/** The drawer key whose destination matches the currently-focused route (for the active highlight). */
export function activeDrawerKey(routeName: string | undefined): string | undefined {
  if (!routeName) return undefined;
  for (const s of DRAWER_SECTIONS) {
    const hit = s.items.find((i) => actionRouteName(i.action) === routeName);
    if (hit) return hit.key;
  }
  return undefined;
}
