import { describe, it, expect } from 'vitest';
import { createMicoAiActions } from './mico-ai-actions';
import { createFakeWorld } from './mico-ai-actions.fixture';
import { company, NOW, OMAR, SARA, LAYLA, ADMIN, type MemoryData } from './mico-ai-data.fixture';
import type { CreateTaskItem, ItemResult, MinutesItem, ProposalDraft, ProposalItem, UpdateTaskItem } from './mico-ai-actions-types';

// Sat 24 Oct 2026, 12:00 in Muscat. Omar owns Rig Inspection (Sara is a member); Layla runs Falcon CRM.
function setup(tweak: (d: MemoryData) => void = () => {}, now = () => NOW) {
  const data = company();
  data.meetings!.push({
    ...data.meetings![0]!,
    id: 'm-site',
    title: 'Site visit',
    organizerId: 'u-omar',
    createdById: 'u-omar',
    attendeeUserIds: ['u-sara'],
    finalMinutes: null,
    startAt: new Date('2026-10-22T06:00:00Z'),
  });
  tweak(data);
  const world = createFakeWorld(data);
  const actions = createMicoAiActions({ data: world.read, port: world.port, timeZone: 'Asia/Muscat', now });
  return { world, actions, data };
}
const twoOmars = (d: MemoryData) => {
  d.people.push({ id: 'u-omar2', firstName: 'Omar', lastName: 'Khan', username: 'omar.k', active: true });
  d.members.push({ projectId: 'p-rig', userId: 'u-omar2', role: 'MEMBER' });
};

async function card(actions: ReturnType<typeof setup>['actions'], viewer: typeof OMAR, changes: Array<Record<string, unknown>>, final = true): Promise<ProposalDraft> {
  const out = await actions.prepare(viewer, changes, { final });
  if (out.kind !== 'card') throw new Error(`expected a card, got ${JSON.stringify(out)}`);
  return out.card;
}
const confirmAll = (actions: ReturnType<typeof setup>['actions'], viewer: typeof OMAR, items: ProposalItem[], opts: Partial<Parameters<ReturnType<typeof setup>['actions']['carryOut']>[2]> = {}) =>
  actions.carryOut(viewer, items, { sendInvites: true, ip: '10.0.0.7', include: Object.fromEntries(items.map((i) => [i.id, true])), ...opts });

describe('MICO AI actions: checking what the model proposed', () => {
  it('a new task: the project and people become records, "tuesday" a day in company time, the priority checked', async () => {
    const { actions } = setup();
    const { items } = await card(actions, OMAR, [{ type: 'create_task', title: '  Replace the gauge  ', project: 'rig', assignees: ['Sara'], due: 'tuesday', priority: 'high', description: 'From the failed list.' }]);
    expect(items).toHaveLength(1);
    const it0 = items[0] as CreateTaskItem;
    expect(it0).toMatchObject({
      id: 'c1',
      type: 'create_task',
      problem: null,
      locked: false,
      fields: { title: 'Replace the gauge', projectId: 'p-rig', assigneeIds: ['u-sara'], due: '2026-10-27', priority: 'HIGH', description: 'From the failed list.' },
      labels: { project: 'Rig Inspection Portal', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
    });
  });

  it('a new task with no one named goes to the project’s owner, as any new task does', async () => {
    const { actions } = setup();
    const { items } = await card(actions, SARA, [{ type: 'create_task', title: 'Order spares', project: 'Rig Inspection Portal' }]);
    expect(items[0]).toMatchObject({ fields: { assigneeIds: ['u-omar'], priority: 'NORMAL', due: null }, ownerDefault: true });
  });

  it('“Omar” when there are two: the server asks which one, with both as quick replies (nothing is guessed)', async () => {
    const { actions, world } = setup(twoOmars);
    const out = await actions.prepare(SARA, [{ type: 'create_task', title: 'X', project: 'RIG', assignees: ['Omar'] }], { final: true });
    expect(out).toEqual({ kind: 'clarify', question: 'Which Omar do you mean?', options: ['Omar Khan (omar.k)', 'Omar Said (omar)'] });
    expect(world.calls).toEqual([]);
  });

  it('a project name that fits several: asks which project', async () => {
    const { actions } = setup((d) => d.projects.push({ ...d.projects[0]!, id: 'p-rig2', code: 'RIGM', name: 'Rig Maintenance' }));
    const out = await actions.prepare(ADMIN, [{ type: 'create_task', title: 'X', project: 'rig ' }], { final: true });
    expect(out.kind).toBe('card'); // "rig" is RIG's code, exactly
    const several = await actions.prepare(ADMIN, [{ type: 'create_task', title: 'X', project: 'Ri' }], { final: true });
    expect(several).toEqual({ kind: 'clarify', question: 'Which project do you mean by “Ri”?', options: ['Rig Inspection Portal (RIG)', 'Rig Maintenance (RIGM)'] });
  });

  it('names nothing matches go back to the model first; on the last try they are problems on the card', async () => {
    const { actions } = setup();
    const change = { type: 'create_task', title: 'X', project: 'Rgi Inspektion', assignees: ['Zed'] };
    expect(await actions.prepare(OMAR, [change], { final: false })).toEqual({
      kind: 'retry',
      problems: ['No project you can see matches “Rgi Inspektion”.', 'No one matches “Zed”.'],
    });
    const { items } = await card(actions, OMAR, [change]);
    expect(items[0]).toMatchObject({ locked: false, fields: { projectId: null, assigneeIds: [] } });
    expect(items[0]!.problem).toMatch(/No project you can see matches “Rgi Inspektion”/);
  });

  it('someone who isn’t on the project can’t be assigned: a problem to fix on the card', async () => {
    const { actions } = setup();
    const { items } = await card(actions, ADMIN, [{ type: 'create_task', title: 'X', project: 'RIG', assignees: ['Layla'] }]);
    expect(items[0]!.problem).toBe('Layla Hassan isn’t on Rig Inspection Portal, so they can’t be assigned.');
    expect(items[0]!.locked).toBe(false);
  });

  it('a change to a task: before → after, its version kept, "next week" the first working day, "done" the Done column', async () => {
    const { actions } = setup();
    const { items } = await card(actions, SARA, [{ type: 'update_task', task: 'RIG-14', due: 'next week', status: 'done', priority: 'URGENT', assignees: ['me'] }]);
    const u = items[0] as UpdateTaskItem;
    expect(u).toMatchObject({
      type: 'update_task',
      problem: null,
      task: { id: 't14', key: 'RIG-14', title: 'Pressure test report', project: 'Rig Inspection Portal', url: '?task=t14' },
      base: { version: 3, assigneeIds: ['u-omar'] },
      before: { due: '2026-10-19', priority: 'NORMAL', columnId: 'p-rig:doing', column: 'In progress', assignees: [{ id: 'u-omar', name: 'Omar Said' }] },
      fields: { due: '2026-10-25', priority: 'URGENT', columnId: 'p-rig:done', assigneeIds: ['u-sara'] },
      labels: { column: 'Done', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
    });
  });

  it('shiftDays moves the due date by days; add and remove change the people; an unchanged field is left out', async () => {
    const { actions } = setup();
    const { items } = await card(actions, SARA, [
      { type: 'update_task', task: 'RIG-9', shiftDays: 7, priority: 'normal' },
      { type: 'update_task', task: 'task:t21', addAssignees: ['sara'], removeAssignees: ['omar'] },
    ]);
    expect((items[0] as UpdateTaskItem).fields).toEqual({ due: '2026-10-27' });
    expect((items[1] as UpdateTaskItem).fields).toEqual({ assigneeIds: ['u-sara'] });
  });

  it('nothing to change: shown, locked, with why', async () => {
    const { actions } = setup();
    const { items } = await card(actions, SARA, [{ type: 'update_task', task: 'RIG-9', priority: 'NORMAL' }]);
    expect(items[0]).toMatchObject({ locked: true, problem: 'Nothing to change: it’s already like this.' });
  });

  it('a task the person can’t see is never found (FAL-1 for Sara): left out, with a note', async () => {
    const { actions } = setup();
    expect(await actions.prepare(SARA, [{ type: 'update_task', task: 'FAL-1', priority: 'HIGH' }], { final: false })).toEqual({ kind: 'retry', problems: ['No task you can see matches “FAL-1”.'] });
    const out = await actions.prepare(SARA, [{ type: 'update_task', task: 'FAL-1', priority: 'HIGH' }, { type: 'update_task', task: 'RIG-9', priority: 'HIGH' }], { final: true });
    expect(out.kind).toBe('card');
    const c = (out as { card: ProposalDraft }).card;
    expect(c.items.map((i) => i.type)).toEqual(['update_task']);
    expect(c.note).toContain('No task you can see matches “FAL-1”');
  });

  it('nothing at all it can do: a plain answer instead of an empty card', async () => {
    const { actions } = setup();
    const out = await actions.prepare(SARA, [{ type: 'update_task', task: 'FAL-1', priority: 'HIGH' }], { final: true });
    expect(out).toMatchObject({ kind: 'answer', text: expect.stringContaining('No task you can see matches “FAL-1”') });
  });

  it('no delete in v1, and at most 50 changes on a card', async () => {
    const { actions } = setup();
    const many = Array.from({ length: 53 }, (_, i) => ({ type: 'create_task', title: `Item ${i + 1}`, project: 'RIG' }));
    const c = await card(actions, OMAR, [{ type: 'delete_task', task: 'RIG-9' }, ...many]);
    expect(c.items).toHaveLength(50);
    expect(c.items[49]).toMatchObject({ id: 'c50', fields: { title: 'Item 50' } });
    expect(c.note).toMatch(/at most 50 changes/);
    expect(c.note).toMatch(/can’t delete/i);
  });

  it('final minutes: drafted from the meeting by the server, for someone who may write them', async () => {
    const { actions, world } = setup();
    const { items } = await card(actions, OMAR, [{ type: 'draft_minutes', meeting: 'meeting:m-site' }]);
    const m = items[0] as MinutesItem;
    expect(m).toMatchObject({ type: 'draft_minutes', problem: null, locked: false, meeting: { id: 'm-site', title: 'Site visit', url: '/meetings/m-site' }, base: { status: 'NONE', savedAt: null } });
    expect(m.fields.content.summary).toBe('Draft for Site visit.');
    expect(world.calls).toEqual(['draftMinutes m-site']);
  });

  it('final minutes already final, or a meeting the person can’t change: locked, with why (and no draft is made)', async () => {
    const { actions, world } = setup();
    const approved = (await card(actions, ADMIN, [{ type: 'draft_minutes', meeting: 'Weekly review' }])).items[0]!;
    expect(approved).toMatchObject({ locked: true, problem: 'These minutes are final. Reopen them on the meeting page to change them.' });
    const notMine = (await card(actions, SARA, [{ type: 'draft_minutes', meeting: 'Site visit' }])).items[0]!;
    expect(notMine).toMatchObject({ locked: true, problem: 'Only the organizer, the project manager or an admin can write the final minutes.' });
    expect(world.calls).toEqual([]);
  });

  it('a draft already saved is replaced (with a warning: Undo puts it back)', async () => {
    const { actions, world } = setup();
    world.minutes.set('m-site', { content: { summary: 'Mine', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null, savedAt: new Date('2026-10-23T09:00:00Z') });
    const m = (await card(actions, OMAR, [{ type: 'draft_minutes', meeting: 'Site visit' }])).items[0] as MinutesItem;
    expect(m.base).toEqual({ status: 'DRAFT', savedAt: '2026-10-23T09:00:00.000Z' });
    expect(m.warning).toMatch(/replaces the draft saved on Fri 23 Oct 2026/);
  });

  it('a meeting: day and time in company time, the person is the organizer, people checked', async () => {
    const { actions } = setup((d) => d.people.push({ id: 'u-gone', firstName: 'Gone', lastName: 'User', username: 'gone', active: false }));
    const { items } = await card(actions, OMAR, [
      { type: 'schedule_meeting', title: 'Review', date: 'tuesday', time: '10:00', minutes: 45, people: ['Sara', 'me'], project: 'RIG', agenda: ['Pressure test', ' '] },
      { type: 'schedule_meeting', title: 'Old', date: 'today', time: '09:00', people: ['gone'] },
      { type: 'schedule_meeting', title: 'No time', date: 'monday', people: [] },
    ]);
    expect(items[0]).toMatchObject({
      problem: null,
      fields: { title: 'Review', projectId: 'p-rig', date: '2026-10-27', time: '10:00', minutes: 45, attendeeIds: ['u-sara'], agenda: ['Pressure test'], description: '' },
      labels: { project: 'Rig Inspection Portal', attendees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
    });
    expect(items[1]!.problem).toMatch(/That time has passed|isn’t active/);
    expect(items[2]).toMatchObject({ problem: 'Pick a time.', fields: { minutes: 30, time: null } });
  });
});

describe('MICO AI actions: carrying out a confirmed card', () => {
  it('creates the tasks as the person, history marked via MICO AI, one audit entry each', async () => {
    const { actions, world } = setup();
    const c = await card(actions, SARA, [
      { type: 'create_task', title: 'Replace the gauge', project: 'RIG', assignees: ['Sara'], due: 'tuesday' },
      { type: 'create_task', title: 'Check the valve', project: 'RIG' },
    ]);
    const out = await confirmAll(actions, SARA, c.items);
    expect(world.calls).toEqual(['createTask RIG-35 via', 'createTask RIG-36 via']);
    expect(out.results.c1).toMatchObject({ status: 'done', link: { label: 'RIG-35', url: '?task=t-new-101' } });
    expect(out.results.c2).toMatchObject({ status: 'done', link: { label: 'RIG-36' } });
    expect(world.audits).toEqual([
      expect.objectContaining({ userId: 'u-sara', ip: '10.0.0.7', action: 'mico-ai.task.create', entityId: 't-new-101', via: true }),
      expect.objectContaining({ action: 'mico-ai.task.create', entityId: 't-new-102' }),
    ]);
    expect(world.audits[0]!.newValue).toMatchObject({ via: 'MICO AI', key: 'RIG-35', title: 'Replace the gauge' });
  });

  it('uses the person’s edits — checked again — and refuses an edit they couldn’t make', async () => {
    const { actions, world } = setup();
    const c = await card(actions, SARA, [
      { type: 'create_task', title: 'Replace the gauge', project: 'RIG' },
      { type: 'create_task', title: 'Second', project: 'RIG' },
    ]);
    const edited = actions.applyEdits(c.items, [
      { id: 'c1', include: true, edits: { title: 'Replace the north gauge', due: '2026-11-02', priority: 'URGENT', assigneeIds: ['u-sara'], ignored: 'x' } },
      { id: 'c2', include: true, edits: { projectId: 'p-falcon' } },
    ]);
    expect(edited[0]).toMatchObject({ fields: { title: 'Replace the north gauge', due: '2026-11-02', priority: 'URGENT', assigneeIds: ['u-sara'] } });
    const out = await confirmAll(actions, SARA, edited);
    expect(out.results.c1!.status).toBe('done');
    expect(world.data.tasks.find((t) => t.id === 't-new-101')).toMatchObject({ title: 'Replace the north gauge', priority: 'URGENT', assigneeIds: ['u-sara'] });
    expect(out.results.c2).toMatchObject({ status: 'refused', message: 'Pick a project you can see.' });
    expect(out.items[0]).toMatchObject({ labels: { assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] } });
  });

  it('a bad edit (not a real date) refuses that change, never guesses', async () => {
    const { actions } = setup();
    const c = await card(actions, SARA, [{ type: 'create_task', title: 'A', project: 'RIG' }]);
    const edited = actions.applyEdits(c.items, [{ id: 'c1', include: true, edits: { due: '2026-02-30' } }]);
    expect((await confirmAll(actions, SARA, edited)).results.c1).toMatchObject({ status: 'refused' });
  });

  it('unticked changes are skipped; locked ones are refused with their reason', async () => {
    const { actions, world } = setup();
    const c = await card(actions, SARA, [
      { type: 'update_task', task: 'RIG-9', priority: 'HIGH' },
      { type: 'update_task', task: 'RIG-9', priority: 'NORMAL' },
      { type: 'create_task', title: 'B', project: 'RIG' },
    ]);
    const out = await confirmAll(actions, SARA, c.items, { include: { c1: false, c2: true, c3: true } });
    expect(out.results.c1).toMatchObject({ status: 'skipped' });
    expect(out.results.c2).toMatchObject({ status: 'refused', message: 'Nothing to change: it’s already like this.' });
    expect(out.results.c3).toMatchObject({ status: 'done' });
    expect(world.calls).toEqual(['createTask RIG-35 via']);
  });

  it('a task changed since it was proposed is refused (saying who); the rest go ahead', async () => {
    const { actions, world } = setup();
    const c = await card(actions, SARA, [
      { type: 'update_task', task: 'RIG-14', due: 'next week' },
      { type: 'update_task', task: 'RIG-9', due: 'next week' },
    ]);
    world.touchTask('t14', 'u-omar', { priority: 'HIGH' });
    const out = await confirmAll(actions, SARA, c.items);
    expect(out.results.c1).toMatchObject({ status: 'refused', message: 'RIG-14 changed after MICO AI suggested this (Omar Said changed it), so it was left as it is. Ask again to see it as it is now.' });
    expect(out.results.c2).toMatchObject({ status: 'done', link: { label: 'RIG-9', url: '?task=t9' } });
    expect(world.data.tasks.find((t) => t.id === 't14')!.dueDate!.toISOString().slice(0, 10)).toBe('2026-10-19');
  });

  it('a task deleted since it was proposed is refused', async () => {
    const { actions, world } = setup();
    const c = await card(actions, SARA, [{ type: 'update_task', task: 'RIG-9', priority: 'HIGH' }]);
    await world.port.deleteTask(ADMIN, 't9');
    expect((await confirmAll(actions, SARA, c.items)).results.c1).toMatchObject({ status: 'refused', message: 'RIG-9 was deleted, so nothing was changed.' });
  });

  it('partial failure: someone taken off the project since is refused for that change only; a write that fails is reported', async () => {
    const { actions, world, data } = setup();
    const c = await card(actions, OMAR, [
      { type: 'create_task', title: 'One', project: 'RIG', assignees: ['Sara'] },
      { type: 'create_task', title: 'Two', project: 'RIG' },
      { type: 'create_task', title: 'Three', project: 'RIG' },
    ]);
    data.members.splice(data.members.findIndex((m) => m.userId === 'u-sara' && m.projectId === 'p-rig'), 1);
    world.failNext('createTask');
    const out = await confirmAll(actions, OMAR, c.items);
    expect(out.results.c1).toMatchObject({ status: 'refused', message: 'Sara Ahmed isn’t on Rig Inspection Portal, so they can’t be assigned.' });
    expect(out.results.c2).toMatchObject({ status: 'failed', message: 'Something went wrong while making this change. Nothing else was affected.' });
    expect(out.results.c3).toMatchObject({ status: 'done' });
  });

  it('a change of a task’s fields and people, as the person, through the version they saw', async () => {
    const { actions, world } = setup();
    const c = await card(actions, SARA, [{ type: 'update_task', task: 'RIG-14', due: '2026-11-01', status: 'done', assignees: ['Sara'] }]);
    const out = await confirmAll(actions, SARA, c.items);
    expect(out.results.c1!.status).toBe('done');
    expect(world.calls).toEqual(['updateTask RIG-14 via', 'setAssignees RIG-14 +u-sara -u-omar via']);
    expect(world.data.tasks.find((t) => t.id === 't14')).toMatchObject({ category: 'DONE', assigneeIds: ['u-sara'] });
    expect(world.audits[0]).toMatchObject({ action: 'mico-ai.task.update', entityId: 't14', oldValue: { due: '2026-10-19', columnId: 'p-rig:doing', assigneeIds: ['u-omar'] } });
  });

  it('a meeting is created with its people and agenda, and the invitations go out when the box is ticked', async () => {
    const { actions, world } = setup();
    const c = await card(actions, OMAR, [{ type: 'schedule_meeting', title: 'Review', date: 'tuesday', time: '10:00', people: ['Sara'], agenda: ['Pressure test'] }]);
    const out = await confirmAll(actions, OMAR, c.items);
    expect(out.results.c1).toMatchObject({ status: 'done', link: { label: 'Review', url: '/meetings/m-new-101' } });
    const m = world.data.meetings!.find((x) => x.id === 'm-new-101')!;
    expect(m).toMatchObject({ organizerId: 'u-omar', attendeeUserIds: ['u-sara'], startAt: new Date('2026-10-27T06:00:00Z'), endAt: new Date('2026-10-27T06:30:00Z') });
    expect(world.invites).toEqual(['m-new-101']);
    expect(out.results.c1!.message).toMatch(/Invitations emailed to 2 people/);

    const quiet = setup();
    const c2 = await card(quiet.actions, OMAR, [{ type: 'schedule_meeting', title: 'Quiet', date: 'tuesday', time: '10:00', people: ['Sara'] }]);
    const out2 = await confirmAll(quiet.actions, OMAR, c2.items, { sendInvites: false });
    expect(out2.results.c1!.status).toBe('done');
    expect(quiet.world.invites).toEqual([]);
  });

  it('a meeting whose invitations can’t be emailed is still made, and says so', async () => {
    const { actions, world } = setup();
    const c = await card(actions, OMAR, [{ type: 'schedule_meeting', title: 'Review', date: 'tuesday', time: '10:00', people: ['Sara'] }]);
    world.failNext('sendInvites');
    const out = await confirmAll(actions, OMAR, c.items);
    expect(out.results.c1).toMatchObject({ status: 'done' });
    expect(out.results.c1!.message).toMatch(/invitations couldn’t be emailed/i);
  });

  it('final minutes are saved as a DRAFT for review — never approved or emailed', async () => {
    const { actions, world } = setup();
    const c = await card(actions, OMAR, [{ type: 'draft_minutes', meeting: 'Site visit' }]);
    const edited = actions.applyEdits(c.items, [{ id: 'c1', include: true, edits: { content: { summary: 'Edited summary', decisions: ['Go'], discussion: [], risks: [], nextSteps: [] } } }]);
    const out = await confirmAll(actions, OMAR, edited);
    expect(out.results.c1).toMatchObject({ status: 'done', link: { label: 'Open the meeting', url: '/meetings/m-site' } });
    expect(world.minutes.get('m-site')).toMatchObject({ status: 'DRAFT', approvedById: null, content: { summary: 'Edited summary', decisions: ['Go'] } });
    expect(world.calls.filter((x) => /saveMinutes/.test(x))).toEqual(['saveMinutes m-site DRAFT via']);
  });

  it('minutes approved by someone since the draft was made: refused, left as they are', async () => {
    const { actions, world } = setup();
    const c = await card(actions, OMAR, [{ type: 'draft_minutes', meeting: 'Site visit' }]);
    world.minutes.set('m-site', { content: { summary: 'Final', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'APPROVED', approvedById: 'u-admin', approvedAt: NOW, savedAt: NOW });
    const out = await confirmAll(actions, OMAR, c.items);
    expect(out.results.c1).toMatchObject({ status: 'refused' });
    expect(out.results.c1!.message).toMatch(/minutes changed after MICO AI drafted/);
    expect(world.minutes.get('m-site')!.status).toBe('APPROVED');
  });

  it('reports each result as it goes (so a crash part-way leaves a true record)', async () => {
    const { actions } = setup();
    const c = await card(actions, SARA, [
      { type: 'create_task', title: 'A', project: 'RIG' },
      { type: 'create_task', title: 'B', project: 'RIG' },
    ]);
    const seen: Array<Record<string, ItemResult>> = [];
    await confirmAll(actions, SARA, c.items, { onResult: async (r) => void seen.push(structuredClone(r)) });
    expect(seen.map((r) => Object.keys(r))).toEqual([['c1'], ['c1', 'c2']]);
  });
});

describe('MICO AI actions: undo', () => {
  async function confirmed(viewer = OMAR) {
    const s = setup();
    const c = await card(s.actions, viewer, [
      { type: 'create_task', title: 'New one', project: 'RIG', assignees: ['Sara'] },
      { type: 'update_task', task: 'RIG-9', due: '2026-11-03', priority: 'HIGH', assignees: ['Omar'] },
      { type: 'schedule_meeting', title: 'Review', date: 'tuesday', time: '10:00', people: ['Sara'] },
      { type: 'draft_minutes', meeting: 'Site visit' },
    ]);
    const out = await confirmAll(s.actions, viewer, c.items);
    expect(Object.values(out.results).map((r) => r.status)).toEqual(['done', 'done', 'done', 'done']);
    s.world.calls.length = 0;
    s.world.audits.length = 0;
    return { ...s, out };
  }

  it('puts every change back: deletes the new task, restores the fields and people, cancels the invited meeting, removes the draft', async () => {
    const { actions, world, out } = await confirmed();
    const undo = await actions.revert(OMAR, out.items, out.results, { ip: null });
    expect(undo).toEqual({
      c1: { status: 'undone', message: 'RIG-35 was deleted.' },
      c2: { status: 'undone', message: 'RIG-9 is back as it was.' },
      c3: { status: 'undone', message: 'The meeting was cancelled, and the people invited were told.' },
      c4: { status: 'undone', message: 'The draft was removed.' },
    });
    // Newest first, as the person would undo them by hand.
    expect(world.calls).toEqual(['clearMinutes m-site via', 'cancelMeeting Review via', 'updateTask RIG-9 via', 'setAssignees RIG-9 +u-sara -u-omar via', 'deleteTask RIG-35 via']);
    expect(world.data.tasks.find((t) => t.id === 't9')).toMatchObject({ priority: 'NORMAL', assigneeIds: ['u-sara'] });
    expect(world.data.tasks.find((t) => t.id === 't9')!.dueDate!.toISOString().slice(0, 10)).toBe('2026-10-20');
    expect(world.audits.map((a) => a.action)).toEqual(['mico-ai.undo', 'mico-ai.undo', 'mico-ai.undo', 'mico-ai.undo']);
  });

  it('a meeting nobody was invited to is deleted; an earlier draft of the minutes comes back', async () => {
    const s = setup();
    s.world.minutes.set('m-site', { content: { summary: 'Mine', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null, savedAt: new Date('2026-10-23T09:00:00Z') });
    const c = await card(s.actions, OMAR, [
      { type: 'schedule_meeting', title: 'Quiet', date: 'tuesday', time: '10:00', people: [] },
      { type: 'draft_minutes', meeting: 'Site visit' },
    ]);
    const out = await confirmAll(s.actions, OMAR, c.items, { sendInvites: false });
    const undo = await s.actions.revert(OMAR, out.items, out.results, { ip: null });
    expect(undo.c1).toEqual({ status: 'undone', message: 'The meeting was deleted.' });
    expect(undo.c2).toEqual({ status: 'undone', message: 'The earlier draft is back.' });
    expect(s.world.minutes.get('m-site')!.content.summary).toBe('Mine');
  });

  it('refuses, per change, anything someone changed since — saying who — and puts the rest back', async () => {
    const { actions, world, out } = await confirmed();
    world.touchTask('t-new-101', 'u-sara');
    world.touchTask('t9', 'u-admin', { priority: 'LOW' });
    world.touchMeeting('m-new-102');
    const undo = await actions.revert(OMAR, out.items, out.results, { ip: null });
    expect(undo.c1).toEqual({ status: 'refused', message: 'Sara Ahmed changed RIG-35 since, so it was left as it is.' });
    expect(undo.c2).toEqual({ status: 'refused', message: 'Khurram Shahzad changed RIG-9 since, so it was left as it is.' });
    expect(undo.c3).toEqual({ status: 'refused', message: 'The meeting was changed since, so it was left as it is.' });
    expect(undo.c4!.status).toBe('undone');
    expect(world.data.tasks.find((t) => t.id === 't9')!.priority).toBe('LOW');
  });

  it('something already deleted, or minutes saved again since, is refused too', async () => {
    const { actions, world, out } = await confirmed();
    await world.port.deleteTask(ADMIN, 't-new-101');
    await world.port.saveMinutes(ADMIN, 'm-site', { content: { summary: 'Changed', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null });
    const undo = await actions.revert(OMAR, out.items, out.results, { ip: null });
    expect(undo.c1).toEqual({ status: 'refused', message: 'RIG-35 was already deleted.' });
    expect(undo.c4).toEqual({ status: 'refused', message: 'The final minutes were changed since, so they were left as they are.' });
  });

  it('only what was done is undone (skipped and refused changes are left alone)', async () => {
    const s = setup();
    const c = await card(s.actions, SARA, [
      { type: 'create_task', title: 'A', project: 'RIG' },
      { type: 'create_task', title: 'B', project: 'RIG' },
    ]);
    const out = await confirmAll(s.actions, SARA, c.items, { include: { c1: false, c2: true } });
    s.world.calls.length = 0;
    const undo = await s.actions.revert(SARA, out.items, out.results, { ip: null });
    expect(Object.keys(undo)).toEqual(['c2']);
    expect(s.world.calls).toEqual(['deleteTask RIG-35 via']);
  });

  it('someone who lost access to the project since can’t undo its change', async () => {
    const s = setup();
    const c = await card(s.actions, SARA, [{ type: 'update_task', task: 'RIG-9', priority: 'HIGH' }]);
    const out = await confirmAll(s.actions, SARA, c.items);
    s.data.members.splice(s.data.members.findIndex((m) => m.userId === 'u-sara'), 1);
    const undo = await s.actions.revert(SARA, out.items, out.results, { ip: null });
    expect(undo.c1).toEqual({ status: 'refused', message: 'You can’t change RIG-9 any more, so it was left as it is.' });
  });

  it('Layla, outside Rig Inspection, sees nothing of it to change in the first place', async () => {
    const { actions } = setup();
    const out = await actions.prepare(LAYLA, [{ type: 'update_task', task: 'RIG-14', priority: 'HIGH' }], { final: true });
    expect(out.kind).toBe('answer');
  });
});
