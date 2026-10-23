import { describe, it, expect } from 'vitest';
import { createMicoAiTools, TOOL_NAMES } from './mico-ai-tools';
import { createMemoryMicoAiData, company, NOW, ADMIN, OMAR, SARA, LAYLA, type MemoryData } from './mico-ai-data.fixture';
import type { MicoAiDataPort, Viewer } from './mico-ai-data';
import { userWorkload, projectPerformance } from '../reports/report-service';

function tools(data: MemoryData = company(), override: Partial<MicoAiDataPort> = {}) {
  const port = { ...createMemoryMicoAiData(data), ...override };
  return { port, t: createMicoAiTools({ data: port, timeZone: 'Asia/Muscat', now: () => NOW }) };
}
const keys = (rows: Array<{ values: Record<string, unknown> }>, col = 'key') => rows.map((r) => r.values[col]);
const run = (viewer: Viewer, name: string, args: Record<string, unknown> = {}, data?: MemoryData, override?: Partial<MicoAiDataPort>) => tools(data, override).t.run(viewer, name, args);

describe('MICO AI tools: the catalogue', () => {
  it('has only read-only tools', () => {
    const { t } = tools();
    expect(t.catalogue.map((c) => c.name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).toEqual([
      'search_tasks',
      'task_details',
      'list_projects',
      'project_details',
      'project_activity',
      'list_meetings',
      'meeting_details',
      'list_action_items',
      'report_figures',
      'search_chat',
      'find_people',
    ]);
    for (const c of t.catalogue) {
      expect(c.name).not.toMatch(/create|update|delete|move|assign|send|set|add|remove/);
      expect(c.purpose.length).toBeGreaterThan(10);
    }
  });

  it('a tool that isn’t in the catalogue does nothing and says so', async () => {
    const { t, port } = tools();
    const r = await t.run(OMAR, 'update_task', { task: 'RIG-14', status: 'DONE' });
    expect(r.error).toBe('There is no tool called “update_task”.');
    expect(port.calls).toEqual([]);
  });

  it('arguments are checked: a bad one comes back as a plain error', async () => {
    const r = await run(OMAR, 'search_tasks', { dueFrom: 'next tuesday' });
    expect(r.error).toMatch(/dueFrom/);
    expect(r.rows).toEqual([]);
  });
});

describe('MICO AI tools: tasks', () => {
  it('finds the overdue tasks of a project, with who has them and how late they are', async () => {
    const r = await run(OMAR, 'search_tasks', { project: 'Rig Inspection', status: 'overdue' });
    expect(r.error).toBeUndefined();
    expect(r.title).toBe('Overdue tasks in Rig Inspection Portal');
    expect(keys(r.rows)).toEqual(['RIG-14', 'RIG-9', 'RIG-21']);
    expect(r.rows.map((x) => [x.values.assignees, x.values.due, x.values.overdueDays])).toEqual([
      ['Omar Said', '2026-10-19', 5],
      ['Sara Ahmed', '2026-10-20', 4],
      ['Omar Said', '2026-10-21', 3],
    ]);
    expect(r.rows[0]!.ref).toEqual({ type: 'task', id: 't14', label: 'RIG-14', url: '?task=t14' });
    expect(r.total).toBe(3);
  });

  it('an employee never gets another project’s tasks, even when assigned there or naming it', async () => {
    const all = await run(OMAR, 'search_tasks', {});
    expect(keys(all.rows)).not.toContain('FAL-2');
    expect(keys(all.rows)).not.toContain('FAL-1');
    const named = await run(OMAR, 'search_tasks', { project: 'Falcon CRM' });
    expect(named.error).toBe('No project you can see matches “Falcon CRM”.');
    expect(named.rows).toEqual([]);
    const byText = await run(OMAR, 'search_tasks', { text: 'contract' });
    expect(byText.rows).toEqual([]);
  });

  it('checks the rows again: a task outside the person’s projects is dropped even if the data returns it', async () => {
    const data = company();
    const leaky = createMemoryMicoAiData(data);
    const r = await run(OMAR, 'search_tasks', {}, data, { tasks: async () => data.tasks });
    expect(keys(r.rows)).not.toContain('FAL-1');
    expect(leaky).toBeTruthy();
  });

  it('an admin sees every project’s tasks', async () => {
    const r = await run(ADMIN, 'search_tasks', { status: 'overdue' });
    expect(keys(r.rows)).toEqual(['FAL-1', 'RIG-14', 'RIG-9', 'RIG-21']);
  });

  it('filters by assignee (“me”), status, due and completed dates and text', async () => {
    expect(keys((await run(OMAR, 'search_tasks', { assignee: 'me', status: 'open' })).rows)).toEqual(['RIG-14', 'RIG-21']);
    expect(keys((await run(OMAR, 'search_tasks', { assignee: 'Sara' })).rows)).toEqual(['RIG-9', 'RIG-15']);
    expect(keys((await run(OMAR, 'search_tasks', { status: 'done' })).rows)).toEqual(['RIG-3']);
    expect(keys((await run(OMAR, 'search_tasks', { status: 'blocked' })).rows)).toEqual(['RIG-15']);
    expect(keys((await run(OMAR, 'search_tasks', { dueFrom: '2026-10-20', dueTo: '2026-10-30' })).rows)).toEqual(['RIG-9', 'RIG-21', 'RIG-15']);
    expect(keys((await run(OMAR, 'search_tasks', { completedFrom: '2026-10-05', completedTo: '2026-10-11' })).rows)).toEqual(['RIG-3']);
    expect(keys((await run(OMAR, 'search_tasks', { text: 'valve' })).rows)).toEqual(['RIG-9']);
  });

  it('a name several people share is a question, not a guess', async () => {
    const data = company();
    data.people.push({ id: 'u-sara2', firstName: 'Sara', lastName: 'Khan', username: 'sarak', active: true });
    const r = await run(OMAR, 'search_tasks', { assignee: 'Sara' }, data);
    expect(r.error).toMatch(/Several people match “Sara”: Sara Ahmed \(sara\), Sara Khan \(sarak\)/);
  });

  it('a task in full: description, checklist, comments, history and blockers, hidden blockers left out', async () => {
    const r = await run(OMAR, 'task_details', { task: 'rig-14' });
    expect(keys(r.rows)).toEqual(['RIG-14']);
    const d = r.details as Record<string, unknown>;
    expect(d.description).toBe('Run the pressure test on rig 2 and write the report.');
    expect(d.checklist).toEqual([{ item: 'Calibrate the gauge', done: true }, { item: 'Write the report', done: false }]);
    expect(d.comments).toEqual([{ by: 'Sara Ahmed', at: '2026-10-20 13:00', text: 'Vendor certificate is still missing.' }]);
    expect(d.blocks).toEqual([{ ref: 'task:t15', key: 'RIG-15', title: 'Pilot on rig 3', status: 'Blocked' }]);
    expect(JSON.stringify(d)).not.toContain('FAL-1');
    expect(d.hiddenBlockers).toBe(1);
    expect(r.detailRefs?.map((x) => x.label)).toEqual(['RIG-15']);
  });

  it('another project’s task reads as not found (nothing about it is revealed)', async () => {
    const r = await run(OMAR, 'task_details', { task: 'FAL-1' });
    expect(r.error).toBe('No task you can see matches “FAL-1”.');
    expect(JSON.stringify(r)).not.toContain('secret');
  });
});

describe('MICO AI tools: projects and activity', () => {
  it('lists only the projects the person can see, with progress', async () => {
    const r = await run(OMAR, 'list_projects');
    expect(keys(r.rows, 'name')).toEqual(['Rig Inspection Portal']);
    expect(r.rows[0]!.values).toMatchObject({ code: 'RIG', tasks: 5, open: 4, overdue: 3, progress: 20, target: '2026-11-30' });
    expect(keys((await run(ADMIN, 'list_projects')).rows, 'name')).toEqual(['Falcon CRM', 'Rig Inspection Portal']);
  });

  it('a project in detail: members, milestones, deadlines — only a visible one', async () => {
    const r = await run(SARA, 'project_details', { project: 'RIG' });
    const d = r.details as { members: Array<{ name: string; role: string }>; byStatus: Record<string, number> };
    expect(d.members).toEqual([{ name: 'Omar Said', role: 'Owner' }, { name: 'Sara Ahmed', role: 'Member' }]);
    expect(d.byStatus).toEqual({ 'In progress': 1, 'To do': 2, Blocked: 1, Done: 1 });
    expect((await run(SARA, 'project_details', { project: 'Falcon' })).error).toMatch(/No project you can see/);
  });

  it('what changed: only in the person’s projects', async () => {
    const r = await run(OMAR, 'project_activity', { from: '2026-10-23', to: '2026-10-23' });
    expect(keys(r.rows, 'task')).toEqual(['RIG-14']);
    expect(r.rows[0]!.values.change).toMatch(/moved/i);
    expect((await run(ADMIN, 'project_activity', { from: '2026-10-23', to: '2026-10-23' })).rows).toHaveLength(2);
  });
});

describe('MICO AI tools: meetings', () => {
  it('lists the meetings the person may see: their projects’ and the ones they attend', async () => {
    const r = await run(OMAR, 'list_meetings', { from: '2026-10-01', to: '2026-10-31' });
    expect(keys(r.rows, 'title')).toEqual(['Weekly review', 'Omar and Layla catch-up']);
    expect(keys((await run(SARA, 'list_meetings', { from: '2026-10-01', to: '2026-10-31' })).rows, 'title')).toEqual(['Weekly review']);
  });

  it('checks each meeting again with the meeting rule (a leaky list is filtered)', async () => {
    const data = company();
    const r = await run(SARA, 'list_meetings', { from: '2026-10-01', to: '2026-10-31' }, data, { meetings: async () => data.meetings! });
    expect(keys(r.rows, 'title')).toEqual(['Weekly review']);
  });

  it('a meeting in full — notes, action items, Final MOM — only through the meeting pages’ own check', async () => {
    const r = await run(SARA, 'meeting_details', { meeting: 'meeting:m-weekly' });
    const d = r.details as Record<string, unknown>;
    expect(d.notes).toEqual([{ type: 'Decision', agendaItem: 'RIG-14', by: 'Sara Ahmed', text: 'Omar to finish the pressure test once the gauge is calibrated.' }]);
    expect(d.actionItems).toEqual([{ item: 'Check the vendor’s certificate', owner: 'Sara Ahmed', due: '2026-10-25', status: 'Open', task: null }]);
    expect((d.finalMinutes as Record<string, unknown>).status).toBe('Final');
    const denied = await run(SARA, 'meeting_details', { meeting: 'm-falcon' });
    expect(denied.error).toBe('No meeting you can see matches “m-falcon”.');
    expect(JSON.stringify(denied)).not.toContain('pricing');
  });

  it('finds a meeting by its title among the visible ones', async () => {
    expect(keys((await run(OMAR, 'meeting_details', { meeting: 'weekly review' })).rows, 'title')).toEqual(['Weekly review']);
    expect((await run(OMAR, 'meeting_details', { meeting: 'Falcon pricing' })).error).toMatch(/No meeting you can see/);
  });

  it('action items come only from meetings the person can see', async () => {
    const r = await run(SARA, 'list_action_items', { from: '2026-10-01', to: '2026-10-31' });
    expect(keys(r.rows, 'item')).toEqual(['Check the vendor’s certificate']);
    expect(r.rows[0]!.ref).toMatchObject({ type: 'meeting', id: 'm-weekly' });
    expect(keys((await run(ADMIN, 'list_action_items', { from: '2026-10-01', to: '2026-10-31' })).rows, 'item')).toHaveLength(2);
  });
});

describe('MICO AI tools: report figures', () => {
  it('workload is the Reports page’s own figures, over the tasks the person can see', async () => {
    const r = await run(OMAR, 'report_figures', { report: 'workload' });
    const data = company();
    const visibleTasks = data.tasks.filter((x) => x.projectId === 'p-rig');
    const expected = userWorkload(
      visibleTasks.map((x) => ({ id: x.id, projectId: x.projectId, projectName: x.projectName, columnCategory: x.category, createdAt: x.createdAt, dueDate: x.dueDate, completedAt: x.completedAt, assigneeIds: x.assigneeIds })),
      [{ id: 'u-omar', username: 'omar', name: 'Omar Said' }, { id: 'u-sara', username: 'sara', name: 'Sara Ahmed' }],
      'Asia/Muscat',
      NOW,
    );
    expect(r.rows.map((x) => x.values)).toEqual(expected.map((w) => ({ person: w.name, assigned: w.assigned, open: w.assigned - w.completed, completed: w.completed, overdue: w.overdue })));
    // Layla's Falcon task (FAL-2, shared with Omar) is not counted for Omar.
    expect(r.rows.find((x) => x.values.person === 'Omar Said')!.values.assigned).toBe(3);
    expect(keys(r.rows, 'person')).not.toContain('Layla Hassan');
  });

  it('project figures match Project performance; an employee gets only their projects', async () => {
    const r = await run(OMAR, 'report_figures', { report: 'projects' });
    const data = company();
    const perf = projectPerformance(
      data.tasks.filter((x) => x.projectId === 'p-rig').map((x) => ({ id: x.id, projectId: x.projectId, projectName: x.projectName, columnCategory: x.category, createdAt: x.createdAt, dueDate: x.dueDate, completedAt: x.completedAt, assigneeIds: x.assigneeIds })),
      'Asia/Muscat',
      NOW,
    );
    expect(r.rows.map((x) => x.values)).toEqual(perf.map((p) => ({ project: p.projectName, total: p.total, completed: p.completed, overdue: p.overdue, completionPct: p.completionPct })));
  });

  it('status and completion figures; a period limits them to tasks due in it', async () => {
    const status = await run(OMAR, 'report_figures', { report: 'status' });
    expect(status.rows.map((x) => [x.values.status, x.values.count])).toEqual([['To do', 2], ['In progress', 1], ['Blocked', 1], ['Done', 1]]);
    const week = await run(OMAR, 'report_figures', { report: 'completion', dueFrom: '2026-10-19', dueTo: '2026-10-25' });
    expect(week.rows[0]!.values).toMatchObject({ total: 3, completed: 0 });
  });
});

describe('MICO AI tools: team chat', () => {
  it('searches only the conversations the person is part of', async () => {
    const r = await run(OMAR, 'search_chat', { text: 'gauge' });
    expect(keys(r.rows, 'message')).toEqual(['Can you look at the gauge order?', 'The gauge is calibrated now.']);
    expect(r.rows[0]!.values.conversation).toBe('Direct: Layla Hassan');
    expect(r.rows[1]!.values.conversation).toBe('Rig Inspection Portal');
    expect(r.rows[1]!.ref).toEqual({ type: 'chat', id: 'cm1', label: 'Sara Ahmed · 22 Oct', url: '/chat?conversation=c-rig' });
    expect(JSON.stringify(r)).not.toContain('400 OMR');
    expect(JSON.stringify(r)).not.toContain('supplier is late');
  });

  it('an admin doesn’t read other people’s direct messages', async () => {
    const r = await run(ADMIN, 'search_chat', { text: 'gauge' });
    expect(keys(r.rows, 'message')).toEqual(['The gauge price is 400 OMR (Falcon only).', 'The gauge is calibrated now.']);
  });

  it('messages from other conversations are dropped even if the data returns them', async () => {
    const data = company();
    const r = await run(SARA, 'search_chat', { text: 'gauge' }, data, { chatMessages: async () => data.messages! });
    expect(keys(r.rows, 'message')).toEqual(['Private: the gauge supplier is late.', 'The gauge is calibrated now.']);
  });

  it('can narrow to one project’s channel or one person', async () => {
    expect(keys((await run(LAYLA, 'search_chat', { project: 'Falcon' })).rows, 'message')).toEqual(['The gauge price is 400 OMR (Falcon only).']);
    expect((await run(SARA, 'search_chat', { project: 'Falcon' })).error).toMatch(/No project you can see/);
    expect(keys((await run(LAYLA, 'search_chat', { person: 'Sara' })).rows, 'message')).toEqual(['Private: the gauge supplier is late.']);
  });
});

describe('MICO AI tools: who is who', () => {
  it('names and usernames, with only the projects the person shares', async () => {
    const r = await run(SARA, 'find_people', { name: 'Omar' });
    expect(r.rows.map((x) => x.values)).toEqual([{ name: 'Omar Said', username: 'omar', active: 'Yes', projects: 'Rig Inspection Portal (Owner)' }]);
    const layla = await run(SARA, 'find_people', { name: 'Layla' });
    expect(layla.rows[0]!.values.projects).toBe('');
    expect(JSON.stringify(await run(SARA, 'find_people', {}))).not.toContain('@');
  });

  it('the people of one visible project', async () => {
    expect(keys((await run(OMAR, 'find_people', { project: 'RIG' })).rows, 'name')).toEqual(['Omar Said', 'Sara Ahmed']);
    expect((await run(OMAR, 'find_people', { project: 'FAL' })).error).toMatch(/No project you can see/);
  });
});
