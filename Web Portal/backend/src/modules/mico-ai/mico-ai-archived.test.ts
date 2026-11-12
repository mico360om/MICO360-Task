import { describe, it, expect } from 'vitest';
import { createMicoAiTools } from './mico-ai-tools';
import { createMemoryMicoAiData, company, NOW, OMAR } from './mico-ai-data.fixture';
import type { Viewer } from './mico-ai-data';

// Task archive (bulk lane): MICO AI still finds archived tasks (marked) but its open, overdue and
// status filters drop them; its figures keep an archived Done task and leave an archived open one.
const ARCHIVED_AT = new Date('2026-10-22T08:00:00Z');
function world() {
  const d = company();
  // RIG-21 (open, overdue) and RIG-3 (done) are archived.
  d.tasks = d.tasks.map((t) => (t.id === 't21' || t.id === 't3' ? { ...t, archivedAt: ARCHIVED_AT } : t));
  return d;
}
const run = (viewer: Viewer, name: string, args: Record<string, unknown> = {}) =>
  createMicoAiTools({ data: createMemoryMicoAiData(world()), timeZone: 'Asia/Muscat', now: () => NOW }).run(viewer, name, args);
const keys = (rows: Array<{ values: Record<string, unknown> }>, col = 'key') => rows.map((r) => r.values[col]);

describe('MICO AI and archived tasks', () => {
  it('search finds an archived task, marked; open and overdue filters leave it out', async () => {
    const all = await run(OMAR, 'search_tasks', { project: 'Rig Inspection' });
    expect(keys(all.rows)).toContain('RIG-21');
    expect(all.rows.find((r) => r.values.key === 'RIG-21')!.values.status).toBe('To do · Archived');
    expect(all.rows.find((r) => r.values.key === 'RIG-21')!.values.overdueDays).toBeNull();
    expect(keys((await run(OMAR, 'search_tasks', { project: 'Rig Inspection', status: 'overdue' })).rows)).toEqual(['RIG-14', 'RIG-9']);
    expect(keys((await run(OMAR, 'search_tasks', { project: 'Rig Inspection', status: 'open' })).rows)).not.toContain('RIG-21');
    expect(keys((await run(OMAR, 'search_tasks', { project: 'Rig Inspection', status: 'todo' })).rows)).not.toContain('RIG-21');
    // An archived Done task is still found among the done ones.
    expect(keys((await run(OMAR, 'search_tasks', { project: 'Rig Inspection', status: 'done' })).rows)).toEqual(['RIG-3']);
  });

  it('figures: the archived Done task still counts; the archived open one leaves every figure', async () => {
    const r = await run(OMAR, 'list_projects');
    // 5 tasks less the archived open one; RIG-3 (archived, done) still done: 1 of 4.
    expect(r.rows[0]!.values).toMatchObject({ tasks: 4, open: 3, overdue: 2, progress: 25 });
    const perf = await run(OMAR, 'report_figures', { report: 'projects' });
    expect(perf.rows[0]!.values).toMatchObject({ total: 4, completed: 1, overdue: 2, completionPct: 25 });
    const workload = await run(OMAR, 'report_figures', { report: 'workload' });
    // Omar had RIG-14, RIG-21 (archived open: out) and RIG-3 (archived done: counted).
    expect(workload.rows.find((x) => x.values.person === 'Omar Said')!.values).toMatchObject({ assigned: 2, completed: 1, open: 1 });
  });
});
