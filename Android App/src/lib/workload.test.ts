import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, loadWebTs, readWeb } from '../testing/web-source';
import { SUGGESTIONS, WORKLOAD } from '../testing/planning-fixtures';
import { onPhone, phoneWordsIn } from '../testing/phone-words';
import { ApiError, NetworkError } from './api-client';
import {
  appliedText,
  applyProblem,
  cellLabel,
  cellTone,
  dayHeading,
  filterPeople,
  footerLine,
  limitOptions,
  limitProblemText,
  longDay,
  popoverSub,
  popoverTasks,
  popoverTitle,
  problemText,
  reasonOf,
  scopeLead,
  sortPeople,
  suggestionLabel,
  suggestionText,
  summaryLine,
  weekBar,
  weekLabel,
  workloadKey,
} from './workload';

/**
 * Stage 3 Task 4: Workload follows the website's own rules (frontend/src/lib/workload.ts, run here on
 * the same fixtures) and words (WorkloadPage.tsx, WorkloadPopover.tsx); a suggestion goes with the
 * task's version and a refusal is said plainly; every number is the server's.
 */
/** The website functions these tests call (a Record over their names: noUncheckedIndexedAccess). */
type WebName = 'cellTone' | 'cellLabel' | 'popoverSub' | 'popoverTitle' | 'dayHeading' | 'weekBar' | 'sortPeople' | 'filterPeople' | 'summaryLine' | 'weekLabel' | 'limitOptions' | 'suggestionText' | 'suggestionLabel' | 'problemText';
describe.skipIf(!hasWeb('frontend/src/lib/workload.ts', 'frontend/src/pages/WorkloadPage.tsx', 'frontend/src/components/workload/WorkloadPopover.tsx'))('the website’s Workload rules', () => {
  const web = loadWebTs('frontend/src/lib/workload.ts', { './due-date': 'frontend/src/lib/due-date.ts' }) as Record<WebName, (...a: never[]) => unknown>;
  const cells = WORKLOAD.people.flatMap((p) => p.days);
  it('cells, weeks, order, summary and words agree', () => {
    for (const c of cells) { expect(cellTone(c)).toBe(web.cellTone(c as never)); expect(cellLabel('Omar Said', c)).toBe(web.cellLabel('Omar Said' as never, c as never)); expect(popoverSub(c)).toBe(web.popoverSub(c as never)); expect(popoverTitle('Omar Said', c.date)).toBe(web.popoverTitle('Omar Said' as never, c.date as never)); expect(dayHeading(c.date, WORKLOAD.today)).toBe(web.dayHeading(c.date as never, WORKLOAD.today as never)); }
    for (const p of WORKLOAD.people) expect(weekBar(p)).toEqual(web.weekBar(p as never));
    expect(sortPeople(WORKLOAD.people).map((p) => p.id)).toEqual((web.sortPeople(WORKLOAD.people as never) as { id: string }[]).map((p) => p.id));
    for (const thisWeek of [true, false]) expect(summaryLine(WORKLOAD.people, thisWeek)).toBe(web.summaryLine(WORKLOAD.people as never, thisWeek as never));
    for (const [w, t] of [['2026-10-25', '2026-10-30'], ['2027-01-03', '2026-10-30']]) expect(weekLabel(w!, t!)).toBe(web.weekLabel(w as never, t as never));
    for (const n of [5, 13]) expect(limitOptions(n)).toEqual(web.limitOptions(n as never));
    for (const s of SUGGESTIONS) { expect(suggestionText(s, WORKLOAD.week)).toBe(web.suggestionText(s as never, WORKLOAD.week as never)); expect(suggestionLabel(s, 'RIG-14')).toBe(web.suggestionLabel(s as never, 'RIG-14' as never)); }
    for (const code of ['VERSION_CONFLICT', 'TASK_DONE', 'ASSIGNEE_GONE', null]) for (const s of SUGGESTIONS) expect(problemText({ code, reason: 'x', key: 'RIG-14', suggestion: s, from: 'Omar Said' })).toBe(web.problemText({ code, reason: 'x', key: 'RIG-14', suggestion: s, from: 'Omar Said' } as never));
    for (const q of ['', 'omar', 'AHMED hassan', 'nobody']) expect(filterPeople(WORKLOAD.people, q).map((p) => p.id), q).toEqual((web.filterPeople(WORKLOAD.people as never, q as never) as { id: string }[]).map((p) => p.id));
  });
  it('the page’s and the popover’s own words', () => {
    const page = readWeb('frontend/src/pages/WorkloadPage.tsx');
    // The website's words with its "click" said as "tap" (testing/phone-words: exactly those substitutions).
    for (const [web] of phoneWordsIn('frontend/src/pages/WorkloadPage.tsx')) expect(page).toContain(web);
    for (const w of ['`Gave ${task.key} to ${s.to.name}.`', '`Moved ${task.key} to ${longDay(s.date)}.`', 'Couldn’t change the daily limit: ', 'the server couldn’t be reached', footerLine('self'), footerLine('everyone'), scopeLead('teams'), scopeLead('self')]) expect(onPhone(page)).toContain(w);
    expect(footerLine('self')).toBe('Suggestions name the next lighter day. Nothing changes until you tap.');
    expect(readWeb('frontend/src/components/workload/WorkloadPopover.tsx')).toContain('const listed = cell.over > 0 ? cell.tasks.slice(0, cell.over) : cell.tasks.slice(0, LISTED);');
  });
});
it('a suggestion made on an old copy of the task says what the server said, plainly (Review Focus 4)', () => {
  const move = { kind: 'move', date: '2026-10-29' } as const, give = { kind: 'reassign', to: { id: 'u2', name: 'Hassan Ahmed' }, count: 2 } as const;
  expect(applyProblem(new ApiError(409, 'VERSION_CONFLICT', 'This task was changed by someone else. Reload and try again.'), { key: 'RIG-14', suggestion: move, from: 'Omar Said' })).toBe('Someone else changed RIG-14 just now. The numbers are up to date again — try once more if it still needs moving.');
  expect(applyProblem(new ApiError(409, 'ASSIGNEE_GONE', 'That person is no longer on this task.'), { key: 'RIG-14', suggestion: give, from: 'Omar Said' })).toBe('Omar Said is no longer on RIG-14. The numbers are up to date again.');
  expect(applyProblem(new NetworkError('offline'), { key: 'RIG-14', suggestion: give, from: 'Omar Said' })).toBe('Couldn’t give RIG-14 to Hassan Ahmed: the server couldn’t be reached.');
  expect(appliedText(move, 'RIG-14')).toBe('Moved RIG-14 to Thursday 29 October.');
  const s = src('core/planning-queries.ts');
  expect(s).toMatch(/expectedVersion: task\.version/); expect(s).not.toMatch(/queueOnOffline|enqueue/);
  expect(s).toMatch(/finally[^]*invalidateQueries\(\{ queryKey: planningRoot\(userId\) \}\)/);
});
it('“Saving…” lasts until the numbers are read again, as the website’s apply.isPending (final review P2)', () => {
  const s = src('core/planning-queries.ts');
  const hook = s.slice(s.indexOf('export function useApplySuggestion'), s.indexOf('export function useSetDailyLimit'));
  const fin = hook.slice(hook.indexOf('} finally {'));
  // The re-read is awaited (a failed one changes nothing), and only then is the day free again.
  expect(fin).toMatch(/try \{\s*await qc\.invalidateQueries\(\{ queryKey: planningRoot\(userId\) \}\);\s*\} catch/);
  expect(fin.indexOf('await qc.invalidateQueries')).toBeLessThan(fin.indexOf('busy.current = false'));
  expect(fin.indexOf('await qc.invalidateQueries')).toBeLessThan(fin.indexOf('setBusyTaskId(null)'));
});
it('a day lists what the website lists, counted by the server (Review Focus 5)', () => {
  const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, key: `K-${i}`, title: 't', projectId: 'p', priority: 'NORMAL', version: 1, suggestion: null }) as const);
  expect(popoverTasks({ date: '2026-10-28', count: 8, limit: 5, over: 3, tasks: [...tasks] })).toMatchObject({ more: 5 });
  expect(popoverTasks({ date: '2026-10-28', count: 8, limit: 5, over: 3, tasks: [...tasks] }).shown).toHaveLength(3);
  expect(popoverTasks({ date: '2026-10-28', count: 9, limit: 10, over: 0, tasks: [...tasks] })).toMatchObject({ more: 4 });
});
it('the reasons, the daily limit’s problem, the lead and the footer', () => {
  expect(reasonOf(new ApiError(403, 'FORBIDDEN', 'Only an administrator can change this.'))).toBe('Only an administrator can change this');
  expect(reasonOf(new ApiError(500, 'ERROR', 'Request failed (500)'))).toBe('the server had a problem');
  expect(reasonOf(new Error('boom'))).toBe('the server had a problem');
  expect(limitProblemText(new NetworkError('offline'))).toBe('Couldn’t change the daily limit: the server couldn’t be reached.');
  expect(appliedText({ kind: 'reassign', to: { id: 'u2', name: 'Hassan Ahmed' }, count: null }, 'RIG-14')).toBe('Gave RIG-14 to Hassan Ahmed.');
  expect(longDay('2026-10-29')).toBe('Thursday 29 October');
  expect(scopeLead('everyone')).toBe('');
  expect(footerLine('teams')).toBe(footerLine('everyone'));
  expect(applyProblem(new ApiError(409, 'TASK_DONE', 'Done.'), { key: 'RIG-14', suggestion: SUGGESTIONS[2]!, from: 'Omar Said' })).toBe('RIG-14 is already done. The numbers are up to date again.');
});
it('keeps each person’s workload apart', () => {
  expect(workloadKey('u1', '2026-10-25', '', WORKLOAD.today)).not.toEqual(workloadKey('u2', '2026-10-25', '', WORKLOAD.today));
  expect(workloadKey('u1', '2026-10-25', 'p1', WORKLOAD.today).slice(0, 2)).toEqual(['planning', 'u1']);
});
it('the fixture’s days cover every tone (so the drift test sees each)', () => {
  expect(new Set(WORKLOAD.people.flatMap((p) => p.days).map(cellTone))).toEqual(new Set(['off', 'offdue', 'none', 'below', 'at', 'over']));
  expect(WORKLOAD.people.map((p) => weekBar(p).tone).sort()).toEqual(['busy', 'ok', 'over']);
});
