import { describe, it, expect, beforeEach } from 'vitest';
import { as, FORM_BODY, makeFixture, PEOPLE, pngDataUrl, type Fixture } from './inspection-service.fixture';

const { admin, owner, manager, inspector, member, outsider } = PEOPLE;

let f: Fixture;
beforeEach(() => {
  f = makeFixture();
});

const rejects = async (p: Promise<unknown>, status: number, code?: string) => {
  const err = (await p.then(() => null, (e: unknown) => e)) as { status?: number; code?: string } | null;
  expect(err, 'it should have been refused').not.toBeNull();
  expect(err!.status).toBe(status);
  if (code) expect(err!.code).toBe(code);
  return err;
};

/** A form made by the project's owner, and an inspection of it started by Ivan on P1. */
async function started(over: { taskId?: string | null; place?: string | null; body?: Record<string, unknown> } = {}) {
  const form = await f.service.createForm(as(owner), { ...FORM_BODY, ...(over.body ?? {}) });
  const insp = await f.service.start(as(inspector), 'P1', { formId: form.id, taskId: over.taskId ?? null, place: over.place ?? 'Rig 3, north deck' });
  // An hour on: the answers below are made between the start and now.
  f.now.at = new Date('2026-10-27T09:00:00Z');
  const ids = insp.structure.sections.flatMap((s) => s.items.map((i) => i.id));
  return { form, insp, pressure: ids[0]!, valves: ids[1]!, rails: ids[2]! };
}

let tick = 0;
const edit = (itemId: string, value: { result?: string | null; reading?: string | null; note?: string | null }, at?: string) => ({
  itemId,
  result: value.result ?? null,
  reading: value.reading ?? null,
  note: value.note ?? null,
  editedAt: at ?? new Date(Date.UTC(2026, 9, 27, 8, 0, ++tick)).toISOString(),
});

async function answeredAll(s: Awaited<ReturnType<typeof started>>, pressure = '120') {
  return f.service.answer(as(inspector), s.insp.id, [edit(s.pressure, { reading: pressure }), edit(s.valves, { result: 'PASS' }), edit(s.rails, { result: 'FAIL', note: 'One rail loose' })]);
}

const seenOf = (detail: { answers: Array<{ itemId: string; editedAt: string }> }) => detail.answers.map((a) => ({ itemId: a.itemId, editedAt: a.editedAt }));
async function finishBody(id: string, over: Record<string, unknown> = {}) {
  const detail = await f.service.get(as(inspector), id);
  return { finishId: 'fin-1', revision: detail.revision, seen: seenOf(detail), signatures: [{ role: 'INSPECTOR', name: 'Ivan Inspector', method: 'DRAWN', image: await pngDataUrl(), signedAt: '2026-10-27T08:30:00Z' }], ...over };
}

describe('forms: who may manage them', () => {
  it('lets an administrator and anyone who runs a project create one; a plain member may not', async () => {
    await expect(f.service.createForm(as(admin), FORM_BODY)).resolves.toMatchObject({ title: 'Rig daily check' });
    await expect(f.service.createForm(as(owner), FORM_BODY)).resolves.toMatchObject({ createdBy: { id: owner, name: 'Olivia Owner' } });
    await expect(f.service.createForm(as(manager), FORM_BODY)).resolves.toBeTruthy();
    await rejects(f.service.createForm(as(member), FORM_BODY), 403);
    expect((await f.service.listForms(as(member))).canCreate).toBe(false);
    expect((await f.service.listForms(as(manager))).canCreate).toBe(true);
  });

  it('lets everyone read forms; only the creator and administrators edit or delete them', async () => {
    const form = await f.service.createForm(as(owner), FORM_BODY);
    const list = await f.service.listForms(as(member));
    expect(list.forms).toEqual([expect.objectContaining({ id: form.id, itemCount: 3, sectionCount: 2, canEdit: false })]);
    expect((await f.service.listForms(as(owner))).forms[0]!.canEdit).toBe(true);
    expect((await f.service.listForms(as(admin))).forms[0]!.canEdit).toBe(true);
    await rejects(f.service.updateForm(as(manager), form.id, { ...FORM_BODY, title: 'Mine now', expectedVersion: 1 }), 403);
    const edited = await f.service.updateForm(as(admin), form.id, { ...FORM_BODY, title: 'Edited by admin', expectedVersion: 1 });
    expect(edited).toMatchObject({ title: 'Edited by admin', version: 2 });
    await rejects(f.service.updateForm(as(owner), form.id, { ...FORM_BODY, expectedVersion: 1 }), 409, 'VERSION_CONFLICT');
    await rejects(f.service.deleteForm(as(manager), form.id), 403);
    await f.service.deleteForm(as(owner), form.id);
    await rejects(f.service.getForm(as(owner), form.id), 404);
  });

  it('keeps item ids across an edit, so started inspections and reports keep pointing at the same items', async () => {
    const form = await f.service.createForm(as(owner), FORM_BODY);
    const items = form.structure.sections.flatMap((s) => s.items);
    const sections = form.structure.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) }));
    sections[1]!.items.push({ kind: 'CHECK', label: 'Lights work' } as never);
    const edited = await f.service.updateForm(as(owner), form.id, { ...FORM_BODY, sections, expectedVersion: 1 });
    const after = edited.structure.sections.flatMap((s) => s.items);
    expect(after.slice(0, 3).map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(after).toHaveLength(4);
  });

  it('writes an audit line for each form created, edited and deleted', async () => {
    const form = await f.service.createForm(as(owner), FORM_BODY);
    await f.service.updateForm(as(owner), form.id, { ...FORM_BODY, title: 'Renamed', expectedVersion: 1 });
    await f.service.deleteForm(as(owner), form.id);
    expect(f.audit.map((a) => [a.module, a.action, a.entityId, a.userId])).toEqual([
      ['inspections', 'inspection-form.created', form.id, owner],
      ['inspections', 'inspection-form.edited', form.id, owner],
      ['inspections', 'inspection-form.deleted', form.id, owner],
    ]);
    expect(f.audit[1]!.newValue).toMatchObject({ title: 'Renamed', version: 2, items: 3 });
  });
});

describe('starting an inspection', () => {
  it('lets anyone on the team start one from a form; it copies the form, and editing the form later changes nothing', async () => {
    const { form, insp } = await started();
    expect(insp).toMatchObject({ projectId: 'P1', title: 'Rig daily check', status: 'IN_PROGRESS', place: 'Rig 3, north deck', inspector: { id: inspector, name: 'Ivan Inspector' }, counts: { total: 3, answered: 0 } });
    await f.service.updateForm(as(owner), form.id, { ...FORM_BODY, title: 'Changed', sections: [{ title: 'Only', items: [{ kind: 'CHECK', label: 'One' }] }], expectedVersion: 1 });
    await f.service.deleteForm(as(owner), form.id);
    const again = await f.service.get(as(inspector), insp.id);
    expect(again.title).toBe('Rig daily check');
    expect(again.structure.sections.map((s) => s.title)).toEqual(['Well head', 'Deck']);
    expect(f.audit.find((a) => a.action === 'inspection.started')).toMatchObject({ entityId: insp.id, userId: inspector, newValue: { projectId: 'P1', formId: form.id, title: 'Rig daily check' } });
  });

  it('is refused outside the team (as if the project weren’t there), on an archived project, and from a deleted form', async () => {
    const form = await f.service.createForm(as(owner), FORM_BODY);
    await rejects(f.service.start(as(outsider), 'P1', { formId: form.id }), 404);
    await rejects(f.service.start(as(inspector), 'P2', { formId: form.id }), 404);
    f.projects.get('P1')!.status = 'ARCHIVED';
    await rejects(f.service.start(as(inspector), 'P1', { formId: form.id }), 409, 'PROJECT_ARCHIVED');
    f.projects.get('P1')!.status = 'ACTIVE';
    await f.service.deleteForm(as(owner), form.id);
    await rejects(f.service.start(as(inspector), 'P1', { formId: form.id }), 404);
  });

  it('attaches it to a task of the same project, and says so in the task’s history', async () => {
    const task = f.addTask('P1');
    const { insp } = await started({ taskId: task.id });
    expect(insp.task).toEqual({ id: task.id, key: task.key, title: 'Inspect rig 3', done: false });
    expect(f.activity).toEqual([{ taskId: task.id, userId: inspector, action: 'INSPECTION_ATTACHED', meta: { inspectionId: insp.id, inspection: 'Rig daily check' } }]);
    const other = f.addTask('P2');
    const form = await f.service.createForm(as(owner), FORM_BODY);
    await rejects(f.service.start(as(inspector), 'P1', { formId: form.id, taskId: other.id }), 400);
  });

  it('lists a project’s inspections for its team, with their result', async () => {
    const a = await started();
    await answeredAll(a);
    const list = await f.service.listForProject(as(member), 'P1');
    expect(list.canStart).toBe(true);
    expect(list.inspections).toEqual([expect.objectContaining({ id: a.insp.id, status: 'IN_PROGRESS', counts: { total: 3, answered: 3, passed: 2, failed: 1, na: 0 }, result: '3 of 3 answered · 1 failed' })]);
    await rejects(f.service.listForProject(as(outsider), 'P1'), 404);
  });
});

describe('answers: a reading decides its own result, on the server', () => {
  it('fails a reading outside its limits even when the device says it passed — and passes one inside even when told it failed', async () => {
    const s = await started();
    const r = await f.service.answer(as(inspector), s.insp.id, [edit(s.pressure, { result: 'PASS', reading: '162.5', note: 'Gauge read high' })]);
    expect(r.results[0]).toMatchObject({ itemId: s.pressure, status: 'applied', answer: { result: 'FAIL', reading: '162.5', note: 'Gauge read high' } });
    const r2 = await f.service.answer(as(inspector), s.insp.id, [edit(s.pressure, { result: 'FAIL', reading: '150' })]);
    expect(r2.results[0]!.answer.result).toBe('PASS');
    const r3 = await f.service.answer(as(inspector), s.insp.id, [edit(s.pressure, { result: 'NA', reading: '-0.5' })]);
    expect(r3.results[0]!.answer.result).toBe('FAIL');
  });

  it('reads a typed reading (comma, Arabic digits) and refuses one that isn’t a number', async () => {
    const s = await started();
    const r = await f.service.answer(as(inspector), s.insp.id, [edit(s.pressure, { reading: '١٤٩٫٥' })]);
    expect(r.results[0]!.answer).toMatchObject({ reading: '149.5', result: 'PASS' });
    await rejects(f.service.answer(as(inspector), s.insp.id, [edit(s.pressure, { reading: '12 psi' })]), 400);
  });

  it('never passes a reading without a value (N/A or failed it may be)', async () => {
    const s = await started();
    const r = await f.service.answer(as(inspector), s.insp.id, [edit(s.pressure, { result: 'PASS' }), edit(s.valves, { result: 'PASS' })]);
    expect(r.results.map((x) => x.answer.result)).toEqual([null, 'PASS']);
    expect(r.inspection.counts).toEqual({ total: 3, answered: 1, passed: 1, failed: 0, na: 0 });
  });

  it('refuses an item that isn’t on the inspection, a note over 2000 characters and an unknown result', async () => {
    const s = await started();
    await rejects(f.service.answer(as(inspector), s.insp.id, [edit('not-an-item', { result: 'PASS' })]), 400);
    await rejects(f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'PASS', note: 'x'.repeat(2001) })]), 400);
    await rejects(f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'MAYBE' })]), 400);
  });

  it('keeps the latest edit when an older one arrives late, and says what is kept', async () => {
    const s = await started();
    await f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'FAIL', note: 'Leak' }, '2026-10-27T08:20:00.000Z')]);
    const late = await f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'PASS' }, '2026-10-27T08:10:00.000Z')]);
    expect(late.results[0]).toMatchObject({ status: 'stale', answer: { result: 'FAIL', note: 'Leak', editedAt: '2026-10-27T08:20:00.000Z' } });
  });

  it('holds a device clock that runs ahead to the server’s time, so it can’t win every later edit', async () => {
    const s = await started();
    const r = await f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'PASS' }, '2027-01-01T00:00:00.000Z')]);
    expect(r.results[0]!.answer.editedAt).toBe(f.now.at.toISOString());
  });

  it('takes answers only from the inspector, only while in progress, only while it exists', async () => {
    const s = await started();
    await rejects(f.service.answer(as(member), s.insp.id, [edit(s.valves, { result: 'PASS' })]), 409, 'NOT_THE_INSPECTOR');
    await rejects(f.service.answer(as(admin), s.insp.id, [edit(s.valves, { result: 'PASS' })]), 409, 'NOT_THE_INSPECTOR');
    await rejects(f.service.answer(as(outsider), s.insp.id, [edit(s.valves, { result: 'PASS' })]), 404);
    await answeredAll(s);
    await f.service.finish(as(inspector), s.insp.id, await finishBody(s.insp.id));
    await rejects(f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'FAIL' })]), 409, 'INSPECTION_FINISHED');
    await f.service.remove(as(owner), s.insp.id);
    await rejects(f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'FAIL' })]), 404, 'INSPECTION_GONE');
  });

  it('takes no answers on an archived project', async () => {
    const s = await started();
    f.projects.get('P1')!.status = 'ARCHIVED';
    await rejects(f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'PASS' })]), 409, 'PROJECT_ARCHIVED');
  });
});

describe('finishing: signed, checked against the stored answers, then read-only', () => {
  it('needs every item answered and the signatures the form requires', async () => {
    const s = await started({ body: { clientSignature: 'REQUIRED' } });
    await f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'PASS' })]);
    const err = (await rejects(f.service.finish(as(inspector), s.insp.id, await finishBody(s.insp.id)), 409, 'INSPECTION_INCOMPLETE')) as { details?: unknown };
    expect(err.details).toEqual({ unanswered: [s.pressure, s.rails], missingSignatures: ['CLIENT'] });
    expect((await f.service.get(as(inspector), s.insp.id)).status).toBe('IN_PROGRESS');
  });

  it('refuses when the answers changed after they were signed (another device, a late send)', async () => {
    const s = await started();
    await answeredAll(s);
    const body = await finishBody(s.insp.id);
    await f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'FAIL' })]);
    const err = (await rejects(f.service.finish(as(inspector), s.insp.id, body), 409, 'ANSWERS_CHANGED')) as { details?: { items?: string[] } };
    expect(err.details?.items).toEqual([s.valves]);
    // …and when the device signed answers the server never got.
    const fresh = await finishBody(s.insp.id);
    await rejects(f.service.finish(as(inspector), s.insp.id, { ...fresh, seen: [...fresh.seen, { itemId: s.rails, editedAt: '2026-10-27T09:59:00.000Z' }].slice(1) }), 409, 'ANSWERS_CHANGED');
  });

  it('finishes with drawn and typed signatures; a missing optional one is fine', async () => {
    const task = f.addTask('P1');
    const s = await started({ taskId: task.id });
    await answeredAll(s);
    const done = await f.service.finish(as(inspector), s.insp.id, await finishBody(s.insp.id));
    expect(done).toMatchObject({ status: 'FINISHED', counts: { total: 3, answered: 3, passed: 2, failed: 1, na: 0 }, result: '1 failed' });
    expect(done.signatures).toEqual([{ role: 'INSPECTOR', name: 'Ivan Inspector', method: 'DRAWN', image: expect.stringMatching(/^data:image\/png;base64,/), signedAt: '2026-10-27T08:30:00.000Z' }]);
    expect(done.taskOffer).toEqual({ id: task.id, key: task.key, title: 'Inspect rig 3', doneColumnId: 'P1-done' });
    expect(f.activity.at(-1)).toEqual({ taskId: task.id, userId: inspector, action: 'INSPECTION_FINISHED', meta: { inspectionId: s.insp.id, inspection: 'Rig daily check', failed: 1 } });
    expect(f.audit.find((a) => a.action === 'inspection.finished')).toMatchObject({ entityId: s.insp.id, newValue: { projectId: 'P1', passed: 2, failed: 1, na: 0, signedBy: [{ role: 'INSPECTOR', name: 'Ivan Inspector' }] } });

    const typed = await started();
    await answeredAll(typed);
    const body = await finishBody(typed.insp.id, { signatures: [{ role: 'INSPECTOR', name: 'Ivan Inspector', method: 'TYPED', signedAt: '2026-10-27T08:30:00Z' }, { role: 'CLIENT', name: 'Fatma Al Balushi', method: 'DRAWN', image: await pngDataUrl(), signedAt: '2026-10-27T08:31:00Z' }] });
    const t2 = await f.service.finish(as(inspector), typed.insp.id, { ...body, finishId: 'fin-typed' });
    expect(t2.signatures.map((x) => [x.role, x.method, x.image === null])).toEqual([['INSPECTOR', 'TYPED', true], ['CLIENT', 'DRAWN', false]]);
    expect(t2.taskOffer).toBeNull();
  });

  it('refuses signatures the form doesn’t ask for, two for one role, a drawn one that isn’t a PNG, and empty names', async () => {
    const s = await started();
    await answeredAll(s);
    const ok = await finishBody(s.insp.id);
    const signer = ok.signatures[0]!;
    await rejects(f.service.finish(as(inspector), s.insp.id, { ...ok, signatures: [signer, { ...signer, role: 'SUPERVISOR' }] }), 400);
    await rejects(f.service.finish(as(inspector), s.insp.id, { ...ok, signatures: [signer, signer] }), 400);
    await rejects(f.service.finish(as(inspector), s.insp.id, { ...ok, signatures: [{ ...signer, image: 'data:image/png;base64,PGh0bWw+' }] }), 400);
    await rejects(f.service.finish(as(inspector), s.insp.id, { ...ok, signatures: [{ ...signer, image: undefined }] }), 400);
    await rejects(f.service.finish(as(inspector), s.insp.id, { ...ok, signatures: [{ ...signer, name: '   ' }] }), 400);
    expect((await f.service.get(as(inspector), s.insp.id)).status).toBe('IN_PROGRESS');
  });

  it('a repeat of the same finish (an offline replay) returns it as finished; another finish can’t swap the signatures', async () => {
    const s = await started();
    await answeredAll(s);
    const body = await finishBody(s.insp.id);
    await f.service.finish(as(inspector), s.insp.id, body);
    await expect(f.service.finish(as(inspector), s.insp.id, body)).resolves.toMatchObject({ status: 'FINISHED' });
    await rejects(f.service.finish(as(inspector), s.insp.id, { ...body, finishId: 'fin-2', signatures: [{ ...body.signatures[0]!, name: 'Someone Else' }] }), 409, 'ALREADY_FINISHED');
    expect((await f.service.get(as(member), s.insp.id)).signatures[0]!.name).toBe('Ivan Inspector');
    expect(f.audit.filter((a) => a.action === 'inspection.finished')).toHaveLength(1);
  });

  it('keeps a signature’s time between the start and now (a device clock can be wrong)', async () => {
    const s = await started();
    await answeredAll(s);
    f.now.at = new Date('2026-10-27T09:00:00Z');
    const body = await finishBody(s.insp.id, { signatures: [{ role: 'INSPECTOR', name: 'Ivan', method: 'TYPED', signedAt: '2030-01-01T00:00:00Z' }] });
    expect((await f.service.finish(as(inspector), s.insp.id, body)).signatures[0]!.signedAt).toBe('2026-10-27T09:00:00.000Z');
  });
});

describe('reopening, taking over, deleting', () => {
  async function finished() {
    const s = await started();
    await answeredAll(s);
    await f.service.finish(as(inspector), s.insp.id, await finishBody(s.insp.id));
    return s;
  }

  it('only someone who runs the project reopens a finished inspection; the signatures come off and so does the client page', async () => {
    const s = await finished();
    await f.service.setClientVisible(as(owner), s.insp.id, true);
    await rejects(f.service.reopen(as(inspector), s.insp.id), 403);
    await rejects(f.service.reopen(as(member), s.insp.id), 403);
    const back = await f.service.reopen(as(manager), s.insp.id);
    expect(back).toMatchObject({ status: 'IN_PROGRESS', signatures: [], clientVisible: false });
    expect(f.audit.find((a) => a.action === 'inspection.reopened')).toMatchObject({ userId: manager, newValue: { projectId: 'P1', wasShownToClient: true, signedBy: [{ role: 'INSPECTOR', name: 'Ivan Inspector' }] } });
    await rejects(f.service.reopen(as(manager), s.insp.id), 409);
  });

  it('lets someone who runs the project take over an inspection in progress (one inspector at a time)', async () => {
    const s = await started();
    await rejects(f.service.takeOver(as(member), s.insp.id), 403);
    const taken = await f.service.takeOver(as(owner), s.insp.id);
    expect(taken.inspector).toEqual({ id: owner, name: 'Olivia Owner' });
    await rejects(f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'PASS' })]), 409, 'NOT_THE_INSPECTOR');
    await expect(f.service.answer(as(owner), s.insp.id, [edit(s.valves, { result: 'PASS' })])).resolves.toBeTruthy();
    expect(f.audit.find((a) => a.action === 'inspection.taken-over')).toMatchObject({ newValue: { projectId: 'P1', from: inspector, to: owner } });
  });

  it('lets the inspector delete their own inspection in progress, and those who run the project delete any', async () => {
    const mine = await started();
    await rejects(f.service.remove(as(member), mine.insp.id), 403);
    await f.service.remove(as(inspector), mine.insp.id);
    await rejects(f.service.get(as(inspector), mine.insp.id), 404);
    const done = await finished();
    await rejects(f.service.remove(as(inspector), done.insp.id), 403);
    await f.service.remove(as(owner), done.insp.id);
    expect(f.audit.filter((a) => a.action === 'inspection.deleted').map((a) => a.userId)).toEqual([inspector, owner]);
  });
});

describe('follow-up tasks for failed items', () => {
  async function withFailures() {
    const s = await started();
    await f.service.answer(as(inspector), s.insp.id, [edit(s.pressure, { reading: '162', note: 'Over the limit' }), edit(s.valves, { result: 'PASS' }), edit(s.rails, { result: 'FAIL', note: 'One rail loose' })]);
    return s;
  }

  it('makes one task per failed item in the same project, titled from the item, given to the project owner by default', async () => {
    const s = await withFailures();
    const r = await f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.pressure, s.valves, s.rails] });
    expect(r.map((x) => [x.itemId, x.status])).toEqual([[s.pressure, 'created'], [s.valves, 'not-failed'], [s.rails, 'created']]);
    const made = [...f.tasks.values()];
    expect(made.map((t) => [t.title, t.projectId, t.assigneeIds, t.createdById])).toEqual([
      ['Follow up: Pressure', 'P1', [owner], member],
      ['Follow up: Guard rails fitted', 'P1', [owner], member],
    ]);
    expect(made[0]!.description).toContain('Reading: 162 psi (allowed 0–150 psi)');
    expect(made[0]!.description).toContain('Over the limit');
    expect(made[0]!.description).toContain('Rig daily check');
    expect(f.activity.filter((a) => a.action === 'INSPECTION_FOLLOW_UP')).toEqual([
      { taskId: made[0]!.id, userId: member, action: 'INSPECTION_FOLLOW_UP', meta: { inspectionId: s.insp.id, inspection: 'Rig daily check', item: 'Pressure' } },
      { taskId: made[1]!.id, userId: member, action: 'INSPECTION_FOLLOW_UP', meta: { inspectionId: s.insp.id, inspection: 'Rig daily check', item: 'Guard rails fitted' } },
    ]);
    expect(f.audit.find((a) => a.action === 'inspection.follow-ups')).toMatchObject({ entityId: s.insp.id, newValue: { projectId: 'P1', tasks: [made[0]!.key, made[1]!.key] } });
    const detail = await f.service.get(as(member), s.insp.id);
    expect(detail.followUps).toEqual([
      { itemId: s.pressure, task: { id: made[0]!.id, key: made[0]!.key, title: 'Follow up: Pressure', deleted: false, done: false }, pending: false },
      { itemId: s.rails, task: { id: made[1]!.id, key: made[1]!.key, title: 'Follow up: Guard rails fitted', deleted: false, done: false }, pending: false },
    ]);
  });

  it('makes them once: a second tap or a replayed request returns the same task', async () => {
    const s = await withFailures();
    await f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails] });
    const again = await f.service.makeFollowUps(as(inspector), s.insp.id, { itemIds: [s.rails] });
    expect(again).toEqual([expect.objectContaining({ itemId: s.rails, status: 'exists', task: expect.objectContaining({ title: 'Follow up: Guard rails fitted' }) })]);
    expect(f.tasks.size).toBe(1);
  });

  it('two taps at the same moment still make one task', async () => {
    const s = await withFailures();
    let open!: () => void;
    f.gate.wait = new Promise<void>((resolve) => (open = resolve));
    const both = Promise.all([f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails] }), f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails] })]);
    await new Promise((r) => setTimeout(r, 5));
    open();
    const [a, b] = await both;
    expect([a[0]!.status, b[0]!.status].sort()).toEqual(['created', 'pending']);
    expect(f.tasks.size).toBe(1);
  });

  it('gives a chosen person the task, or nobody; refuses someone not on the team', async () => {
    const s = await withFailures();
    await f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.pressure], assigneeId: inspector });
    await f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails], assigneeId: null });
    expect([...f.tasks.values()].map((t) => t.assigneeIds)).toEqual([[inspector], []]);
    const other = await withFailures();
    await rejects(f.service.makeFollowUps(as(member), other.insp.id, { itemIds: [other.rails], assigneeId: outsider }), 400);
    expect(f.tasks.size).toBe(2);
  });

  it('a task that couldn’t be made leaves the item free to try again', async () => {
    const s = await withFailures();
    f.failNextTask.yes = true;
    await expect(f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails] })).rejects.toThrow('database down');
    await expect(f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails] })).resolves.toEqual([expect.objectContaining({ status: 'created' })]);
  });

  it('is for the team only, and not on an archived project', async () => {
    const s = await withFailures();
    await rejects(f.service.makeFollowUps(as(outsider), s.insp.id, { itemIds: [s.rails] }), 404);
    f.projects.get('P1')!.status = 'ARCHIVED';
    await rejects(f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails] }), 409, 'PROJECT_ARCHIVED');
  });

  it('tells the task panel which inspection a task follows up, and which are attached to it', async () => {
    const task = f.addTask('P1');
    const s = await started({ taskId: task.id });
    await f.service.answer(as(inspector), s.insp.id, [edit(s.rails, { result: 'FAIL' })]);
    const [made] = await f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails] });
    expect(await f.service.forTask(as(member), task.id)).toEqual({ attached: [expect.objectContaining({ id: s.insp.id, status: 'IN_PROGRESS' })], followUpOf: null });
    expect(await f.service.forTask(as(member), made!.task!.id)).toEqual({ attached: [], followUpOf: { inspection: expect.objectContaining({ id: s.insp.id }), item: 'Guard rails fitted' } });
    await rejects(f.service.forTask(as(outsider), task.id), 404);
  });
});

describe('Show to client: finished inspections only, by those who run the project', () => {
  async function finished() {
    const s = await started();
    await answeredAll(s, '162');
    await f.service.finish(as(inspector), s.insp.id, await finishBody(s.insp.id));
    return s;
  }

  it('previews exactly what the client will see: the signatures with their names, no other staff names', async () => {
    const s = await finished();
    const p = await f.service.clientPreview(as(owner), s.insp.id);
    expect(p.inspection).toMatchObject({ id: s.insp.id, title: 'Rig daily check', place: 'Rig 3, north deck', counts: { passed: 1, failed: 2, na: 0, total: 3 }, result: '2 failed' });
    expect(p.inspection.signatures).toEqual([{ role: 'Inspector', name: 'Ivan Inspector', signedAt: '2026-10-27T08:30:00.000Z', image: expect.stringMatching(/^data:image\/png/), typed: false }]);
    expect(p.inspection.unsigned).toEqual(['Client']);
    const text = JSON.stringify(p.inspection);
    for (const internal of ['Olivia', 'u-ivan', 'u-olivia', 'formId', 'inspectorId', 'followUp', 'RIG-']) expect(text, internal).not.toContain(internal);
    expect(p.names).toContain('Olivia Owner');
  });

  it('is turned on only once finished, only by those who run the project, and writes audit lines', async () => {
    const open = await started();
    await rejects(f.service.setClientVisible(as(owner), open.insp.id, true), 409, 'INSPECTION_NOT_FINISHED');
    const s = await finished();
    await rejects(f.service.setClientVisible(as(inspector), s.insp.id, true), 403);
    await rejects(f.service.setClientVisible(as(outsider), s.insp.id, true), 404);
    expect(await f.service.setClientVisible(as(manager), s.insp.id, true)).toMatchObject({ clientVisible: true });
    expect(await f.service.setClientVisible(as(manager), s.insp.id, true)).toMatchObject({ clientVisible: true });
    await f.service.setClientVisible(as(admin), s.insp.id, false);
    expect(f.audit.filter((a) => a.module === 'client-view').map((a) => [a.action, a.userId])).toEqual([
      ['client-view.inspection.shown', manager],
      ['client-view.inspection.hidden', admin],
    ]);
  });

  it('gives the client page only finished, marked inspections of that project', async () => {
    const shown = await finished();
    await finished();
    await f.service.setClientVisible(as(owner), shown.insp.id, true);
    const list = await f.service.clientInspections('P1');
    expect(list.map((x) => x.id)).toEqual([shown.insp.id]);
    expect(await f.service.clientInspections('P2')).toEqual([]);
    expect(await f.service.clientInspectionOf('P2', shown.insp.id)).toBeNull();
    expect(await f.service.clientInspectionOf('P1', shown.insp.id)).toMatchObject({ id: shown.insp.id });
  });
});

describe('reading an inspection', () => {
  it('shows the team what each person may do with it', async () => {
    const s = await started();
    expect((await f.service.get(as(inspector), s.insp.id)).permissions).toEqual({ canAnswer: true, canFinish: true, canReopen: false, canTakeOver: false, canDelete: true, canShowToClient: false, canMakeFollowUps: true });
    expect((await f.service.get(as(member), s.insp.id)).permissions).toEqual({ canAnswer: false, canFinish: false, canReopen: false, canTakeOver: false, canDelete: false, canShowToClient: false, canMakeFollowUps: true });
    expect((await f.service.get(as(owner), s.insp.id)).permissions).toMatchObject({ canAnswer: false, canTakeOver: true, canDelete: true });
    await rejects(f.service.get(as(outsider), s.insp.id), 404);
  });
});

describe('review fixes', () => {
  async function finished() {
    const s = await started();
    await answeredAll(s);
    const body = await finishBody(s.insp.id);
    await f.service.finish(as(inspector), s.insp.id, body);
    return { ...s, body };
  }

  it('a finish whose reply was lost, sent again after a reopen, doesn’t finish it again with the old signatures', async () => {
    const s = await finished();
    await f.service.reopen(as(manager), s.insp.id);
    const err = (await rejects(f.service.finish(as(inspector), s.insp.id, s.body), 409, 'INSPECTION_REOPENED')) as { message: string };
    expect(err.message).toMatch(/reopened/);
    const now = await f.service.get(as(inspector), s.insp.id);
    expect(now).toMatchObject({ status: 'IN_PROGRESS', signatures: [], revision: 1 });
    expect(f.audit.filter((a) => a.action === 'inspection.finished')).toHaveLength(1);
    // Signed again for the new revision, it finishes.
    await expect(f.service.finish(as(inspector), s.insp.id, await finishBody(s.insp.id, { finishId: 'fin-2' }))).resolves.toMatchObject({ status: 'FINISHED', revision: 1 });
  });

  it('says the same "not there" to someone outside the project as for a deleted one', async () => {
    const s = await started();
    const outside = (await rejects(f.service.get(as(outsider), s.insp.id), 404)) as { code: string; message: string };
    const missing = (await rejects(f.service.get(as(outsider), 'no-such-inspection'), 404)) as { code: string; message: string };
    expect([outside.code, outside.message]).toEqual([missing.code, missing.message]);
  });

  it('keeps an archived project’s inspections: they can’t be deleted', async () => {
    const s = await started();
    f.projects.get('P1')!.status = 'ARCHIVED';
    expect((await f.service.get(as(owner), s.insp.id)).permissions.canDelete).toBe(false);
    await rejects(f.service.remove(as(owner), s.insp.id), 409, 'PROJECT_ARCHIVED');
  });

  it('a finish sent again after the project was archived still says it is finished', async () => {
    const s = await finished();
    f.projects.get('P1')!.status = 'ARCHIVED';
    await expect(f.service.finish(as(inspector), s.insp.id, s.body)).resolves.toMatchObject({ status: 'FINISHED' });
  });

  it('refuses someone who isn’t the inspector before looking at their signature', async () => {
    const s = await started();
    await answeredAll(s);
    const body = await finishBody(s.insp.id);
    const before = f.cleaned.count;
    await rejects(f.service.finish(as(member), s.insp.id, body), 409, 'NOT_THE_INSPECTOR');
    expect(f.cleaned.count).toBe(before);
    await f.service.finish(as(inspector), s.insp.id, body);
    expect(f.cleaned.count).toBe(before + 1);
  });

  it('writes the audit line for the tasks made before one failed, and makes no second task for them', async () => {
    const s = await started();
    await f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'FAIL' }), edit(s.rails, { result: 'FAIL' })]);
    f.failTaskNumber.n = 2;
    await expect(f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.valves, s.rails] })).rejects.toThrow('database down');
    expect(f.audit.find((a) => a.action === 'inspection.follow-ups')).toMatchObject({ newValue: { tasks: [[...f.tasks.values()][0]!.key] } });
    await f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.valves, s.rails] });
    expect([...f.tasks.values()].map((t) => t.title)).toEqual(['Follow up: Valves closed', 'Follow up: Guard rails fitted']);
  });

  it('names a follow-up task moved to a project the reader can’t see only as moved', async () => {
    const s = await started();
    await f.service.answer(as(inspector), s.insp.id, [edit(s.rails, { result: 'FAIL' })]);
    const [made] = await f.service.makeFollowUps(as(member), s.insp.id, { itemIds: [s.rails] });
    f.tasks.get(made!.task!.id)!.projectId = 'P2';
    const forMember = await f.service.get(as(member), s.insp.id);
    expect(forMember.followUps).toEqual([{ itemId: s.rails, task: null, pending: false, moved: true }]);
    const forAdmin = await f.service.get(as(admin), s.insp.id);
    expect(forAdmin.followUps[0]!.task).toMatchObject({ key: made!.task!.key });
  });

  it('holds an absurd device date (a phone whose clock was reset) to the server’s time', async () => {
    const s = await started();
    const r = await f.service.answer(as(inspector), s.insp.id, [edit(s.valves, { result: 'PASS' }, '0999-01-01T00:00:00.000Z')]);
    expect(r.results[0]!.answer.editedAt).toBe(f.now.at.toISOString());
  });
});

describe('drawn signatures the picture library can’t read', () => {
  it('are refused (nothing is stored); without the library a checked PNG is kept as it came', async () => {
    const s = await started();
    await answeredAll(s);
    f.cleanMode.value = 'unreadable';
    const err = (await rejects(f.service.finish(as(inspector), s.insp.id, await finishBody(s.insp.id)), 400)) as { message: string };
    expect(err.message).toMatch(/couldn’t be read/);
    expect((await f.service.get(as(inspector), s.insp.id)).status).toBe('IN_PROGRESS');
    f.cleanMode.value = 'unavailable';
    await expect(f.service.finish(as(inspector), s.insp.id, await finishBody(s.insp.id))).resolves.toMatchObject({ status: 'FINISHED', signatures: [{ method: 'DRAWN' }] });
  });
});
