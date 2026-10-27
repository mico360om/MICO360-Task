import { describe, it, expect, beforeEach } from 'vitest';
import type { FormStructure } from './inspection-rules';
import type { AnswerRecord, Counts, InspectionStore, SignatureRecord } from './inspection-store';

/**
 * What every inspection store must do (the in-memory one in unit tests, the Prisma one against
 * MySQL). `setup` gives a fresh store, two project ids, and makes (and deletes) tasks in them.
 */
export interface InspectionStoreFixture {
  store: InspectionStore;
  projectA: string;
  projectB: string;
  makeTask: (projectId: string) => Promise<string>;
  deleteTask: (taskId: string) => Promise<void>;
  /** Re-files an inspection under another project (as a direct change to its row). */
  moveInspection: (inspectionId: string, projectId: string) => Promise<void>;
}

const structure: FormStructure = {
  sections: [
    {
      id: 's1',
      title: 'Well head',
      items: [
        { id: 'p', kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150 },
        { id: 'c', kind: 'CHECK', label: 'Valves', help: null },
      ],
    },
  ],
  clientSignature: 'OPTIONAL',
  supervisorSignature: 'NONE',
};

const t = (iso: string) => new Date(iso);
const countAll = (answers: AnswerRecord[]): Counts => ({
  itemCount: 2,
  passed: answers.filter((a) => a.result === 'PASS').length,
  failed: answers.filter((a) => a.result === 'FAIL').length,
  na: answers.filter((a) => a.result === 'NA').length,
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const sig = (role: SignatureRecord['role'], name: string, image: Buffer | null = PNG): SignatureRecord => ({
  role,
  name,
  method: image ? 'DRAWN' : 'TYPED',
  image,
  signedAt: t('2026-10-27T09:30:00Z'),
  capturedById: 'u-insp',
});

export function inspectionStoreContract(name: string, setup: () => Promise<InspectionStoreFixture>) {
  describe(`inspection store contract: ${name}`, () => {
    let f: InspectionStoreFixture;
    let store: InspectionStore;

    beforeEach(async () => {
      f = await setup();
      store = f.store;
    });

    const newForm = (title = 'Rig daily check') => store.createForm({ title, description: 'Before shift', structure, createdById: 'u-maker' });
    const start = async (projectId = f.projectA, taskId: string | null = null, at = t('2026-10-27T08:00:00Z')) => {
      const form = await newForm();
      return store.createInspection({ projectId, formId: form.id, formVersion: form.version, title: form.title, description: form.description, structure, place: 'Rig 3', taskId, inspectorId: 'u-insp', itemCount: 2, at });
    };
    const write = (id: string, itemId: string, editedAt: string, value: Partial<AnswerRecord> = {}, actor = 'u-insp') =>
      store.writeAnswers(id, actor, [{ itemId, result: 'PASS', reading: null, note: null, editedAt: t(editedAt), ...value }], countAll);
    const finish = (id: string, finishId = 'fin-1', check: (a: AnswerRecord[]) => string | null = () => null, actor = 'u-insp') =>
      store.finish(id, actor, { finishId, at: t('2026-10-27T09:31:00Z'), signatures: [sig('INSPECTOR', 'Omar Ahmed'), sig('CLIENT', 'Fatma Al Balushi', null)], check, count: countAll });

    describe('forms', () => {
      it('keeps a form with its checklist, and lists the live ones by title', async () => {
        const b = await newForm('B form');
        const a = await newForm('A form');
        expect(await store.findForm(b.id)).toMatchObject({ title: 'B form', description: 'Before shift', structure, version: 1, createdById: 'u-maker' });
        expect((await store.listForms()).map((x) => x.id)).toEqual([a.id, b.id]);
        expect(await store.deleteForm(a.id)).toBe(true);
        expect(await store.deleteForm(a.id)).toBe(false);
        expect(await store.findForm(a.id)).toBeNull();
        expect((await store.listForms()).map((x) => x.id)).toEqual([b.id]);
      });

      it('saves an edit only from the current version, and moves the version on', async () => {
        const form = await newForm();
        const edited = { title: 'Renamed', description: null, structure: { ...structure, clientSignature: 'REQUIRED' as const } };
        expect(await store.updateForm(form.id, 0, edited)).toBe('stale');
        const saved = await store.updateForm(form.id, 1, edited);
        expect(saved).toMatchObject({ title: 'Renamed', description: null, version: 2, structure: { clientSignature: 'REQUIRED' } });
        expect(await store.updateForm(form.id, 1, edited)).toBe('stale');
        await store.deleteForm(form.id);
        expect(await store.updateForm(form.id, 2, edited)).toBeNull();
      });

      it('keeps the inspections made from a deleted form', async () => {
        const i = await start();
        await store.deleteForm(i.formId!);
        expect(await store.findInspection(i.id)).toMatchObject({ title: 'Rig daily check', structure });
      });
    });

    describe('inspections', () => {
      it('starts in progress with a copy of the checklist, listed under its project and its task, newest first', async () => {
        const task = await f.makeTask(f.projectA);
        const older = await start(f.projectA, task, t('2026-10-26T08:00:00Z'));
        const newer = await start(f.projectA, null, t('2026-10-27T08:00:00Z'));
        await start(f.projectB);
        expect(older).toMatchObject({ projectId: f.projectA, status: 'IN_PROGRESS', inspectorId: 'u-insp', startedById: 'u-insp', place: 'Rig 3', taskId: task, finishedAt: null, clientVisible: false, counts: { itemCount: 2, passed: 0, failed: 0, na: 0 } });
        expect((await store.listForProject(f.projectA)).map((x) => x.id)).toEqual([newer.id, older.id]);
        expect((await store.listForTask(task)).map((x) => x.id)).toEqual([older.id]);
        expect(await store.deleteInspection(newer.id)).toBe(true);
        expect(await store.findInspection(newer.id)).toBeNull();
        expect((await store.listForProject(f.projectA)).map((x) => x.id)).toEqual([older.id]);
      });

      it('keeps the latest edit of each answer, whatever order they arrive in', async () => {
        const i = await start();
        const first = await write(i.id, 'c', '2026-10-27T08:10:00.000Z', { result: 'FAIL', note: 'Leaking' });
        expect(first).toMatchObject({ kind: 'ok', results: [{ itemId: 'c', status: 'applied' }] });
        // An older edit arriving late changes nothing and says what is kept.
        const late = await write(i.id, 'c', '2026-10-27T08:05:00.000Z', { result: 'PASS' });
        expect(late).toMatchObject({ kind: 'ok', results: [{ status: 'stale', answer: { result: 'FAIL', note: 'Leaking' } }] });
        // The same edit sent twice is stored once.
        const again = await write(i.id, 'c', '2026-10-27T08:10:00.000Z', { result: 'FAIL', note: 'Leaking' });
        expect(again).toMatchObject({ kind: 'ok', results: [{ status: 'same' }] });
        // A newer one wins, down to the millisecond.
        expect(await write(i.id, 'c', '2026-10-27T08:10:00.001Z', { result: 'NA', note: null })).toMatchObject({ kind: 'ok', results: [{ status: 'applied' }] });
        const [stored] = await store.answers(i.id);
        expect(stored).toMatchObject({ itemId: 'c', result: 'NA', note: null, answeredById: 'u-insp' });
        expect(stored!.editedAt.toISOString()).toBe('2026-10-27T08:10:00.001Z');
      });

      it('works the counts out again after an answer is stored', async () => {
        const i = await start();
        const r = await store.writeAnswers(
          i.id,
          'u-insp',
          [
            { itemId: 'p', result: 'FAIL', reading: '162.5', note: 'High', editedAt: t('2026-10-27T08:10:00Z') },
            { itemId: 'c', result: 'PASS', reading: null, note: null, editedAt: t('2026-10-27T08:11:00Z') },
          ],
          countAll,
        );
        expect(r.kind === 'ok' && r.inspection.counts).toEqual({ itemCount: 2, passed: 1, failed: 1, na: 0 });
        expect((await store.findInspection(i.id))!.counts).toEqual({ itemCount: 2, passed: 1, failed: 1, na: 0 });
        expect((await store.answers(i.id)).find((a) => a.itemId === 'p')).toMatchObject({ reading: '162.5', note: 'High' });
      });

      it('takes answers only from its inspector, only while in progress, only while it exists', async () => {
        const i = await start();
        expect(await write(i.id, 'c', '2026-10-27T08:10:00Z', {}, 'u-other')).toEqual({ kind: 'not-inspector', inspectorId: 'u-insp' });
        await write(i.id, 'c', '2026-10-27T08:10:00Z');
        await write(i.id, 'p', '2026-10-27T08:10:00Z', { reading: '12' });
        await finish(i.id);
        expect(await write(i.id, 'c', '2026-10-27T09:40:00Z')).toEqual({ kind: 'finished' });
        await store.deleteInspection(i.id);
        expect(await write(i.id, 'c', '2026-10-27T09:41:00Z')).toEqual({ kind: 'gone' });
        expect(await write('no-such-inspection', 'c', '2026-10-27T09:41:00Z')).toEqual({ kind: 'gone' });
      });

      it('finishes with its signatures only when the check passes, and a repeat of that finish changes nothing', async () => {
        const i = await start();
        await write(i.id, 'c', '2026-10-27T08:10:00Z');
        expect(await finish(i.id, 'fin-1', () => 'p is not answered')).toEqual({ kind: 'problem', problem: 'p is not answered' });
        expect((await store.findInspection(i.id))!.status).toBe('IN_PROGRESS');
        expect(await store.signatures(i.id)).toEqual([]);

        // The check sees every stored answer.
        let seen: string[] = [];
        const done = await finish(i.id, 'fin-1', (a) => ((seen = a.map((x) => x.itemId)), null));
        expect(seen).toEqual(['c']);
        expect(done).toMatchObject({ kind: 'ok', inspection: { status: 'FINISHED', finishId: 'fin-1', counts: { itemCount: 2, passed: 1, failed: 0, na: 0 } } });
        expect((await store.findInspection(i.id))!.finishedAt!.toISOString()).toBe('2026-10-27T09:31:00.000Z');
        const signatures = await store.signatures(i.id);
        expect(signatures.map((s) => [s.role, s.name, s.method])).toEqual(
          expect.arrayContaining([
            ['INSPECTOR', 'Omar Ahmed', 'DRAWN'],
            ['CLIENT', 'Fatma Al Balushi', 'TYPED'],
          ]),
        );
        expect(signatures.find((s) => s.role === 'INSPECTOR')!.image!.equals(PNG)).toBe(true);
        expect(signatures.find((s) => s.role === 'CLIENT')!.image).toBeNull();

        expect(await finish(i.id, 'fin-1')).toMatchObject({ kind: 'already' });
        // Another finish (other signatures) can't replace them.
        const other = await store.finish(i.id, 'u-insp', { finishId: 'fin-2', at: t('2026-10-27T10:00:00Z'), signatures: [sig('INSPECTOR', 'Someone Else')], check: () => null, count: countAll });
        expect(other).toMatchObject({ kind: 'finished-other' });
        expect((await store.signatures(i.id)).find((s) => s.role === 'INSPECTOR')!.name).toBe('Omar Ahmed');
      });

      it('lets only its inspector finish it', async () => {
        const i = await start();
        expect(await finish(i.id, 'fin-1', () => null, 'u-other')).toEqual({ kind: 'not-inspector', inspectorId: 'u-insp' });
        await store.deleteInspection(i.id);
        expect(await finish(i.id)).toEqual({ kind: 'gone' });
      });

      it('reopens a finished one without its signatures and off the client page; hands one in progress to a new inspector', async () => {
        const i = await start();
        expect(await store.reopen(i.id)).toBe(false);
        expect(await store.takeOver(i.id, 'u-boss')).toBe(true);
        expect((await store.findInspection(i.id))!.inspectorId).toBe('u-boss');
        expect(await write(i.id, 'c', '2026-10-27T08:10:00Z')).toMatchObject({ kind: 'not-inspector' });
        await write(i.id, 'c', '2026-10-27T08:10:00Z', {}, 'u-boss');
        await finish(i.id, 'fin-1', () => null, 'u-boss');
        expect(await store.takeOver(i.id, 'u-insp')).toBe(false);
        expect(await store.setClientVisible(i.id, true)).toBe(true);

        expect(await store.reopen(i.id)).toBe(true);
        const back = (await store.findInspection(i.id))!;
        expect(back).toMatchObject({ status: 'IN_PROGRESS', finishedAt: null, finishId: null, clientVisible: false, clientVisibleProjectId: null });
        expect(await store.signatures(i.id)).toEqual([]);
        expect((await store.answers(i.id)).map((a) => a.itemId)).toEqual(['c']);
      });

      it('shows only finished inspections to the client, for the project they were marked on', async () => {
        const open = await start();
        expect(await store.setClientVisible(open.id, true)).toBe(false);
        const shown = await start();
        await finish(shown.id);
        const hidden = await start();
        await finish(hidden.id);
        const other = await start(f.projectB);
        await finish(other.id);
        expect(await store.setClientVisible(shown.id, true)).toBe(true);
        expect(await store.setClientVisible(other.id, true)).toBe(true);
        expect((await store.findInspection(shown.id))!.clientVisibleProjectId).toBe(f.projectA);
        expect((await store.clientInspections(f.projectA)).map((x) => x.id)).toEqual([shown.id]);
        expect((await store.clientInspections(f.projectB)).map((x) => x.id)).toEqual([other.id]);

        // Re-filed under another project: shown nowhere until it is marked again.
        await f.moveInspection(other.id, f.projectA);
        expect((await store.clientInspections(f.projectA)).map((x) => x.id)).toEqual([shown.id]);
        expect(await store.clientInspections(f.projectB)).toEqual([]);

        expect(await store.setClientVisible(shown.id, false)).toBe(true);
        expect(await store.clientInspections(f.projectA)).toEqual([]);
        const deleted = await start();
        await finish(deleted.id);
        await store.setClientVisible(deleted.id, true);
        await store.deleteInspection(deleted.id);
        expect(await store.clientInspections(f.projectA)).toEqual([]);
      });
    });

    describe('follow-ups', () => {
      const at = t('2026-10-27T10:00:00Z');
      const stale = t('2026-10-27T09:58:00Z');

      it('makes one follow-up per item: the second claim gets the first one', async () => {
        const i = await start();
        expect(await store.claimFollowUp(i.id, 'p', 'u-a', at, stale)).toEqual({ claimed: true });
        const second = await store.claimFollowUp(i.id, 'p', 'u-b', at, stale);
        expect(second).toMatchObject({ claimed: false, existing: { itemId: 'p', taskId: null, createdById: 'u-a' } });
        const task = await f.makeTask(f.projectA);
        await store.completeFollowUp(i.id, 'p', task);
        expect(await store.claimFollowUp(i.id, 'p', 'u-b', at, stale)).toMatchObject({ claimed: false, existing: { taskId: task } });
        expect(await store.followUps(i.id)).toEqual([expect.objectContaining({ itemId: 'p', taskId: task, createdById: 'u-a' })]);
        expect(await store.followUpOfTask(task)).toMatchObject({ inspection: { id: i.id }, itemId: 'p' });
        // Another item is its own.
        expect(await store.claimFollowUp(i.id, 'c', 'u-b', at, stale)).toEqual({ claimed: true });
      });

      it('gives a claim back when its task couldn’t be made, and takes over one whose task was deleted or never made', async () => {
        const i = await start();
        await store.claimFollowUp(i.id, 'p', 'u-a', at, stale);
        await store.releaseFollowUp(i.id, 'p');
        expect(await store.claimFollowUp(i.id, 'p', 'u-b', at, stale)).toEqual({ claimed: true });

        const task = await f.makeTask(f.projectA);
        await store.completeFollowUp(i.id, 'p', task);
        await f.deleteTask(task);
        expect(await store.claimFollowUp(i.id, 'p', 'u-c', at, stale)).toEqual({ claimed: true });
        expect((await store.followUps(i.id))[0]).toMatchObject({ itemId: 'p', taskId: null, createdById: 'u-c' });

        // A claim that never got its task, older than staleBefore, is taken over; a fresh one isn't.
        await store.claimFollowUp(i.id, 'c', 'u-a', t('2026-10-27T09:50:00Z'), stale);
        expect(await store.claimFollowUp(i.id, 'c', 'u-b', at, stale)).toEqual({ claimed: true });
        expect(await store.claimFollowUp(i.id, 'c', 'u-c', at, stale)).toMatchObject({ claimed: false });
      });
    });
  });
}
