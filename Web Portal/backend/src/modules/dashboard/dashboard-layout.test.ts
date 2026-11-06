import { describe, it, expect } from 'vitest';
import { allowedWidgets, BUILT_IN_DEFAULTS, groupOf, groupWidgets, layoutInput, normalizeLayout, type DashboardLayout } from './dashboard-layout';

// 1.23.4 — the Dashboard's widgets: who may see which (today's visibility, owner call 1), the two built-in
// defaults, and how a saved arrangement is read back (new widgets at the default's place).
const ids = (l: DashboardLayout) => l.widgets.map((w) => w.id);

describe('who sees which widget (today’s visibility)', () => {
  it('administrators: every widget; everyone else: no admin-only charts; Approvals only for people who can approve', () => {
    expect(allowedWidgets({ admin: true, canApprove: true })).toEqual(['priorities', 'stats', 'open-tasks', 'approvals', 'due-soon', 'activity', 'status-chart', 'completion']);
    expect(allowedWidgets({ admin: false, canApprove: true })).toEqual(['priorities', 'stats', 'open-tasks', 'approvals', 'due-soon', 'activity']);
    expect(allowedWidgets({ admin: false, canApprove: false })).toEqual(['priorities', 'stats', 'open-tasks', 'due-soon', 'activity']);
    expect(groupOf(['ADMIN'])).toBe('admins');
    expect(groupOf(['EMPLOYEE'])).toBe('everyone');
    expect(groupWidgets('everyone')).toEqual(['priorities', 'stats', 'open-tasks', 'approvals', 'due-soon', 'activity']);
  });

  it('the two built-in defaults: My Priorities first and wide; today’s cards after; Your open tasks hidden for administrators', () => {
    expect(BUILT_IN_DEFAULTS.admins.widgets).toEqual([
      { id: 'priorities', hidden: false, size: 'wide' },
      { id: 'stats', hidden: false, size: 'wide' },
      { id: 'status-chart', hidden: false, size: 'small' },
      { id: 'completion', hidden: false, size: 'small' },
      { id: 'approvals', hidden: false, size: 'small' },
      { id: 'due-soon', hidden: false, size: 'small' },
      { id: 'activity', hidden: false, size: 'small' },
      { id: 'open-tasks', hidden: true, size: 'small' },
    ]);
    expect(ids(BUILT_IN_DEFAULTS.everyone)).toEqual(['priorities', 'stats', 'open-tasks', 'approvals', 'due-soon', 'activity']);
    expect(BUILT_IN_DEFAULTS.everyone.widgets.every((w) => !w.hidden)).toBe(true);
  });
});

describe('reading a saved arrangement back', () => {
  const base = BUILT_IN_DEFAULTS.everyone;
  const allowed = allowedWidgets({ admin: false, canApprove: true });

  it('keeps the person’s order, sizes and hidden widgets', () => {
    const saved = { widgets: [{ id: 'activity', hidden: false, size: 'wide' }, { id: 'priorities', hidden: false, size: 'small' }, { id: 'stats', hidden: true, size: 'wide' }, { id: 'open-tasks', hidden: false, size: 'small' }, { id: 'approvals', hidden: false, size: 'small' }, { id: 'due-soon', hidden: true, size: 'small' }] };
    expect(normalizeLayout(saved, base, allowed)).toEqual(saved);
  });

  it('a widget it doesn’t name (new in a later release, or newly allowed) comes in at the default’s place, as the default has it', () => {
    const saved = { widgets: [{ id: 'activity', hidden: false, size: 'small' }, { id: 'stats', hidden: false, size: 'wide' }, { id: 'due-soon', hidden: false, size: 'small' }] };
    // priorities (first in the default) goes first; open-tasks after stats; approvals after open-tasks.
    expect(ids(normalizeLayout(saved, base, allowed))).toEqual(['priorities', 'activity', 'stats', 'open-tasks', 'approvals', 'due-soon']);
    expect(normalizeLayout(saved, base, allowed).widgets[0]).toEqual({ id: 'priorities', hidden: false, size: 'wide' });
  });

  it('leaves out what the person may not see, unknown names and repeats', () => {
    const saved = { widgets: [{ id: 'status-chart', hidden: false, size: 'small' }, { id: 'nope', hidden: false, size: 'small' }, { id: 'stats', hidden: false, size: 'wide' }, { id: 'stats', hidden: true, size: 'small' }] };
    const out = normalizeLayout(saved, base, allowedWidgets({ admin: false, canApprove: false }));
    expect(ids(out)).toEqual(['priorities', 'stats', 'open-tasks', 'due-soon', 'activity']);
    expect(out.widgets[1]).toEqual({ id: 'stats', hidden: false, size: 'wide' });
  });

  it('anything unreadable is the default', () => {
    for (const raw of [null, undefined, 'x', 3, [], { widgets: 'no' }, { widgets: [{ id: 'stats', hidden: 'yes', size: 'huge' }] }]) {
      const out = normalizeLayout(raw, base, allowed);
      expect(ids(out)).toEqual(ids(base));
    }
  });
});

describe('what a save may say', () => {
  it('known widgets, each once, shown or hidden, small or wide', () => {
    expect(layoutInput.safeParse({ widgets: [{ id: 'stats', hidden: false, size: 'wide' }] }).success).toBe(true);
    expect(layoutInput.safeParse({ widgets: [{ id: 'nope', hidden: false, size: 'wide' }] }).success).toBe(false);
    expect(layoutInput.safeParse({ widgets: [{ id: 'stats', hidden: false, size: 'huge' }] }).success).toBe(false);
    expect(layoutInput.safeParse({ widgets: [{ id: 'stats', hidden: false, size: 'wide' }, { id: 'stats', hidden: true, size: 'wide' }] }).success).toBe(false);
    expect(layoutInput.safeParse({ widgets: [{ id: 'stats', hidden: false, size: 'wide', extra: 1 }] }).success).toBe(false);
    expect(layoutInput.safeParse({ widgets: [] }).success).toBe(true);
  });
});
