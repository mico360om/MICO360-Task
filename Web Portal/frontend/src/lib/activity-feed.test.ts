import { describe, it, expect } from 'vitest';
import { buildTimeline, type FeedEntry } from './activity-feed';

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 10, 12, 0) - minutesAgo * 60_000).toISOString();
const e = (id: string, action: string, actorName: string, minutesAgo: number, meta?: Record<string, unknown>): FeedEntry => ({
  id,
  action,
  actorName,
  createdAt: at(minutesAgo),
  meta,
});

describe('buildTimeline: one readable line per event', () => {
  it('says what happened, with the old and new status of a move', () => {
    const [item] = buildTimeline([e('a1', 'MOVED', 'Omar Ahmed', 1, { from: 'To Do', to: 'In Progress' })]);
    expect(item).toMatchObject({ actorName: 'Omar Ahmed', kind: 'moved', text: 'moved this task', path: ['To Do', 'In Progress'] });
  });
  it('names who was assigned or taken off', () => {
    expect(buildTimeline([e('a1', 'ASSIGNED', 'Aisha Khan', 1, { assignee: 'Omar Ahmed' })])[0]).toMatchObject({ kind: 'assigned', text: 'assigned Omar Ahmed' });
    expect(buildTimeline([e('a1', 'UNASSIGNED', 'Aisha Khan', 1, { assignee: 'Omar Ahmed' })])[0]).toMatchObject({ kind: 'unassigned', text: 'unassigned Omar Ahmed' });
  });
  it('spells out edits: old and new values, dates as days', () => {
    const [item] = buildTimeline([
      e('a1', 'UPDATED', 'Aisha Khan', 1, {
        changes: [
          { field: 'priority', from: 'NORMAL', to: 'HIGH' },
          { field: 'dueDate', from: null, to: '2026-10-12' },
          { field: 'description' },
        ],
      }),
    ]);
    expect(item).toMatchObject({ kind: 'updated', text: 'changed priority from Normal to High, set the due date to 12 Oct 2026 and edited the description' });
    const one = (change: Record<string, unknown>) => buildTimeline([e('a1', 'UPDATED', 'A', 1, { changes: [change] })])[0]!.text;
    expect(one({ field: 'dueDate', from: '2026-10-12', to: null })).toBe('removed the due date');
    expect(one({ field: 'dueDate', from: '2026-10-12', to: '2026-10-15' })).toBe('moved the due date from 12 Oct 2026 to 15 Oct 2026');
    expect(one({ field: 'title', from: 'Old', to: 'New name' })).toBe('renamed it to “New name”');
    // the server describes a repeat as "Repeats every week on Mon"
    expect(one({ field: 'repeat', from: null, to: 'Repeats every week on Mon' })).toBe('made it repeat every week on Mon');
    expect(one({ field: 'repeat', from: 'Repeats every week', to: null })).toBe('stopped the repeat');
    expect(one({ field: 'repeat', from: 'Repeats every week', to: 'Repeats every day' })).toBe('changed the repeat to every day');
  });
  it('covers creation, completion and reopening, and older entries without details', () => {
    expect(buildTimeline([e('a1', 'CREATED', 'A', 1, { title: 'X' })])[0]).toMatchObject({ kind: 'created', text: 'created this task' });
    expect(buildTimeline([e('a1', 'COMPLETED', 'A', 1, { from: 'Review', to: 'Done' })])[0]).toMatchObject({
      kind: 'completed',
      text: 'completed this task',
      path: ['Review', 'Done'],
    });
    expect(buildTimeline([e('a1', 'REOPENED', 'A', 1, { from: 'Done', to: 'To Do' })])[0]).toMatchObject({ kind: 'reopened', text: 'reopened this task' });
    expect(buildTimeline([e('a1', 'MOVED', 'A', 1)])[0]).toMatchObject({ kind: 'moved', text: 'moved this task', path: undefined });
    expect(buildTimeline([e('a1', 'task.created', 'A', 1)])[0]).toMatchObject({ kind: 'created' });
    expect(buildTimeline([e('a1', 'SOMETHING_ELSE', 'A', 1)])[0]).toMatchObject({ kind: 'other', text: 'something else' });
  });
  it('says where a task moved to another project, with the keys it had there and has now', () => {
    const moved = { fromProject: 'Rig Inspection', fromKey: 'RIG-4', toProject: 'Operations', toKey: 'OPS-17' };
    expect(buildTimeline([e('a1', 'PROJECT_CHANGED', 'Aisha Khan', 1, moved)])[0]).toMatchObject({
      kind: 'other',
      actorName: 'Aisha Khan',
      text: 'moved this task from Rig Inspection (RIG-4) to Operations (OPS-17)',
    });
    // Each move is its own line, even right after another.
    const twice = buildTimeline([
      e('a2', 'PROJECT_CHANGED', 'A', 1, { fromProject: 'Operations', fromKey: 'OPS-17', toProject: 'Admin', toKey: 'ADM-3' }),
      e('a1', 'PROJECT_CHANGED', 'A', 2, moved),
    ]);
    expect(twice.map((i) => i.text)).toEqual(['moved this task from Operations (OPS-17) to Admin (ADM-3)', 'moved this task from Rig Inspection (RIG-4) to Operations (OPS-17)']);
    // Without the details, or only some of them, still a plain sentence.
    expect(buildTimeline([e('a1', 'PROJECT_CHANGED', 'A', 1)])[0]!.text).toBe('moved this task to another project');
    expect(buildTimeline([e('a1', 'PROJECT_CHANGED', 'A', 1, { toProject: 'Operations' })])[0]!.text).toBe('moved this task to Operations');
  });
});

describe('buildTimeline: checklist, comments, files and blockers', () => {
  const one = (action: string, meta?: Record<string, unknown>) => buildTimeline([e('a1', action, 'Omar Ahmed', 1, meta)])[0];
  it('names the step, the file or the blocker', () => {
    expect(one('CHECKLIST_ADDED', { text: 'Draft report' })).toMatchObject({ kind: 'checklist', text: 'added the step “Draft report”' });
    expect(one('CHECKLIST_DONE', { text: 'Draft report' })).toMatchObject({ kind: 'checklist', text: 'ticked off “Draft report”' });
    expect(one('CHECKLIST_REOPENED', { text: 'Draft report' })!.text).toBe('unticked “Draft report”');
    expect(one('CHECKLIST_REMOVED', { text: 'Draft report' })!.text).toBe('removed the step “Draft report”');
    expect(one('CHECKLIST_RENAMED', { from: 'Draft', to: 'Draft report' })!.text).toBe('renamed the step “Draft” to “Draft report”');
    expect(one('CHECKLIST_REORDERED', { count: 4 })).toMatchObject({ kind: 'checklist', text: 'reordered the checklist' });
    // several drags in a row are one line
    expect(buildTimeline([e('r2', 'CHECKLIST_REORDERED', 'A', 1), e('r1', 'CHECKLIST_REORDERED', 'A', 2)])).toEqual([expect.objectContaining({ text: 'reordered the checklist', count: 2 })]);
    expect(one('COMMENTED', { commentId: 'c1' })).toMatchObject({ kind: 'comment', text: 'commented' });
    expect(one('ATTACHED', { filename: 'report.pdf' })).toMatchObject({ kind: 'file', text: 'attached report.pdf' });
    expect(one('ATTACHMENT_REMOVED', { filename: 'report.pdf' })!.text).toBe('removed the file report.pdf');
    expect(one('BLOCKER_ADDED', { key: 'MICO-7', title: 'Get approval' })).toMatchObject({ kind: 'blocker', text: 'added the blocker MICO-7 “Get approval”' });
    expect(one('BLOCKER_REMOVED', { key: 'MICO-7', title: 'Get approval' })!.text).toBe('removed the blocker MICO-7 “Get approval”');
  });
  it('says "a blocker" when only the other task’s id was kept (it may be one you can’t open)', () => {
    expect(one('BLOCKER_ADDED', { dependsOnTaskId: 't9' })!.text).toBe('added a blocker');
    expect(one('BLOCKER_REMOVED', { dependsOnTaskId: 't9' })!.text).toBe('removed a blocker');
    const two = [e('b2', 'BLOCKER_ADDED', 'Omar Ahmed', 1, { dependsOnTaskId: 't8' }), e('b1', 'BLOCKER_ADDED', 'Omar Ahmed', 2, { dependsOnTaskId: 't9' })];
    expect(buildTimeline(two)).toEqual([expect.objectContaining({ text: 'added 2 blockers' })]);
  });
  it('folds a run of the same thing into one line, naming a few', () => {
    const steps = ['One', 'Two', 'Three', 'Four', 'Five'].map((text, i) => e(`s${i}`, 'CHECKLIST_ADDED', 'Omar Ahmed', 5 - i, { text })).reverse();
    expect(buildTimeline(steps)).toEqual([expect.objectContaining({ text: 'added 5 steps: “One”, “Two”, “Three” and 2 more', count: 5 })]);
    const comments = [e('c2', 'COMMENTED', 'Omar Ahmed', 1), e('c1', 'COMMENTED', 'Omar Ahmed', 2)];
    expect(buildTimeline(comments)).toEqual([expect.objectContaining({ text: 'left 2 comments' })]);
    const files = [e('f2', 'ATTACHED', 'Omar Ahmed', 1, { filename: 'b.png' }), e('f1', 'ATTACHED', 'Omar Ahmed', 1, { filename: 'a.pdf' })];
    expect(buildTimeline(files)).toEqual([expect.objectContaining({ text: 'attached a.pdf and b.png' })]);
  });
  it('keeps different things apart (adding steps, then ticking one off)', () => {
    const items = buildTimeline([
      e('a3', 'CHECKLIST_DONE', 'Omar Ahmed', 1, { text: 'One' }),
      e('a2', 'CHECKLIST_ADDED', 'Omar Ahmed', 2, { text: 'Two' }),
      e('a1', 'CHECKLIST_ADDED', 'Omar Ahmed', 3, { text: 'One' }),
    ]);
    expect(items.map((i) => i.text)).toEqual(['ticked off “One”', 'added 2 steps: “One” and “Two”']);
  });
});

describe('buildTimeline: repetitive runs collapse into one line (newest first)', () => {
  it('merges back-to-back moves by one person into a single status path', () => {
    const items = buildTimeline([
      e('a4', 'REOPENED', 'Omar Ahmed', 1, { from: 'Done', to: 'To Do' }),
      e('a3', 'COMPLETED', 'Omar Ahmed', 2, { from: 'In Progress', to: 'Done' }),
      e('a2', 'MOVED', 'Omar Ahmed', 3, { from: 'To Do', to: 'In Progress' }),
      e('a1', 'CREATED', 'Omar Ahmed', 4),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'a4', kind: 'reopened', count: 3, path: ['To Do', 'In Progress', 'Done', 'To Do'], createdAt: at(1) });
    expect(items[1]).toMatchObject({ kind: 'created' });
  });
  it('keeps moves apart when someone else acted in between or long after', () => {
    expect(
      buildTimeline([
        e('a3', 'MOVED', 'Omar Ahmed', 1, { from: 'B', to: 'C' }),
        e('a2', 'MOVED', 'Aisha Khan', 2, { from: 'A', to: 'B' }),
      ]),
    ).toHaveLength(2);
    expect(
      buildTimeline([
        e('a3', 'MOVED', 'Omar Ahmed', 1, { from: 'B', to: 'C' }),
        e('a2', 'MOVED', 'Omar Ahmed', 120, { from: 'A', to: 'B' }),
      ]),
    ).toHaveLength(2);
  });
  it('merges several people assigned at once', () => {
    const items = buildTimeline([
      e('a2', 'ASSIGNED', 'Aisha Khan', 1, { assignee: 'سارة Al Balushi' }),
      e('a1', 'ASSIGNED', 'Aisha Khan', 1, { assignee: 'Omar Ahmed' }),
    ]);
    expect(items).toEqual([expect.objectContaining({ kind: 'assigned', text: 'assigned Omar Ahmed and سارة Al Balushi', count: 2 })]);
  });
  it('merges quick successive edits, keeping the first old value and the last new one', () => {
    const items = buildTimeline([
      e('a2', 'UPDATED', 'A', 1, { changes: [{ field: 'priority', from: 'HIGH', to: 'URGENT' }] }),
      e('a1', 'UPDATED', 'A', 2, { changes: [{ field: 'priority', from: 'NORMAL', to: 'HIGH' }] }),
    ]);
    expect(items).toEqual([expect.objectContaining({ text: 'changed priority from Normal to Urgent' })]);
    // changed and changed back: nothing left to say, so the line goes
    expect(
      buildTimeline([
        e('a2', 'UPDATED', 'A', 1, { changes: [{ field: 'priority', from: 'HIGH', to: 'NORMAL' }] }),
        e('a1', 'UPDATED', 'A', 2, { changes: [{ field: 'priority', from: 'NORMAL', to: 'HIGH' }] }),
      ]),
    ).toEqual([]);
  });
});
