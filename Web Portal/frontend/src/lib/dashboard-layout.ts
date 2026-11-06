import { WIDGET_IDS, type DashboardLayout, type LayoutGroup, type WidgetId, type WidgetPlace, type WidgetSize } from '../api/dashboard';

/**
 * 1.23.4 Smarter Dashboard — the widgets' arrangement on the page (owner 3): each shown or hidden, in the
 * person's order, Small (one column) or Wide (both columns on a wide screen; a phone has one column, where
 * size is ignored but order and hidden widgets are kept). The server keeps it and decides who may see
 * which widget (modules/dashboard/dashboard-layout.ts); these are the page's moves and words.
 */

export const WIDGET_NAME: Record<WidgetId, string> = {
  priorities: 'My Priorities Today',
  stats: 'Stat tiles',
  'open-tasks': 'Your open tasks',
  approvals: 'Approvals',
  'due-soon': 'Due soon',
  activity: 'Recent activity',
  'status-chart': 'Tasks by status',
  completion: 'Project completion',
};

/** Only administrators see these (owner call 1). */
export const ADMIN_ONLY_WIDGETS: ReadonlySet<WidgetId> = new Set<WidgetId>(['status-chart', 'completion']);

export const CUSTOMIZE_WORDS = {
  open: 'Customize dashboard',
  title: 'Customize dashboard',
  note: 'Drag a widget by its handle, or use Move up and Move down. Hide what you don’t need, and make each one Small or Wide.',
  phoneNote: 'On a phone every widget takes the full width; your order and hidden widgets still apply.',
  reset: 'Reset to default',
  done: 'Done',
  cancel: 'Cancel',
  saveDefault: 'Save as the default',
  mine: 'My dashboard',
  admins: 'Default for administrators',
  everyone: 'Default for everyone else',
  arranging: 'Arranging',
  defaultNote: 'People who never customized their Dashboard follow this default. “Reset to default” returns to it.',
  everyoneNote: 'Everyone else doesn’t see the administrators’ charts, so they aren’t listed here.',
  saved: 'Your dashboard is saved.',
  savedDefault: (group: LayoutGroup) => (group === 'admins' ? 'Saved the default for administrators.' : 'Saved the default for everyone else.'),
  resetDone: 'Back to the default.',
  saveFailed: 'Couldn’t save the arrangement. Please try again.',
} as const;

const place = (id: WidgetId, size: WidgetSize = 'small', hidden = false): WidgetPlace => ({ id, hidden, size });

/** The built-in defaults (the server's), for while the account's arrangement is loading or can't be read. */
export function builtInLayout(admin: boolean): DashboardLayout {
  return admin
    ? { widgets: [place('priorities', 'wide'), place('stats', 'wide'), place('status-chart'), place('completion'), place('approvals'), place('due-soon'), place('activity'), place('open-tasks', 'small', true)] }
    : { widgets: [place('priorities', 'wide'), place('stats', 'wide'), place('open-tasks'), place('approvals'), place('due-soon'), place('activity')] };
}

const isPlace = (v: unknown): v is WidgetPlace => {
  const p = v as WidgetPlace;
  return !!p && typeof p === 'object' && (WIDGET_IDS as readonly string[]).includes(p.id) && typeof p.hidden === 'boolean' && (p.size === 'small' || p.size === 'wide');
};

/** The arrangement an answer holds (its readable widgets, each once), else the built-in default. */
export function layoutOrDefault(v: unknown, admin: boolean): DashboardLayout {
  const list = v && typeof v === 'object' && Array.isArray((v as DashboardLayout).widgets) ? (v as DashboardLayout).widgets : null;
  if (!list) return builtInLayout(admin);
  const seen = new Set<WidgetId>();
  const widgets = list.filter((w) => isPlace(w) && !seen.has(w.id) && (seen.add(w.id), true)).map((w) => ({ id: w.id, hidden: w.hidden, size: w.size }));
  return { widgets };
}

/** One place up (-1) or down (+1); the same layout when it can't go further. */
export function moveBy(layout: DashboardLayout, id: WidgetId, by: -1 | 1): DashboardLayout {
  const from = layout.widgets.findIndex((w) => w.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= layout.widgets.length) return layout;
  const widgets = [...layout.widgets];
  const [moved] = widgets.splice(from, 1);
  widgets.splice(to, 0, moved!);
  return { widgets };
}

/** A drag: `id` takes `overId`'s place. */
export function moveTo(layout: DashboardLayout, id: WidgetId, overId: WidgetId): DashboardLayout {
  const from = layout.widgets.findIndex((w) => w.id === id);
  const to = layout.widgets.findIndex((w) => w.id === overId);
  if (from < 0 || to < 0 || from === to) return layout;
  const widgets = [...layout.widgets];
  const [moved] = widgets.splice(from, 1);
  widgets.splice(to, 0, moved!);
  return { widgets };
}

/** What a screen reader hears: "Due soon moved to position 4 of 6." */
export function movedAnnouncement(layout: DashboardLayout, id: WidgetId): string {
  const at = layout.widgets.findIndex((w) => w.id === id);
  return `${WIDGET_NAME[id]} moved to position ${at + 1} of ${layout.widgets.length}.`;
}

export function toggleHidden(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  return { widgets: layout.widgets.map((w) => (w.id === id ? { ...w, hidden: !w.hidden } : w)) };
}

export function setSize(layout: DashboardLayout, id: WidgetId, size: WidgetSize): DashboardLayout {
  return { widgets: layout.widgets.map((w) => (w.id === id ? { ...w, size } : w)) };
}

/** An administrator arranging "everyone else's" default sees it without the admin-only charts. */
export function previewFor(layout: DashboardLayout, group: LayoutGroup): DashboardLayout {
  if (group === 'admins') return layout;
  return { widgets: layout.widgets.filter((w) => !ADMIN_ONLY_WIDGETS.has(w.id)) };
}
