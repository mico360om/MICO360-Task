import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { inspectPdf } from '../../lib/pdf-inspect';
import { as, FORM_BODY, makeFixture, PEOPLE, pngDataUrl, type Fixture } from './inspection-service.fixture';

const tokenService = createTokenService({
  accessSecret: 'insp-access',
  refreshSecret: 'insp-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (userId: string) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id: userId, roles: as(userId).roles })).accessToken}` });
const { owner, inspector, member, outsider } = PEOPLE;

let f: Fixture;
let app: FastifyInstance;
let broadcasts: Array<{ projectId: string; event: string }>;

beforeEach(async () => {
  f = makeFixture();
  broadcasts = [];
  app = await buildApp({
    tokenService,
    authService,
    rateLimitMax: 100_000,
    onTaskEvent: (projectId, event) => void broadcasts.push({ projectId, event }),
    inspections: { service: f.service, timeZone: 'Asia/Muscat', userName: async (id) => (id === owner ? 'Olivia Owner' : null) },
  });
});

const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who: string | null, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: who ? await bearer(who) : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

async function startedByIvan() {
  const form = (await call('POST', '/inspection-forms', owner, FORM_BODY)).json().data;
  const insp = (await call('POST', '/projects/P1/inspections', inspector, { formId: form.id, place: 'Rig 3' })).json().data;
  const ids: string[] = insp.structure.sections.flatMap((s: { items: Array<{ id: string }> }) => s.items.map((i) => i.id));
  f.now.at = new Date('2026-10-27T09:00:00Z');
  return { form, insp, ids };
}

describe('inspection routes', () => {
  it('need a staff sign-in', async () => {
    for (const [method, url] of [
      ['GET', '/inspection-forms'],
      ['POST', '/inspection-forms'],
      ['GET', '/projects/P1/inspections'],
      ['GET', '/inspections/x'],
      ['PUT', '/inspections/x/answers'],
      ['POST', '/inspections/x/finish'],
      ['GET', '/inspections/x/report.pdf'],
      ['GET', '/tasks/t1/inspections'],
      ['PUT', '/inspections/x/client-visibility'],
    ] as const) {
      expect((await call(method, url, null, method === 'GET' ? undefined : {})).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('manage forms: list for all, create for those who run a project, 403 for others', async () => {
    expect((await call('POST', '/inspection-forms', member, FORM_BODY)).statusCode).toBe(403);
    const created = await call('POST', '/inspection-forms', owner, FORM_BODY);
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;
    const list = (await call('GET', '/inspection-forms', member)).json().data;
    expect(list).toMatchObject({ canCreate: false, forms: [{ id, title: 'Rig daily check', canEdit: false }] });
    expect((await call('GET', `/inspection-forms/${id}`, member)).json().data.structure.sections).toHaveLength(2);
    expect((await call('PUT', `/inspection-forms/${id}`, owner, { ...FORM_BODY, title: 'Renamed', expectedVersion: 1 })).json().data).toMatchObject({ title: 'Renamed', version: 2 });
    const bad = await call('POST', '/inspection-forms', owner, { ...FORM_BODY, sections: [] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toBe('Add at least one section.');
    expect((await call('DELETE', `/inspection-forms/${id}`, member)).statusCode).toBe(403);
    expect((await call('DELETE', `/inspection-forms/${id}`, owner)).statusCode).toBe(204);
  });

  it('start, list, answer and read an inspection', async () => {
    const { insp, ids } = await startedByIvan();
    expect(insp).toMatchObject({ status: 'IN_PROGRESS', place: 'Rig 3', permissions: { canAnswer: true } });
    expect((await call('POST', '/projects/P1/inspections', outsider, { formId: insp.formId })).statusCode).toBe(404);
    const list = (await call('GET', '/projects/P1/inspections', member)).json().data;
    expect(list.inspections.map((x: { id: string }) => x.id)).toEqual([insp.id]);

    const answered = await call('PUT', `/inspections/${insp.id}/answers`, inspector, { answers: [{ itemId: ids[0], result: 'PASS', reading: '170', note: null, editedAt: '2026-10-27T08:10:00Z' }] });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().data.results[0]).toMatchObject({ status: 'applied', answer: { result: 'FAIL', reading: '170' } });
    expect(broadcasts).toContainEqual({ projectId: 'P1', event: 'inspection:changed' });
    const notMine = await call('PUT', `/inspections/${insp.id}/answers`, member, { answers: [{ itemId: ids[1], result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:10:00Z' }] });
    expect(notMine.statusCode).toBe(409);
    expect(notMine.json().error).toMatchObject({ code: 'NOT_THE_INSPECTOR', message: 'Ivan Inspector is carrying out this inspection now: only they can answer, sign and finish it.' });
    expect((await call('GET', `/inspections/${insp.id}`, outsider)).statusCode).toBe(404);
    expect((await call('GET', `/inspections/${insp.id}`, member)).json().data.answers).toHaveLength(1);
  });

  it('take a big batch of answers with long Arabic notes (an offline phone sending everything at once)', async () => {
    const form = (
      await call('POST', '/inspection-forms', owner, { ...FORM_BODY, sections: [{ title: 'All', items: Array.from({ length: 300 }, (_, i) => ({ kind: 'CHECK', label: `Item ${i}` })) }] })
    ).json().data;
    const insp = (await call('POST', '/projects/P1/inspections', inspector, { formId: form.id })).json().data;
    f.now.at = new Date('2026-10-27T09:00:00Z');
    const note = 'ملاحظة طويلة جداً عن الصمام '.repeat(80).slice(0, 2000);
    const answers = insp.structure.sections[0].items.map((i: { id: string }, k: number) => ({ itemId: i.id, result: 'FAIL', reading: null, note, editedAt: new Date(Date.UTC(2026, 9, 27, 8, 0, k % 60, k)).toISOString() }));
    const r = await call('PUT', `/inspections/${insp.id}/answers`, inspector, { answers });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.inspection.counts).toMatchObject({ total: 300, answered: 300, failed: 300 });
  });

  it('finish with a drawn signature, replay the same finish, then get the PDF', async () => {
    const { insp, ids } = await startedByIvan();
    await call('PUT', `/inspections/${insp.id}/answers`, inspector, {
      answers: [
        { itemId: ids[0], result: null, reading: '120.5', note: null, editedAt: '2026-10-27T08:10:00Z' },
        { itemId: ids[1], result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:11:00Z' },
        { itemId: ids[2], result: 'FAIL', reading: null, note: 'Loose rail', editedAt: '2026-10-27T08:12:00Z' },
      ],
    });
    const seen = (await call('GET', `/inspections/${insp.id}`, inspector)).json().data.answers.map((a: { itemId: string; editedAt: string }) => ({ itemId: a.itemId, editedAt: a.editedAt }));
    const body = { finishId: 'b8b2c8c0-finish', revision: 0, seen, signatures: [{ role: 'INSPECTOR', name: 'Ivan Inspector', method: 'DRAWN', image: await pngDataUrl(600, 200), signedAt: '2026-10-27T08:30:00Z' }] };
    expect((await call('GET', `/inspections/${insp.id}/report.pdf`, member)).statusCode).toBe(409);
    const done = await call('POST', `/inspections/${insp.id}/finish`, inspector, body);
    expect(done.statusCode).toBe(200);
    expect(done.json().data).toMatchObject({ status: 'FINISHED', result: '1 failed' });
    const again = await call('POST', `/inspections/${insp.id}/finish`, inspector, body);
    expect(again.statusCode).toBe(200);

    const pdf = await call('GET', `/inspections/${insp.id}/report.pdf`, member);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/attachment; filename="inspection-rig-daily-check-2026-10-27\.pdf"/);
    const text = inspectPdf(pdf.rawPayload).pages.flat().join('\n');
    expect(text).toContain('Rig daily check');
    expect(text).toContain('Ivan Inspector');
    expect(text).toContain('Client: Not signed');
    expect((await call('GET', `/inspections/${insp.id}/report.pdf`, outsider)).statusCode).toBe(404);
  });

  it('refuse a finish whose body is too big, rather than storing it', async () => {
    const { insp } = await startedByIvan();
    const huge = `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024)}`;
    const r = await call('POST', `/inspections/${insp.id}/finish`, inspector, { finishId: 'x1', revision: 0, seen: [], signatures: [{ role: 'INSPECTOR', name: 'I', method: 'DRAWN', image: huge, signedAt: '2026-10-27T08:30:00Z' }] });
    expect([400, 413]).toContain(r.statusCode);
  });

  it('make follow-up tasks once, telling open boards', async () => {
    const { insp, ids } = await startedByIvan();
    await call('PUT', `/inspections/${insp.id}/answers`, inspector, { answers: [{ itemId: ids[2], result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:12:00Z' }] });
    const first = await call('POST', `/inspections/${insp.id}/follow-ups`, member, { itemIds: [ids[2]] });
    expect(first.statusCode).toBe(200);
    expect(first.json().data[0]).toMatchObject({ status: 'created', task: { title: 'Follow up: Guard rails fitted' } });
    const second = await call('POST', `/inspections/${insp.id}/follow-ups`, member, { itemIds: [ids[2]] });
    expect(second.json().data[0]).toMatchObject({ status: 'exists' });
    expect(f.tasks.size).toBe(1);
    const panel = await call('GET', `/tasks/${first.json().data[0].task.id}/inspections`, member);
    expect(panel.json().data.followUpOf).toMatchObject({ item: 'Guard rails fitted', inspection: { id: insp.id } });
  });

  it('show a finished inspection to the client: preview, then the switch, for those who run the project', async () => {
    const { insp, ids } = await startedByIvan();
    await call('PUT', `/inspections/${insp.id}/answers`, inspector, {
      answers: ids.map((itemId, k) => ({ itemId, result: k === 0 ? 'NA' : 'PASS', reading: null, note: null, editedAt: new Date(Date.UTC(2026, 9, 27, 8, 10, k)).toISOString() })),
    });
    expect((await call('GET', `/inspections/${insp.id}/client-visibility/preview`, owner)).statusCode).toBe(409);
    const seen = (await call('GET', `/inspections/${insp.id}`, inspector)).json().data.answers.map((a: { itemId: string; editedAt: string }) => ({ itemId: a.itemId, editedAt: a.editedAt }));
    await call('POST', `/inspections/${insp.id}/finish`, inspector, { finishId: 'fin-x', revision: 0, seen, signatures: [{ role: 'INSPECTOR', name: 'Ivan Inspector', method: 'TYPED', signedAt: '2026-10-27T08:30:00Z' }] });
    expect((await call('GET', `/inspections/${insp.id}/client-visibility/preview`, member)).statusCode).toBe(403);
    const preview = (await call('GET', `/inspections/${insp.id}/client-visibility/preview`, owner)).json().data;
    expect(preview.inspection).toMatchObject({ title: 'Rig daily check', result: 'Passed', signatures: [{ role: 'Inspector', name: 'Ivan Inspector', typed: true }] });
    expect((await call('PUT', `/inspections/${insp.id}/client-visibility`, member, { visible: true })).statusCode).toBe(403);
    const on = await call('PUT', `/inspections/${insp.id}/client-visibility`, owner, { visible: true });
    expect(on.json().data).toEqual({ clientVisible: true });
    expect((await call('PUT', `/inspections/${insp.id}/client-visibility`, owner, { visible: 'yes' })).statusCode).toBe(400);
  });

  it('reopen, take over and delete answer with the right codes', async () => {
    const { insp } = await startedByIvan();
    expect((await call('POST', `/inspections/${insp.id}/reopen`, owner)).statusCode).toBe(409);
    expect((await call('POST', `/inspections/${insp.id}/take-over`, member)).statusCode).toBe(403);
    expect((await call('POST', `/inspections/${insp.id}/take-over`, owner)).json().data.inspector.id).toBe(owner);
    expect((await call('DELETE', `/inspections/${insp.id}`, inspector)).statusCode).toBe(403);
    expect((await call('DELETE', `/inspections/${insp.id}`, owner)).statusCode).toBe(204);
    const gone = await call('GET', `/inspections/${insp.id}`, owner);
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe('INSPECTION_GONE');
  });

  it('limit report PDFs per person, not per office (everyone behind one address)', async () => {
    const limited = await buildApp({ tokenService, authService, rateLimitMax: 100_000, inspections: { service: f.service, timeZone: 'Asia/Muscat', pdfsPerMinute: 2 } });
    const pdf = async (who: string) => limited.inject({ method: 'GET', url: '/api/v1/inspections/nope/report.pdf', headers: await bearer(who) });
    expect((await pdf(member)).statusCode).toBe(404);
    expect((await pdf(member)).statusCode).toBe(404);
    const third = await pdf(member);
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('RATE_LIMITED');
    expect((await pdf(owner)).statusCode).toBe(404);
  });

  it('check the sign-in before reading a big body (an unsigned-in request’s 5 MB is never parsed)', async () => {
    const huge = JSON.stringify({ answers: [{ note: 'x'.repeat(5 * 1024 * 1024) }] });
    for (const url of ['/api/v1/inspections/x/answers', '/api/v1/inspections/x/finish']) {
      const r = await app.inject({ method: url.endsWith('answers') ? 'PUT' : 'POST', url, headers: { 'content-type': 'application/json' }, payload: huge });
      expect(r.statusCode, url).toBe(401);
    }
  });
});

describe('scheduled inspection routes', () => {
  const checkRow = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    key: `RIG-${id}`,
    version: 1,
    title: 'Daily rig check – Rig 3',
    projectId: 'P1',
    dueDate: new Date('2026-10-26T00:00:00.000Z'),
    startDate: null,
    completedAt: null,
    columnCategory: 'TODO',
    recurrenceRule: null,
    recurrenceParentId: null,
    inspectionPlace: 'Rig 3',
    form: { id: 'f1', title: 'Rig daily check', deleted: false },
    assignees: [{ id: inspector, name: 'Ivan Inspector' }],
    ...over,
  });
  async function withSchedules() {
    const { createInspectionScheduleService } = await import('./inspection-schedules');
    const rows = [checkRow('1'), checkRow('2', { recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' } })];
    const schedules = createInspectionScheduleService({
      source: {
        checks: async (_p, o) => rows.filter((r) => (!o.schedulesOnly || r.recurrenceRule) && (!o.seriesIds || o.seriesIds.includes(r.id))) as never,
        seriesSizes: async (ids) => new Map(ids.map((id) => [id, 1])),
        inProgress: async () => [],
        formUsage: async (id) => (id === 'f1' ? { schedules: 1, openChecks: 2 } : null),
        workingDays: async () => [0, 1, 2, 3, 4],
      },
      canViewProject: async (userId, _r, projectId) => projectId === 'P1' && userId !== outsider,
      userNames: async () => new Map(),
      timeZone: 'Asia/Muscat',
      now: () => new Date('2026-10-28T06:00:00Z'),
    });
    app = await buildApp({ tokenService, authService, rateLimitMax: 100_000, inspections: { service: f.service, schedules, timeZone: 'Asia/Muscat' } });
  }

  it('need a staff sign-in', async () => {
    await withSchedules();
    for (const url of ['/projects/P1/inspection-schedules', '/projects/P1/inspection-checks?state=open', '/inspection-forms/f1/usage']) expect((await call('GET', url, null)).statusCode, url).toBe(401);
  });

  it('give the team the project’s schedules and due checks; anyone else hears "not found"', async () => {
    await withSchedules();
    const s = await call('GET', '/projects/P1/inspection-schedules', member);
    expect(s.statusCode).toBe(200);
    expect(s.json().data).toMatchObject({ workingDays: [0, 1, 2, 3, 4], schedules: [{ taskId: '2', repeat: 'Repeats every day' }] });
    const c = await call('GET', '/projects/P1/inspection-checks?state=open', member);
    expect(c.json().data).toMatchObject({ total: 2, checks: [{ taskId: '1', state: 'LATE', daysLate: 2 }, { taskId: '2' }] });
    expect((await call('GET', '/projects/P1/inspection-checks', member)).statusCode).toBe(200);
    expect((await call('GET', '/projects/P1/inspection-checks?state=done', member)).statusCode).toBe(400);
    expect((await call('GET', '/projects/P1/inspection-schedules', outsider)).statusCode).toBe(404);
    expect((await call('GET', '/projects/P1/inspection-checks?state=open', outsider)).statusCode).toBe(404);
  });

  it('say how much a form is used, for the delete confirm', async () => {
    await withSchedules();
    expect((await call('GET', '/inspection-forms/f1/usage', member)).json().data).toEqual({ schedules: 1, openChecks: 2 });
    expect((await call('GET', '/inspection-forms/nope/usage', member)).statusCode).toBe(404);
  });
});
