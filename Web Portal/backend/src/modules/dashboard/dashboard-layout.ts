import { z } from 'zod';

/**
 * 1.23.4 Smarter Dashboard — the widgets and their arrangement (owner 3): each person shows or hides each
 * widget, drags them into their own order and makes each Small (one column) or Wide (both columns); it is
 * saved to their account. An administrator saves two defaults — for administrators and for everyone else —
 * that people who never customized follow ("Reset to default" returns to it).
 *
 * Each widget keeps who may see it today (owner call 1): "Tasks by status" and "Project completion" are for
 * administrators (their report routes stay admin-only), Approvals for the people who can approve, the rest
 * for everyone. A person's arrangement only ever offers the widgets they may see.
 */

/** Every widget, in catalogue order. A later release adds its new ones at the end of this list. */
export const WIDGETS = ['priorities', 'stats', 'open-tasks', 'approvals', 'due-soon', 'activity', 'status-chart', 'completion'] as const;
export type WidgetId = (typeof WIDGETS)[number];
export const WIDGET_SIZES = ['small', 'wide'] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export interface WidgetPlace {
  id: WidgetId;
  hidden: boolean;
  size: WidgetSize;
}
export interface DashboardLayout {
  widgets: WidgetPlace[];
}

/** Whose default a layout is: administrators', or everyone else's. */
export type LayoutGroup = 'admins' | 'everyone';
export const LAYOUT_GROUPS: readonly LayoutGroup[] = ['admins', 'everyone'];

/** Only administrators see these (their figures come from admin-only report routes). */
export const ADMIN_ONLY: ReadonlySet<WidgetId> = new Set<WidgetId>(['status-chart', 'completion']);
/** Only people who can approve tasks (they run a project, or are an administrator) see this. */
export const APPROVERS_ONLY: ReadonlySet<WidgetId> = new Set<WidgetId>(['approvals']);

const place = (id: WidgetId, size: WidgetSize = 'small', hidden = false): WidgetPlace => ({ id, hidden, size });

/**
 * The built-in defaults: My Priorities Today first and wide, the stat tiles under it, then today's cards
 * in today's order. An administrator's "Your open tasks" is hidden, as today.
 */
export const BUILT_IN_DEFAULTS: Readonly<Record<LayoutGroup, DashboardLayout>> = {
  admins: {
    widgets: [place('priorities', 'wide'), place('stats', 'wide'), place('status-chart'), place('completion'), place('approvals'), place('due-soon'), place('activity'), place('open-tasks', 'small', true)],
  },
  everyone: {
    widgets: [place('priorities', 'wide'), place('stats', 'wide'), place('open-tasks'), place('approvals'), place('due-soon'), place('activity')],
  },
};

export const groupOf = (roles: readonly string[]): LayoutGroup => (roles.includes('ADMIN') ? 'admins' : 'everyone');

/** The widgets a group's default may hold (everyone else's: no admin-only ones). */
export function groupWidgets(group: LayoutGroup): WidgetId[] {
  return WIDGETS.filter((id) => group === 'admins' || !ADMIN_ONLY.has(id));
}

/** The widgets one person may see. */
export function allowedWidgets(person: { admin: boolean; canApprove: boolean }): WidgetId[] {
  return WIDGETS.filter((id) => (person.admin || !ADMIN_ONLY.has(id)) && (person.admin || person.canApprove || !APPROVERS_ONLY.has(id)));
}

const isWidget = (v: unknown): v is WidgetId => typeof v === 'string' && (WIDGETS as readonly string[]).includes(v);
const placeSchema = z.object({ id: z.enum(WIDGETS), hidden: z.boolean(), size: z.enum(WIDGET_SIZES) }).strict();

/** What a save may say: known widgets, each once, shown or hidden, Small or Wide. */
export const layoutInput = z
  .object({ widgets: z.array(placeSchema).max(WIDGETS.length) })
  .strict()
  .refine((l) => new Set(l.widgets.map((w) => w.id)).size === l.widgets.length, { message: 'Each widget can be listed once.', path: ['widgets'] });

/**
 * A saved arrangement as it applies now: its own order, sizes and hidden widgets for the ones the person
 * may see (unknown names, repeats and what they may not see are left out); every allowed widget it doesn't
 * name — new in a later release, or newly allowed — comes in at the default's place, as the default has it.
 * Anything unreadable is the default.
 */
export function normalizeLayout(raw: unknown, base: DashboardLayout, allowed: readonly WidgetId[]): DashboardLayout {
  const ok = new Set(allowed);
  const out: WidgetPlace[] = [];
  const seen = new Set<WidgetId>();
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { widgets?: unknown }).widgets) ? ((raw as { widgets: unknown[] }).widgets) : [];
  for (const item of list) {
    const parsed = placeSchema.safeParse(item);
    if (!parsed.success || !ok.has(parsed.data.id) || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push({ id: parsed.data.id, hidden: parsed.data.hidden, size: parsed.data.size });
  }
  const baseList = base.widgets.filter((w) => ok.has(w.id));
  // Each missing widget goes right after the nearest widget before it in the default that is present.
  for (let i = 0; i < baseList.length; i++) {
    const w = baseList[i]!;
    if (seen.has(w.id)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.findIndex((p) => p.id === baseList[j]!.id);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    out.splice(at, 0, { ...w });
    seen.add(w.id);
  }
  // Allowed but in neither (a base that lacks it): at the end, shown.
  for (const id of allowed) if (!seen.has(id) && isWidget(id)) out.push(place(id));
  return { widgets: out };
}
