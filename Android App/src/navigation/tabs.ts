import type { IconName } from '../lib/icons';
import { textWidthEm } from '../lib/font-metrics';

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

/** The room a tab label has on a screen `width` dp wide: a fifth of it, less 2 dp on each side. */
export function tabLabelRoom(width: number): number {
  return width / TAB_ITEMS.length - 4;
}

const SCALE_STEPS = [1.3, 1.2, 1.15, 1.1, 1] as const;

/**
 * How far the phone's font size may grow a tab label on a screen `width` dp wide: the largest step
 * at which all five still fit on one line (navigation/tab-fit.test) — 1.2 on a 360 dp phone, 1 at
 * 320 dp (a larger Display size). Narrower than any step fits, the label shrinks to fit instead.
 */
export function tabLabelMaxScale(width: number): number {
  const room = tabLabelRoom(width);
  return SCALE_STEPS.find((s) => TAB_ITEMS.every((t) => textWidthEm(t.title) * TAB_LABEL_SIZE * s <= room)) ?? 1;
}

/** The cap on a 360 dp phone. */
export const TAB_LABEL_MAX_SCALE = tabLabelMaxScale(360);
