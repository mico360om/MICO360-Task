import type { IconName } from '../lib/icons';

/**
 * The bottom tabs, in order, as the website's phone layout: what each is called and its drawn
 * icon. Notifications are the bell in the top bar; everything else is in the side menu
 * (drawer-menu), grouped like the website's sidebar.
 */
export const TAB_ITEMS = [
  { name: 'Dashboard', title: 'Dashboard', icon: 'nav.dashboard' },
  { name: 'MyTasks', title: 'My Tasks', icon: 'nav.tasks' },
  { name: 'Projects', title: 'Projects', icon: 'nav.projects' },
  { name: 'Meetings', title: 'Meetings', icon: 'nav.meetings' },
  { name: 'Chat', title: 'Chat', icon: 'nav.chat' },
] as const satisfies ReadonlyArray<{ name: string; title: string; icon: IconName }>;

export type TabName = (typeof TAB_ITEMS)[number]['name'];

/** The tab labels' size (dp, the website's 11 px tab text). */
export const TAB_LABEL_SIZE = 11;

/**
 * How far the phone's font size may grow a tab label: the largest step at which all five still
 * fit a fifth of a 360 dp phone on one line (navigation/tab-fit.test).
 */
export const TAB_LABEL_MAX_SCALE = 1.2;
