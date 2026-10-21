/**
 * The bottom tabs, in order: what each is called and its icon. Six at most fit a phone's tab bar;
 * everything else (Settings, Profile, Calendar, My Action Items, Reports) is in the side menu,
 * which lists these tabs first, in this order (drawer-menu).
 */
export const TAB_ITEMS = [
  { name: 'Dashboard', title: 'Home', icon: '🏠' },
  { name: 'MyTasks', title: 'My Tasks', icon: '✓' },
  { name: 'Projects', title: 'Projects', icon: '🗂' },
  { name: 'Meetings', title: 'Meetings', icon: '👥' },
  { name: 'Chat', title: 'Chat', icon: '💬' },
  { name: 'Notifications', title: 'Alerts', icon: '🔔' },
] as const;

export type TabName = (typeof TAB_ITEMS)[number]['name'];
