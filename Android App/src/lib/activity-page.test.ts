import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTIVITY_FILTERS,
  ACTION_TONE,
  ACTION_VERB,
  activityDetail,
  activityEmpty,
  actorInitials,
  activityLine,
  activityRowLabel,
  activityVerb,
  filterActivity,
  groupActivity,
  type ApiActivityRow,
} from './activity-page';

const row = (id: string, action: string, createdAt: string, extra: Partial<ApiActivityRow> = {}): ApiActivityRow => ({
  id,
  taskId: 't1',
  projectId: 'p1',
  userId: 'u1',
  action,
  createdAt,
  meta: null,
  actor: { id: 'u1', name: 'Omar Ahmed' },
  task: { id: 't1', key: 'OPS-12', title: 'Fix the pump' },
  project: { id: 'p1', name: 'Rig Ops' },
  ...extra,
});

describe('the Activity page’s words (5c), as the website’s', () => {
  it('names the five main actions, and any other by its own name', () => {
    expect(activityVerb('CREATED')).toBe('created');
    expect(activityVerb('MOVED')).toBe('moved');
    expect(activityVerb('COMPLETED')).toBe('completed');
    expect(activityVerb('REOPENED')).toBe('reopened');
    expect(activityVerb('ASSIGNED')).toBe('assigned');
    expect(activityVerb('CHECKLIST_DONE')).toBe('checklist done');
    expect(activityVerb('COMMENTED')).toBe('commented');
    expect(activityVerb('BLOCKER_ADDED')).toBe('blocker added');
  });

  it('says what happened from the recorded old and new values', () => {
    expect(activityDetail(row('a', 'MOVED', '', { meta: { from: 'To Do', to: 'In Progress' } }))).toBe('To Do → In Progress');
    expect(activityDetail(row('a', 'MOVED', '', { meta: { to: 'Review' } }))).toBe('— → Review');
    expect(activityDetail(row('a', 'MOVED', '', { meta: {} }))).toBe('');
    expect(activityDetail(row('a', 'COMPLETED', '', { meta: { to: 'Done' } }))).toBe('marked complete in Done');
    expect(activityDetail(row('a', 'COMPLETED', ''))).toBe('marked complete');
    expect(activityDetail(row('a', 'REOPENED', '', { meta: { to: 'To Do' } }))).toBe('re-opened in To Do');
    expect(activityDetail(row('a', 'REOPENED', ''))).toBe('re-opened');
    expect(activityDetail(row('a', 'ASSIGNED', '', { meta: { assignee: 'Aisha Khan' } }))).toBe('→ Aisha Khan');
    expect(activityDetail(row('a', 'ASSIGNED', ''))).toBe('');
    // A blocker never names the other task here (the server may hide it from you anyway).
    expect(activityDetail(row('a', 'BLOCKER_ADDED', '', { meta: { key: 'OPS-9', title: 'Secret' } }))).toBe('');
  });

  it('a task moved to another project: from where (by the key it had there) to where', () => {
    expect(activityVerb('PROJECT_CHANGED')).toBe('moved');
    expect(activityDetail(row('a', 'PROJECT_CHANGED', '', { meta: { fromProject: 'Rig Inspection', fromKey: 'RIG-4', toProject: 'Operations', toKey: 'OPS-17' } }))).toBe('from Rig Inspection (RIG-4) to Operations');
    expect(activityDetail(row('a', 'PROJECT_CHANGED', '', { meta: { toProject: 'Operations' } }))).toBe('to Operations');
    expect(activityDetail(row('a', 'PROJECT_CHANGED', ''))).toBe('to another project');
  });

  it('puts the task, what happened and the project on the second line', () => {
    expect(activityLine(row('a', 'MOVED', '', { meta: { from: 'To Do', to: 'Done' } }))).toBe('Fix the pump · To Do → Done · Rig Ops');
    expect(activityLine(row('a', 'CREATED', '', { project: null }))).toBe('Fix the pump');
    expect(activityLine(row('a', 'CREATED', '', { task: null }))).toBe('Rig Ops');
    // On the phone the project is its own button under the line.
    expect(activityLine(row('a', 'MOVED', '', { meta: { from: 'To Do', to: 'Done' } }), { project: false })).toBe('Fix the pump · To Do → Done');
  });

  it('shows who did it by their initials, as the website’s avatar', () => {
    expect(actorInitials('Omar Ahmed')).toBe('OA');
    expect(actorInitials('  aisha  ')).toBe('A');
    expect(actorInitials('Sara Al Balushi')).toBe('SA');
    expect(actorInitials('')).toBe('?');
  });

  it('reads one row out whole: who, what, which task, details, project and when', () => {
    const now = Date.parse('2026-10-21T12:00:00.000Z');
    expect(activityRowLabel(row('a', 'MOVED', '2026-10-21T11:55:00.000Z', { meta: { from: 'To Do', to: 'Done' } }), now)).toBe(
      'Omar Ahmed moved OPS-12, Fix the pump, To Do → Done, in Rig Ops, 5m ago',
    );
    expect(activityRowLabel(row('a', 'CREATED', '2026-10-21T11:59:50.000Z', { actor: null, task: null, project: null }), now)).toBe('Someone created a task, just now');
  });
});

describe('the Activity filters (5c)', () => {
  const rows = [
    row('1', 'CREATED', '2026-10-21T10:00:00.000Z'),
    row('2', 'MOVED', '2026-10-21T09:00:00.000Z'),
    row('3', 'COMPLETED', '2026-10-21T08:00:00.000Z'),
    row('4', 'REOPENED', '2026-10-21T07:00:00.000Z'),
    row('5', 'ASSIGNED', '2026-10-21T06:00:00.000Z'),
    row('6', 'COMMENTED', '2026-10-21T05:00:00.000Z'),
  ];
  it('are All, Created, Moved, Completed and Assigned', () => {
    expect(ACTIVITY_FILTERS.map((f) => f.label)).toEqual(['All', 'Created', 'Moved', 'Completed', 'Assigned']);
  });
  it('keep one kind; Completed keeps re-opened tasks too', () => {
    expect(filterActivity(rows, '').map((r) => r.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(filterActivity(rows, 'MOVED').map((r) => r.id)).toEqual(['2']);
    expect(filterActivity(rows, 'COMPLETED').map((r) => r.id)).toEqual(['3', '4']);
    expect(filterActivity(rows, 'ASSIGNED').map((r) => r.id)).toEqual(['5']);
  });
  it('say why the list is empty: nothing of this kind (with a way back), or nothing yet', () => {
    expect(activityEmpty('MOVED')).toEqual({ title: 'No moved activity', showAll: true });
    expect(activityEmpty('')).toEqual({ title: 'No activity yet', subtitle: 'Task creations, moves, completions and assignments will show up here.', showAll: false });
  });
});

describe('the Activity days (5c)', () => {
  it('groups the rows under Today, Yesterday and the day, in the company’s time zone, newest first', () => {
    const now = Date.parse('2026-10-21T08:00:00.000Z'); // 12:00 in Muscat
    const rows = [
      row('a', 'CREATED', '2026-10-21T07:00:00.000Z'),
      row('b', 'MOVED', '2026-10-20T21:00:00.000Z'), // 01:00 on the 21st in Muscat
      row('c', 'MOVED', '2026-10-20T10:00:00.000Z'),
      row('d', 'MOVED', '2026-10-18T10:00:00.000Z'),
    ];
    const groups = groupActivity(rows, now, 'Asia/Muscat');
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Sunday 18 October 2026', ['d']],
    ]);
    expect(groupActivity(rows, now, 'UTC').map((g) => g.title)).toEqual(['Today', 'Yesterday', 'Sunday 18 October 2026']);
    expect(groupActivity(rows, now, 'UTC')[0]!.items.map((i) => i.id)).toEqual(['a']);
  });
});

/**
 * The website's Activity page (Web Portal/frontend/src/pages/ActivityPage.tsx): the same verbs,
 * colours and filters. Read from its source; skipped when the website's code isn't next to the app.
 */
const webPage = resolve(__dirname, '../../../Web Portal/frontend/src/pages/ActivityPage.tsx');
describe.skipIf(!existsSync(webPage))('the same as the website', () => {
  const src = existsSync(webPage) ? readFileSync(webPage, 'utf8') : '';
  /** A `const NAME… = <literal>;` from the page, evaluated (plain object and array literals only). */
  const literal = (name: string): unknown => {
    const m = new RegExp(`const ${name}(?::[^=]+)? = ([\\[{][\\s\\S]*?[\\]}]);`).exec(src);
    if (!m) throw new Error(`${name} not found in ActivityPage.tsx`);
    return new Function(`return (${m[1]});`)();
  };
  it('has the same verbs and filters', () => {
    expect(ACTION_VERB).toEqual(literal('ACTION_VERB'));
    expect(ACTIVITY_FILTERS).toEqual(literal('FILTERS'));
  });
  it('colours each action alike (the website’s text-info, text-success … as tones)', () => {
    const web = literal('ACTION_TONE') as Record<string, string>;
    const toTone = (cls: string) => ({ 'text-ink-2': 'neutral' })[cls] ?? cls.replace(/^text-/, '');
    expect(ACTION_TONE).toEqual(Object.fromEntries(Object.entries(web).map(([k, v]) => [k, toTone(v)])));
  });
  it('words any other action the same way and says “Someone” and “a task” when they are gone', () => {
    expect(src).toContain(`a.action.toLowerCase().replace(/_/g, ' ')`);
    expect(src).toContain(`a.actor?.name ?? 'Someone'`);
    expect(src).toContain('a task');
    expect(src).toContain('marked complete in ${to}');
    expect(src).toContain('re-opened in ${to}');
    expect(src).toContain('No activity yet');
    expect(src).toContain('Task creations, moves, completions and assignments will show up here.');
  });
});
