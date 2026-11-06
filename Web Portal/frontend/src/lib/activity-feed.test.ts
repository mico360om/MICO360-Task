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
  it('the old project’s line says where its task went', () => {
    const left = { key: 'RIG-4', title: 'Inspect the rig', fromProject: 'Rig Inspection', toProject: 'Operations', toKey: 'OPS-17' };
    expect(buildTimeline([e('a1', 'PROJECT_MOVED_OUT', 'Aisha Khan', 1, left)])[0]).toMatchObject({ kind: 'other', text: 'moved RIG-4 to Operations (OPS-17)' });
    expect(buildTimeline([e('a1', 'PROJECT_MOVED_OUT', 'A', 1, { toProject: 'Operations', toKey: 'OPS-17' })])[0]!.text).toBe('moved a task to Operations (OPS-17)');
    expect(buildTimeline([e('a1', 'PROJECT_MOVED_OUT', 'A', 1, { key: 'RIG-4' })])[0]!.text).toBe('moved RIG-4 to another project');
  });
  it('says what changed in a project’s companies (parts with nothing in them left out)', () => {
    const line = (meta?: Record<string, unknown>) => buildTimeline([e('a1', 'PROJECT_COMPANIES_CHANGED', 'Aisha Khan', 1, meta)])[0]!;
    expect(line({ added: ['Beta Co'], removed: ['Gamma Co'], main: 'Alpha Co' })).toMatchObject({ kind: 'other', text: 'changed this project’s companies — added Beta Co; removed Gamma Co; main company now Alpha Co' });
    expect(line({ added: ['Beta Co'], removed: [], main: 'Beta Co' }).text).toBe('changed this project’s companies — added Beta Co; main company now Beta Co');
    expect(line({ added: ['Beta Co', 'Delta Co', 'Echo Co'], removed: [], main: null }).text).toBe('changed this project’s companies — added Beta Co, Delta Co and Echo Co');
    expect(line({ added: [], removed: ['Gamma Co'], main: null }).text).toBe('changed this project’s companies — removed Gamma Co');
    expect(line().text).toBe('changed this project’s companies');
  });
  it('a milestone set or cleared', () => {
    const one = (change: Record<string, unknown>) => buildTimeline([e('a1', 'UPDATED', 'A', 1, { changes: [change] })])[0]!.text;
    expect(one({ field: 'milestone', from: true, to: false })).toBe('cleared its milestone');
    expect(one({ field: 'milestone', from: false, to: true })).toBe('made it a milestone');
    // With the due date a move gives it: one line.
    expect(buildTimeline([e('a1', 'UPDATED', 'A', 1, { changes: [{ field: 'dueDate', from: null, to: '2026-10-24' }, { field: 'milestone', from: true, to: false }] })])[0]!.text).toBe(
      'set the due date to 24 Oct 2026 and cleared its milestone',
    );
  });
  it('shown to or hidden from the project’s client', () => {
    const one = (change: Record<string, unknown>) => buildTimeline([e('a1', 'UPDATED', 'A', 1, { changes: [change] })])[0]!.text;
    expect(one({ field: 'clientVisible', from: false, to: true })).toBe('made this visible to the client');
    expect(one({ field: 'clientVisible', from: true, to: false })).toBe('hid this from the client');
    // Switched on and off again within a few minutes: nothing changed, nothing to say.
    const both = buildTimeline([
      e('a2', 'UPDATED', 'A', 2, { changes: [{ field: 'clientVisible', from: true, to: false }] }),
      e('a1', 'UPDATED', 'A', 1, { changes: [{ field: 'clientVisible', from: false, to: true }] }),
    ]);
    expect(both).toEqual([]);
    // Taken off by a move to another project: the line says why.
    expect(one({ field: 'clientVisible', from: true, to: false, reason: 'moved' })).toBe('hid this from the client (moved to another project)');
    expect(
      buildTimeline([e('a1', 'UPDATED', 'A', 1, { changes: [{ field: 'milestone', from: true, to: false }, { field: 'clientVisible', from: true, to: false, reason: 'moved' }] })])[0]!.text,
    ).toBe('cleared its milestone and hid this from the client (moved to another project)');
  });
  it('a task’s inspection form and place (a scheduled check): every change has its words, a run of them too', () => {
    const one = (change: Record<string, unknown>) => buildTimeline([e('a1', 'UPDATED', 'A', 1, { changes: [change] })])[0]!.text;
    expect(one({ field: 'inspectionForm', from: null, to: 'f1' })).toBe('gave it an inspection form');
    expect(one({ field: 'inspectionForm', from: 'f1', to: 'f2' })).toBe('changed its inspection form');
    expect(one({ field: 'inspectionForm', from: 'f1', to: null })).toBe('took off its inspection form');
    expect(one({ field: 'inspectionPlace', from: null, to: 'Rig 3' })).toBe('set the place to “Rig 3”');
    expect(one({ field: 'inspectionPlace', from: 'Rig 3', to: 'الحفار ٤' })).toBe('changed the place to “الحفار ٤”');
    expect(one({ field: 'inspectionPlace', from: 'Rig 3', to: null })).toBe('removed the place');
    // The form, then the place five minutes later: one line that says both.
    const run = buildTimeline([
      e('a2', 'UPDATED', 'A', 1, { changes: [{ field: 'inspectionPlace', from: 'Rig 3', to: 'Rig 4' }] }),
      e('a1', 'UPDATED', 'A', 6, { changes: [{ field: 'inspectionForm', from: 'f1', to: 'f2' }] }),
    ]);
    expect(run.map((x) => x.text)).toEqual(['changed its inspection form and changed the place to “Rig 4”']);
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
    expect(one('CHECKLIST_DONE', { text: 'Draft report' })).toMatchObject({ kind: 'checklist', text: 'ticked “Draft report”' });
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
    expect(items.map((i) => i.text)).toEqual(['ticked “One”', 'added 2 steps: “One” and “Two”']);
  });
});

describe('buildTimeline: nested checklists (1.23.3)', () => {
  const one = (action: string, meta?: Record<string, unknown>) => buildTimeline([e('a1', action, 'Khurram', 1, meta)])[0]!;
  it('says what happened to an item, in plain words', () => {
    expect(one('CHECKLIST_ADDED', { itemId: 'i1', text: 'Label circuits', listTitle: 'Electrical' })).toMatchObject({ kind: 'checklist', text: 'added “Label circuits” to Electrical' });
    expect(one('CHECKLIST_ADDED', { itemId: 'i1', text: 'Label circuits', listTitle: 'Electrical', parentText: 'Wiring' }).text).toBe('added “Label circuits” under “Wiring” in Electrical');
    expect(one('CHECKLIST_ADDED', { count: 3, texts: ['A', 'B', 'C'], listTitle: 'Electrical' }).text).toBe('added 3 items to Electrical: “A”, “B” and “C”');
    expect(one('CHECKLIST_ADDED', { count: 7, texts: ['A', 'B', 'C', 'D', 'E'], listTitle: 'Electrical', parentText: 'Wiring' }).text).toBe('added 7 items under “Wiring” in Electrical: “A”, “B”, “C” and 4 more');
    expect(one('CHECKLIST_DONE', { itemId: 'i1', text: 'Label circuits' }).text).toBe('ticked “Label circuits”');
    expect(one('CHECKLIST_ASSIGNED', { itemId: 'i1', text: 'Label circuits', assigneeId: 'u2', assignee: 'Omar Ahmed' }).text).toBe('assigned “Label circuits” to Omar Ahmed');
    expect(one('CHECKLIST_UNASSIGNED', { itemId: 'i1', text: 'Label circuits', assigneeId: 'u2', assignee: 'Omar Ahmed' }).text).toBe('took Omar Ahmed off “Label circuits”');
    expect(one('CHECKLIST_DUE', { itemId: 'i1', text: 'Label circuits', from: null, to: '2026-11-03' }).text).toBe('set “Label circuits” due on 3 Nov 2026');
    expect(one('CHECKLIST_DUE', { itemId: 'i1', text: 'Label circuits', from: '2026-11-03', to: '2026-11-05' }).text).toBe('moved the due date of “Label circuits” from 3 Nov 2026 to 5 Nov 2026');
    expect(one('CHECKLIST_DUE', { itemId: 'i1', text: 'Label circuits', from: '2026-11-03', to: null }).text).toBe('removed the due date of “Label circuits”');
    expect(one('CHECKLIST_MOVED', { itemId: 'i1', text: 'Label circuits', how: 'indent' }).text).toBe('indented “Label circuits”');
    expect(one('CHECKLIST_MOVED', { itemId: 'i1', text: 'Label circuits', how: 'outdent' }).text).toBe('outdented “Label circuits”');
    expect(one('CHECKLIST_MOVED', { itemId: 'i1', text: 'Label circuits', how: 'up' }).text).toBe('moved “Label circuits” up');
    expect(one('CHECKLIST_MOVED', { itemId: 'i1', text: 'Label circuits', how: 'down' }).text).toBe('moved “Label circuits” down');
    expect(one('CHECKLIST_MOVED', { itemId: 'i1', text: 'Label circuits', how: 'move' }).text).toBe('moved “Label circuits”');
    expect(one('CHECKLIST_DUPLICATED', { itemId: 'i1', text: 'Wiring', count: 3 }).text).toBe('duplicated “Wiring” and its 2 sub-items');
    expect(one('CHECKLIST_DUPLICATED', { itemId: 'i1', text: 'Lights', count: 1 }).text).toBe('duplicated “Lights”');
    expect(one('CHECKLIST_REMOVED', { itemId: 'i1', text: 'Wiring', count: 4, batchId: 'b1' })).toMatchObject({ text: 'deleted “Wiring” and its 3 sub-items', batchId: 'b1' });
    expect(one('CHECKLIST_REMOVED', { itemId: 'i1', text: 'Lights', count: 1, batchId: 'b2' }).text).toBe('deleted “Lights”');
    expect(one('CHECKLIST_RESTORED', { text: 'Wiring', count: 2, batchId: 'b1' }).text).toBe('restored “Wiring” and its 1 sub-item');
  });
  it('says what happened to a whole checklist', () => {
    expect(one('CHECKLIST_LIST_ADDED', { listId: 'l1', title: 'Electrical' })).toMatchObject({ kind: 'checklist', text: 'added the checklist “Electrical”' });
    expect(one('CHECKLIST_LIST_RENAMED', { listId: 'l1', from: 'Checklist', to: 'Electrical' }).text).toBe('renamed the checklist “Checklist” to “Electrical”');
    expect(one('CHECKLIST_LIST_DUPLICATED', { listId: 'l2', title: 'Electrical', count: 8 }).text).toBe('duplicated the checklist “Electrical” (8 items)');
    expect(one('CHECKLIST_LIST_REMOVED', { listId: 'l1', title: 'Electrical', count: 8, batchId: 'b3' })).toMatchObject({ text: 'deleted the checklist “Electrical” (8 items)', batchId: 'b3' });
    expect(one('CHECKLIST_LIST_REMOVED', { listId: 'l1', title: 'Spare', count: 0, batchId: 'b4' }).text).toBe('deleted the checklist “Spare”');
  });
  it('groups single adds by one person to one checklist within a couple of minutes', () => {
    const adds = [
      e('x3', 'CHECKLIST_ADDED', 'Khurram', 1, { text: 'C', listTitle: 'Electrical' }),
      e('x2', 'CHECKLIST_ADDED', 'Khurram', 2, { text: 'B', listTitle: 'Electrical' }),
      e('x1', 'CHECKLIST_ADDED', 'Khurram', 3, { count: 2, texts: ['A1', 'A2'], listTitle: 'Electrical' }),
    ];
    expect(buildTimeline(adds)).toEqual([expect.objectContaining({ text: 'added 4 items to Electrical: “A1”, “A2”, “B” and “C”', count: 3 })]);
    // Ten minutes apart: two lines.
    const apart = [e('y2', 'CHECKLIST_ADDED', 'Khurram', 1, { text: 'B', listTitle: 'Electrical' }), e('y1', 'CHECKLIST_ADDED', 'Khurram', 11, { text: 'A', listTitle: 'Electrical' })];
    expect(buildTimeline(apart).map((i) => i.text)).toEqual(['added “B” to Electrical', 'added “A” to Electrical']);
    // Another checklist: its own line.
    const lists = [e('z2', 'CHECKLIST_ADDED', 'Khurram', 1, { text: 'Pipes', listTitle: 'Plumbing' }), e('z1', 'CHECKLIST_ADDED', 'Khurram', 1, { text: 'A', listTitle: 'Electrical' })];
    expect(buildTimeline(lists).map((i) => i.text)).toEqual(['added “Pipes” to Plumbing', 'added “A” to Electrical']);
  });
  it('never folds deletes together, so each can be restored on its own', () => {
    const deletes = [
      e('d2', 'CHECKLIST_REMOVED', 'Khurram', 1, { text: 'B', count: 1, batchId: 'b2' }),
      e('d1', 'CHECKLIST_REMOVED', 'Khurram', 1, { text: 'A', count: 1, batchId: 'b1' }),
    ];
    expect(buildTimeline(deletes).map((i) => [i.text, i.batchId])).toEqual([
      ['deleted “B”', 'b2'],
      ['deleted “A”', 'b1'],
    ]);
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

describe('buildTimeline: changes made through MICO AI', () => {
  const via = { via: 'mico-ai' };
  it('says so after the line, for every kind of change', () => {
    expect(buildTimeline([e('a1', 'CREATED', 'Sara Ahmed', 1, { title: 'X', ...via })])[0]).toMatchObject({ actorName: 'Sara Ahmed', text: 'created this task via MICO AI' });
    expect(buildTimeline([e('a1', 'UPDATED', 'Sara Ahmed', 1, { changes: [{ field: 'dueDate', from: '2026-10-19', to: '2026-10-25' }], ...via })])[0]!.text).toBe(
      'moved the due date from 19 Oct 2026 to 25 Oct 2026 via MICO AI',
    );
    expect(buildTimeline([e('a1', 'ASSIGNED', 'Sara Ahmed', 1, { assignee: 'Omar Ahmed', ...via })])[0]!.text).toBe('assigned Omar Ahmed via MICO AI');
    expect(buildTimeline([e('a1', 'COMPLETED', 'Sara Ahmed', 1, { from: 'Review', to: 'Done', ...via })])[0]).toMatchObject({ text: 'completed this task via MICO AI', path: ['Review', 'Done'] });
  });
  it('a line made through MICO AI never folds into one made by hand (or the other way round)', () => {
    const items = buildTimeline([
      e('a3', 'ASSIGNED', 'Sara Ahmed', 1, { assignee: 'Bilal Ahmed' }),
      e('a2', 'ASSIGNED', 'Sara Ahmed', 2, { assignee: 'Omar Ahmed', ...via }),
      e('a1', 'ASSIGNED', 'Sara Ahmed', 3, { assignee: 'Zara Ahmed', ...via }),
    ]);
    expect(items.map((i) => i.text)).toEqual(['assigned Bilal Ahmed', 'assigned Zara Ahmed and Omar Ahmed via MICO AI']);
  });
  it('any other value is not MICO AI', () => {
    expect(buildTimeline([e('a1', 'CREATED', 'A', 1, { via: 'something' })])[0]!.text).toBe('created this task');
  });
});

describe('inspections in a task’s history', () => {
  it('says an inspection was attached, finished (with its result), or that this task follows one up', () => {
    const text = (action: string, meta?: Record<string, unknown>) => buildTimeline([e('a1', action, 'Ivan Inspector', 1, meta)])[0]!.text;
    expect(text('INSPECTION_ATTACHED', { inspection: 'Rig daily check' })).toBe('attached the inspection “Rig daily check”');
    expect(text('INSPECTION_FINISHED', { inspection: 'Rig daily check', failed: 0 })).toBe('finished the inspection “Rig daily check”: passed');
    expect(text('INSPECTION_FINISHED', { inspection: 'Rig daily check', failed: 1 })).toBe('finished the inspection “Rig daily check”: 1 item failed');
    expect(text('INSPECTION_FINISHED', { inspection: 'Rig daily check', failed: 3 })).toBe('finished the inspection “Rig daily check”: 3 items failed');
    expect(text('INSPECTION_FOLLOW_UP', { inspection: 'Rig daily check', item: 'Guard rails fitted' })).toBe('made this a follow-up of “Guard rails fitted” in the inspection “Rig daily check”');
    expect(text('INSPECTION_FOLLOW_UP', { inspection: 'Rig daily check' })).toBe('made this a follow-up of the inspection “Rig daily check”');
    expect(text('INSPECTION_ATTACHED')).toBe('attached an inspection');
    expect(text('INSPECTION_FINISHED')).toBe('finished an inspection');
    expect(text('INSPECTION_FOLLOW_UP')).toBe('made this a follow-up of an inspection');
  });
  it('keeps each one a line of its own', () => {
    const items = buildTimeline([
      e('a3', 'INSPECTION_FINISHED', 'Ivan', 1, { inspection: 'A', failed: 0 }),
      e('a2', 'INSPECTION_ATTACHED', 'Ivan', 2, { inspection: 'B' }),
      e('a1', 'INSPECTION_ATTACHED', 'Ivan', 3, { inspection: 'A' }),
    ]);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.kind === 'other')).toBe(true);
  });
});

describe('approvals in a task’s history', () => {
  const line = (action: string, meta?: Record<string, unknown>) => buildTimeline([e('a1', action, 'Sara Ali', 1, meta)])[0]!;
  it('asked for approval, approved, sent back with the reason, the request withdrawn', () => {
    expect(line('APPROVAL_REQUESTED', { from: 'In Progress', to: 'Review' })).toMatchObject({ kind: 'other', text: 'finished this task and asked for approval', path: ['In Progress', 'Review'] });
    expect(line('APPROVED', { from: 'Review', to: 'Done' })).toMatchObject({ kind: 'completed', text: 'approved this task', path: ['Review', 'Done'] });
    expect(line('SENT_BACK', { from: 'Review', to: 'In Progress', reason: 'Add the gauge readings' })).toMatchObject({
      kind: 'other',
      text: 'sent this task back: “Add the gauge readings”',
      path: ['Review', 'In Progress'],
    });
    expect(line('SENT_BACK', {}).text).toBe('sent this task back');
    expect(line('APPROVAL_WITHDRAWN', { from: 'Review', to: 'In Progress' })).toMatchObject({ kind: 'other', text: 'withdrew the approval request' });
  });
  it('an approver finishing it themselves: completed (approved)', () => {
    expect(line('COMPLETED', { from: 'In Progress', to: 'Done', approved: true })).toMatchObject({ kind: 'completed', text: 'completed this task (approved)' });
    expect(line('COMPLETED', { from: 'In Progress', to: 'Done' }).text).toBe('completed this task');
  });
  it('the tick turned on or off', () => {
    expect(line('UPDATED', { changes: [{ field: 'needsApproval', from: false, to: true }] }).text).toBe('turned on Needs approval');
    expect(line('UPDATED', { changes: [{ field: 'needsApproval', from: true, to: false }] }).text).toBe('turned off Needs approval');
  });
  it('a request, a send-back and the next request stay lines of their own', () => {
    const items = buildTimeline([
      e('a3', 'APPROVAL_REQUESTED', 'Sara Ali', 1, { from: 'In Progress', to: 'Review' }),
      e('a2', 'SENT_BACK', 'Omar Ahmed', 2, { from: 'Review', to: 'In Progress', reason: 'Redo' }),
      e('a1', 'APPROVAL_REQUESTED', 'Sara Ali', 3, { from: 'In Progress', to: 'Review' }),
    ]);
    expect(items.map((i) => i.text)).toEqual(['finished this task and asked for approval', 'sent this task back: “Redo”', 'finished this task and asked for approval']);
  });
});

describe('external contacts in a task’s history', () => {
  const oxy = { name: 'Ahmed Al Said', company: 'OXY' };
  it('says who was added, changed or removed, with their company', () => {
    expect(buildTimeline([e('a1', 'EXTERNAL_CONTACT_ADDED', 'Sara Ali', 1, oxy)])[0]).toMatchObject({ kind: 'external', text: 'added an external contact: Ahmed Al Said (OXY)' });
    expect(buildTimeline([e('a1', 'EXTERNAL_CONTACT_CHANGED', 'Sara Ali', 1, oxy)])[0]!.text).toBe('changed an external contact: Ahmed Al Said (OXY)');
    expect(buildTimeline([e('a1', 'EXTERNAL_CONTACT_REMOVED', 'Sara Ali', 1, { name: 'Salim', company: null })])[0]!.text).toBe('removed an external contact: Salim');
    expect(buildTimeline([e('a1', 'EXTERNAL_CONTACT_ADDED', 'Sara Ali', 1, {})])[0]!.text).toBe('added an external contact');
  });
  it('folds a quick run into one line, naming a few; a contact changed twice is named once', () => {
    const added = buildTimeline([
      e('a3', 'EXTERNAL_CONTACT_ADDED', 'Sara Ali', 1, { name: 'Salim', company: null }),
      e('a2', 'EXTERNAL_CONTACT_ADDED', 'Sara Ali', 2, { name: 'Sara Nasser', company: 'PDO' }),
      e('a1', 'EXTERNAL_CONTACT_ADDED', 'Sara Ali', 3, oxy),
    ]);
    expect(added.map((i) => [i.text, i.count])).toEqual([['added 3 external contacts: Ahmed Al Said (OXY), Sara Nasser (PDO) and Salim', 3]]);
    const changed = buildTimeline([e('a2', 'EXTERNAL_CONTACT_CHANGED', 'Sara Ali', 1, oxy), e('a1', 'EXTERNAL_CONTACT_CHANGED', 'Sara Ali', 2, oxy)]);
    expect(changed.map((i) => i.text)).toEqual(['changed an external contact: Ahmed Al Said (OXY)']);
    const removed = buildTimeline([e('a2', 'EXTERNAL_CONTACT_REMOVED', 'Sara Ali', 1, oxy), e('a1', 'EXTERNAL_CONTACT_REMOVED', 'Sara Ali', 2, { name: 'Salim' })]);
    expect(removed.map((i) => i.text)).toEqual(['removed 2 external contacts: Salim and Ahmed Al Said (OXY)']);
  });
  it('keeps adding and removing apart', () => {
    const items = buildTimeline([e('a2', 'EXTERNAL_CONTACT_REMOVED', 'Sara Ali', 1, oxy), e('a1', 'EXTERNAL_CONTACT_ADDED', 'Sara Ali', 2, oxy)]);
    expect(items.map((i) => i.text)).toEqual(['removed an external contact: Ahmed Al Said (OXY)', 'added an external contact: Ahmed Al Said (OXY)']);
  });
});

// 1.23: a client's sign-off in a task's history ("… (client)" is in the actor's name from the server).
describe('a client’s sign-off in a task’s history', () => {
  const line = (action: string, meta?: Record<string, unknown>) => buildTimeline([e('a1', action, 'Hamad Al Busaidi (client)', 1, meta)])[0]!;
  it('accepted, or sent back with the reason', () => {
    expect(line('CLIENT_ACCEPTED', { client: true })).toMatchObject({ kind: 'other', actorName: 'Hamad Al Busaidi (client)', text: 'accepted this task (client sign-off)' });
    expect(line('CLIENT_SENT_BACK', { client: true, reason: 'The gauge photo is missing', commentId: 'c9' })).toMatchObject({
      kind: 'other',
      text: 'sent this task back: “The gauge photo is missing”',
    });
    expect(line('CLIENT_SENT_BACK', { client: true }).text).toBe('sent this task back');
  });
  it('a client’s comment reads as any comment', () => {
    expect(line('COMMENTED', { commentId: 'c1', client: true })).toMatchObject({ kind: 'comment', text: 'commented' });
  });
  it('each sign-off is a line of its own', () => {
    const items = buildTimeline([
      e('a2', 'CLIENT_ACCEPTED', 'Hamad Al Busaidi (client)', 1, { client: true }),
      e('a1', 'CLIENT_SENT_BACK', 'Hamad Al Busaidi (client)', 2, { client: true, reason: 'Redo' }),
    ]);
    expect(items.map((i) => i.text)).toEqual(['accepted this task (client sign-off)', 'sent this task back: “Redo”']);
  });
});

describe('merging tasks in a task’s history (1.23.1)', () => {
  const line = (action: string, meta?: Record<string, unknown>) => buildTimeline([e('a1', action, 'Aisha Khan', 1, meta)])[0]!;
  it('the main task: what was merged into it, and who was left off', () => {
    expect(line('TASKS_MERGED', { keys: ['MICO-14', 'MICO-15'], mainKey: 'MICO-12' })).toMatchObject({ kind: 'other', text: 'merged MICO-14 and MICO-15 into this task' });
    expect(line('TASKS_MERGED', { keys: ['MICO-14'], mainKey: 'OPS-3', fromKey: 'MICO-12', toProject: 'Operations', leftOff: ['Sara Al Balushi'] }).text).toBe(
      'merged MICO-14 into this task, moving it to Operations as OPS-3; left Sara Al Balushi off (not on the team)',
    );
  });
  it('a merged task, and an undone merge', () => {
    expect(line('MERGED_INTO', { key: 'MICO-14', intoKey: 'MICO-12' }).text).toBe('merged this task into MICO-12');
    expect(line('MERGE_UNDONE', { keys: ['MICO-14', 'MICO-15'], mainKey: 'MICO-12' }).text).toBe('undid the merge of MICO-14 and MICO-15');
    expect(line('MERGE_UNDONE', { keys: ['MICO-14'], mainKey: 'MICO-12', fromMain: true }).text).toBe('undid its merge into MICO-12: this is a separate task again');
  });
});
