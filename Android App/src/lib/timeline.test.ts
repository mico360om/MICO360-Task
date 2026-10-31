import { describe, it, expect } from 'vitest';
import { hasWeb, loadWebTs, readWeb } from '../testing/web-source';
import { PROJECTS, TASKS_DATA, TIMELINE_TASKS, TODAY } from '../testing/planning-fixtures';
import type { TimelineProject } from './planning-api';
import {
  DEFAULT_TIMELINE_STATE,
  HEALTH_LABEL,
  TIMELINE_SORTS,
  TIMELINE_VIEWS,
  filterTimeline,
  milestoneParts,
  ownerOptions,
  periodText,
  phoneTaskParts,
  rangeFor,
  shiftAnchor,
  shortDay,
  sortTimeline,
  statusLine,
  targetLine,
  tasksFooter,
  timelineKey,
  timelineRow,
  timelineSummary,
  timelineTasksKey,
} from './timeline';

/**
 * Stage 3 Task 2: the Timeline's phone list follows the website's own rules (frontend/src/lib/timeline.ts,
 * run here on the same fixtures), and shows the server's numbers — never a recount.
 */
/** The website functions these tests call (a Record over their names: noUncheckedIndexedAccess). */
type WebName = 'sortTimeline' | 'filterTimeline' | 'statusLine' | 'timelineSummary' | 'ownerOptions' | 'rangeFor' | 'shiftAnchor' | 'targetLine' | 'milestoneLine' | 'phoneTaskLine' | 'shortDay';
const SUFFIX = { done: ' · ✓ done', waiting: ' · waiting for approval', overdue: ' · overdue', '': '' } as const;
describe.skipIf(!hasWeb('frontend/src/lib/timeline.ts', 'frontend/src/components/timeline/TimelineTasks.tsx', 'frontend/src/pages/TimelinePage.tsx'))('the website’s phone-list rules', () => {
  const web = loadWebTs('frontend/src/lib/timeline.ts', { './due-date': 'frontend/src/lib/due-date.ts', './initials': 'frontend/src/lib/initials.ts' }) as Record<WebName, (...a: never[]) => unknown>;
  it('sort, filter, owners, summary and status line agree', () => {
    for (const sort of ['attention', 'name', 'target'] as const) expect(sortTimeline(PROJECTS, sort).map((p) => p.id), sort).toEqual((web.sortTimeline(PROJECTS as never, sort as never) as TimelineProject[]).map((p) => p.id));
    for (const show of ['', 'late', 'at-risk'] as const) {
      expect(filterTimeline(PROJECTS, { owner: '', show })).toEqual(web.filterTimeline(PROJECTS as never, { owner: '', show } as never));
      expect(statusLine(timelineSummary(PROJECTS), show, 2)).toBe(web.statusLine(web.timelineSummary(PROJECTS as never) as never, show as never, 2 as never));
    }
    expect(ownerOptions(PROJECTS)).toEqual(web.ownerOptions(PROJECTS as never));
  });
  it('ranges, days and lines read the same', () => {
    for (const v of ['month', 'quarter', 'half'] as const) { expect(rangeFor(v, '2026-10-25')).toEqual(web.rangeFor(v as never, '2026-10-25' as never)); expect(shiftAnchor(v, '2026-10-25', -1)).toBe(web.shiftAnchor(v as never, '2026-10-25' as never, -1 as never)); }
    for (const p of PROJECTS) { expect(targetLine(p, TODAY), p.id).toBe(web.targetLine(p as never, TODAY as never)); const m = milestoneParts(p, TODAY); expect(m.next ? `Next ◆ ${m.text}` : m.text, p.id).toBe(web.milestoneLine(p as never, TODAY as never)); }
    for (const t of TIMELINE_TASKS) { const x = phoneTaskParts(t, TODAY); expect(x.due + SUFFIX[x.state ?? ''], t.key).toBe(web.phoneTaskLine(t as never, TODAY as never)); }
    for (const k of ['2026-09-04', '2027-02-03']) expect(shortDay(k, TODAY)).toBe(web.shortDay(k as never, TODAY as never));
  });
  it('the views, sorts, default state and health words are the website’s', () => {
    const w = web as unknown as Record<string, unknown>;
    expect(TIMELINE_VIEWS).toEqual(w.TIMELINE_VIEWS);
    expect(TIMELINE_SORTS).toEqual(w.TIMELINE_SORTS);
    expect(DEFAULT_TIMELINE_STATE).toEqual(w.DEFAULT_TIMELINE_STATE);
    expect(HEALTH_LABEL).toEqual(w.HEALTH_LABEL);
  });
  it('the period and the task footer are the website’s words', () => {
    expect(readWeb('frontend/src/pages/TimelinePage.tsx')).toContain("const period = (from: string, to: string) => `${shortDay(from, '0000')} – ${shortDay(to, '0000')}`;");
    const tt = readWeb('frontend/src/components/timeline/TimelineTasks.tsx');
    for (const w of ['No tasks in these weeks.', "'Open its tasks'", "'Show its 1 open task'", '`Show all ${n} open tasks`', "'1 open task has no due date'", '`${data.undated} open tasks have no due date`']) expect(tt).toContain(w);
  });
});
it('the period, waiting before overdue, and the footer', () => {
  expect(periodText('2026-10-04', '2027-01-02')).toBe('4 Oct 2026 – 2 Jan 2027');
  expect(phoneTaskParts({ due: '2026-10-29', done: false, overdue: false, waiting: true }, TODAY)).toEqual({ due: 'due 29 Oct', state: 'waiting' });
  expect(tasksFooter({ ...TASKS_DATA, tasks: TASKS_DATA.tasks.slice(0, 2), matched: 5, open: 12, undated: 1 })).toEqual({ none: false, shown: '2 of 5 shown', allOpen: 'Show all 12 open tasks', undated: '1 open task has no due date' });
  expect(tasksFooter({ ...TASKS_DATA, tasks: [], matched: 0, open: 0, undated: 3 })).toEqual({ none: true, shown: null, allOpen: null, undated: '3 open tasks have no due date' });
});
it('a row shows the server’s progress, never a recount (Review Focus 5)', () => {
  const ok = PROJECTS.find((p) => p.id === 'p-ok')!;
  expect(timelineRow(ok, TODAY)).toMatchObject({ progress: 62, progressLabel: `${ok.name}: 62% done`, targetLate: false });
  expect(timelineRow(PROJECTS.find((p) => p.id === 'p-late')!, TODAY).targetLate).toBe(true);
});
it('keeps each person’s timeline apart', () => {
  expect(timelineKey('u1', 'a', 'b', 0, TODAY)).not.toEqual(timelineKey('u2', 'a', 'b', 0, TODAY));
  expect(timelineKey('u1', 'a', 'b', 0, TODAY).slice(0, 2)).toEqual(['planning', 'u1']);
  expect(timelineTasksKey('u1', 'p1', 'a', 'b', TODAY).slice(0, 2)).toEqual(['planning', 'u1']);
});
