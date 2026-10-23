import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildTimeline } from './activity-feed.js';

const at = (minutesAgo) => new Date(Date.UTC(2026, 9, 10, 12, 0) - minutesAgo * 60_000).toISOString();
const e = (id, action, actorName, minutesAgo, meta) => ({ id, action, actorName, createdAt: at(minutesAgo), meta });

describe('the task timeline (activity, read-only), worded as on the web', () => {
  it('says what happened: a move with its statuses, people assigned, edits with their values', () => {
    expect(buildTimeline([e('a1', 'MOVED', 'Omar Ahmed', 1, { from: 'To Do', to: 'In Progress' })])[0])
      .toMatchObject({ actorName: 'Omar Ahmed', kind: 'moved', text: 'moved this task', path: ['To Do', 'In Progress'] });
    expect(buildTimeline([e('a1', 'ASSIGNED', 'Aisha Khan', 1, { assignee: 'Omar Ahmed' })])[0]).toMatchObject({ text: 'assigned Omar Ahmed' });
    expect(buildTimeline([e('a1', 'UPDATED', 'A', 1, { changes: [{ field: 'priority', from: 'NORMAL', to: 'HIGH' }, { field: 'dueDate', from: null, to: '2026-10-12' }] })])[0].text)
      .toBe('changed priority from Normal to High and set the due date to 12 Oct 2026');
    expect(buildTimeline([e('a1', 'ATTACHED', 'A', 1, { filename: 'report.pdf' })])[0].text).toBe('attached report.pdf');
    expect(buildTimeline([e('a1', 'PROJECT_CHANGED', 'A', 1, { fromProject: 'Rig Inspection', fromKey: 'RIG-4', toProject: 'Operations', toKey: 'OPS-17' })])[0].text)
      .toBe('moved this task from Rig Inspection (RIG-4) to Operations (OPS-17)');
    expect(buildTimeline([e('a1', 'PROJECT_MOVED_OUT', 'A', 1, { key: 'RIG-4', toProject: 'Operations', toKey: 'OPS-17' })])[0].text).toBe('moved RIG-4 to Operations (OPS-17)');
    expect(buildTimeline([e('a1', 'UPDATED', 'A', 1, { changes: [{ field: 'milestone', from: true, to: false }] })])[0].text).toBe('cleared its milestone');
  });

  it('folds a quick run by one person into one line, newest first', () => {
    const items = buildTimeline([
      e('a3', 'COMPLETED', 'Omar Ahmed', 2, { from: 'In Progress', to: 'Done' }),
      e('a2', 'MOVED', 'Omar Ahmed', 3, { from: 'To Do', to: 'In Progress' }),
      e('a1', 'CREATED', 'Omar Ahmed', 4),
    ]);
    expect(items.map((i) => [i.kind, i.text, i.count])).toEqual([['completed', 'completed this task', 2], ['created', 'created this task', 1]]);
    expect(items[0].path).toEqual(['To Do', 'In Progress', 'Done']);
  });
});

// The web app owns the wording (Web Portal/frontend/src/lib/activity-feed.ts, shared with the
// Android app). The copies can't be compared as text, so both turn the same activity into lines and
// this fails when they drift (skipped where the web app isn't checked out next to the extension).
const repo = resolve(__dirname, '../..');
const WEB = resolve(repo, 'Web Portal/frontend/src/lib/activity-feed.ts');
const web = existsSync(WEB) ? await import(pathToFileURL(WEB).href) : null;

describe.skipIf(!web)('activity: src/activity-feed.js matches the web app (lib/activity-feed.ts)', () => {
  // A small seeded generator, so the same histories are compared on every run.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }
  const ACTIONS = [
    ['CREATED', { title: 'X' }], ['task.created'], ['MOVED', { from: 'To Do', to: 'In Progress' }], ['MOVED', { from: 'In Progress', to: 'Review' }], ['MOVED'],
    ['COMPLETED', { from: 'Review', to: 'Done' }], ['REOPENED', { from: 'Done', to: 'To Do' }], ['task.moved', { from: 'A', to: 'B' }],
    ['ASSIGNED', { assignee: 'Omar Ahmed' }], ['ASSIGNED', { assignee: 'سارة Al Balushi' }], ['ASSIGNED'], ['UNASSIGNED', { assignee: 'Omar Ahmed' }], ['assignee.removed'],
    ['UPDATED', { changes: [{ field: 'priority', from: 'NORMAL', to: 'HIGH' }] }], ['UPDATED', { changes: [{ field: 'priority', from: 'HIGH', to: 'NORMAL' }] }],
    ['UPDATED', { changes: [{ field: 'dueDate', from: null, to: '2026-10-12' }, { field: 'description' }] }], ['UPDATED', { changes: [{ field: 'dueDate', from: '2026-10-12', to: null }] }],
    ['UPDATED', { changes: [{ field: 'dueDate', from: '2026-10-12', to: '2026-10-15T00:00:00.000Z' }] }], ['UPDATED', { changes: [{ field: 'title', from: 'Old', to: 'New name' }] }],
    ['UPDATED', { changes: [{ field: 'title', from: 'Old', to: '' }] }], ['UPDATED', { changes: [{ field: 'repeat', from: null, to: 'Repeats every week on Mon' }] }],
    ['UPDATED', { changes: [{ field: 'repeat', from: 'Repeats every week', to: null }] }], ['UPDATED', { changes: [{ field: 'repeat', from: 'Repeats every week', to: 'Repeats every day' }] }],
    ['UPDATED', { changes: [{ field: 'estimatedHours', from: 1, to: 2 }] }], ['UPDATED'], ['task.updated', { changes: 'not a list' }],
    ['CHECKLIST_ADDED', { text: 'One' }], ['CHECKLIST_ADDED', { text: 'Two' }], ['CHECKLIST_ADDED'], ['CHECKLIST_DONE', { text: 'One' }], ['CHECKLIST_REOPENED', { text: 'One' }],
    ['CHECKLIST_REMOVED', { text: 'Two' }], ['CHECKLIST_RENAMED', { from: 'Draft', to: 'Draft report' }], ['CHECKLIST_REORDERED', { count: 4 }],
    ['COMMENTED', { commentId: 'c1' }], ['ATTACHED', { filename: 'report.pdf' }], ['ATTACHED', { filename: 'b.png' }], ['ATTACHED'], ['ATTACHMENT_REMOVED', { filename: 'old.xlsx' }],
    ['BLOCKER_ADDED', { key: 'MICO-7', title: 'Get approval' }], ['BLOCKER_REMOVED', { key: 'MICO-8' }], ['BLOCKER_ADDED'],
    ['comment.added'], ['attachment.added'], ['checklist.added'], ['SOMETHING_ELSE'], [''],
    ['PROJECT_CHANGED', { fromProject: 'Rig Inspection', fromKey: 'RIG-4', toProject: 'Operations', toKey: 'OPS-17' }],
    ['PROJECT_CHANGED', { fromProject: 'Operations', fromKey: 'OPS-17', toProject: 'العمليات', toKey: 'OPR-2' }], ['PROJECT_CHANGED', { toProject: 'Operations' }],
    ['PROJECT_CHANGED', { fromKey: 'RIG-4', toKey: 'OPS-17' }], ['PROJECT_CHANGED'],
    ['PROJECT_MOVED_OUT', { key: 'RIG-4', title: 'Inspect', toProject: 'Operations', toKey: 'OPS-17' }], ['PROJECT_MOVED_OUT', { toProject: 'Operations' }], ['PROJECT_MOVED_OUT'],
    ['UPDATED', { changes: [{ field: 'milestone', from: true, to: false }] }], ['UPDATED', { changes: [{ field: 'milestone', from: false, to: true }] }],
    ['UPDATED', { changes: [{ field: 'dueDate', from: null, to: '2026-10-24' }, { field: 'milestone', from: true, to: false }] }],
  ];
  const ACTORS = ['Omar Ahmed', 'Aisha Khan', 'سارة'];
  const GAPS = [0, 1, 5, 29, 30, 31, 120];

  function history(rand) {
    const n = 1 + Math.floor(rand() * 9);
    let minutes = Math.floor(rand() * 10);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const [action, meta] = ACTIONS[Math.floor(rand() * ACTIONS.length)];
      const actor = rand() < 0.75 ? ACTORS[0] : ACTORS[Math.floor(rand() * ACTORS.length)];
      out.push({ id: `a${i}`, action, actorName: actor, ...(rand() < 0.05 ? {} : { createdAt: at(minutes) }), meta: meta ? JSON.parse(JSON.stringify(meta)) : rand() < 0.5 ? null : undefined });
      minutes += GAPS[Math.floor(rand() * GAPS.length)];
    }
    return out;
  }

  it('turns the same activity into the same lines', () => {
    const rand = rng(20261021);
    for (let i = 0; i < 1500; i += 1) {
      const entries = history(rand);
      expect(buildTimeline(entries), JSON.stringify(entries)).toEqual(web.buildTimeline(entries));
    }
    expect(buildTimeline([])).toEqual(web.buildTimeline([]));
  });

  it('words every single action the same way', () => {
    for (const [action, meta] of ACTIONS) {
      for (const actorName of ACTORS) {
        const entries = [{ id: 'x', action, actorName, createdAt: at(1), meta }];
        expect(buildTimeline(entries), action).toEqual(web.buildTimeline(entries));
      }
    }
  });
});
