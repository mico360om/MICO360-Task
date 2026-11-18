import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { testPrisma } from './test-prisma';
import { createAppreciationService, type ScheduleInput } from '../../src/modules/appreciations/appreciation-service';
import { HttpError } from '../../src/lib/http-errors';

// Requires a running MySQL / MariaDB (TEST_DATABASE_URL) with migrations applied.
// Employee Appreciation (1.24.0): permissions and company scope, the company-time-zone day at its edges (23:59,
// 00:00, another zone), activation and expiry, a double accept, an accept after expiry, cancel and edit before
// start only, several on one day, the templates (built-ins protected, duplicate, archive) and the placeholders.
const prisma = testPrisma();
const TZ = 'Asia/Muscat'; // UTC+4: Nov 18 runs 2026-11-17T20:00Z → 2026-11-18T20:00Z

let w: CompanyWorld;
let clock = new Date('2026-11-18T19:59:00.000Z'); // 23:59 on 18 Nov, company time
const notices: Array<{ userId: string; title: string; entityId: string | null }> = [];
const audits: Array<{ action: string; entityId: string | null; userId: string | null }> = [];
// 1.24.1: everything a notice / audit entry carried (the note checks read these).
const fullNotices: Array<{ userId: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null }> = [];
const fullAudits: Array<{ action: string; entityId: string | null; newValue?: unknown }> = [];
const svc = (timeZone = TZ) =>
  createAppreciationService({
    prisma,
    timeZone,
    now: () => clock,
    notify: async (n) => {
      fullNotices.push({ userId: n.userId, type: n.type, title: n.title, body: n.body, entityType: n.entityType, entityId: n.entityId });
      return notices.push({ userId: n.userId, title: n.title, entityId: n.entityId });
    },
    audit: async (e) => {
      fullAudits.push({ action: e.action, entityId: e.entityId, newValue: e.newValue });
      audits.push({ action: e.action, entityId: e.entityId, userId: e.userId });
    },
    brand: async (companyId) => ({ name: companyId ? (await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).name : 'MICO360', logoUrl: null }),
  });
const s = svc();

const send = (by: string, recipientIds: string[], day: string, over: Partial<ScheduleInput> = {}) =>
  s.schedule(by, { recipientIds, day, title: 'Great Teamwork', message: 'Thank you {name} of {company} for {date}', theme: 'ocean', icon: 'team', animation: 'shimmer', ...over });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof HttpError ? `${e.status}${e.code && !['CONFLICT', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND'].includes(e.code) ? ` ${e.code}` : ''}` : String(e);
  }
};

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  // amy: Appreciation manager (company A only); bob: an administrator? no — bob stays an employee.
  await prisma.user.update({ where: { id: w.people.amy }, data: { appreciationManager: true } });
  await s.ensureBuiltIns();
});
afterAll(async () => {
  const ids = Object.values(w.people);
  await prisma.appreciation.deleteMany({ where: { OR: [{ recipientId: { in: ids } }, { senderId: { in: ids } }] } });
  await prisma.appreciationTemplate.deleteMany({ where: { createdById: { in: ids } } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});
beforeEach(() => {
  clock = new Date('2026-11-18T19:59:00.000Z');
  notices.length = 0;
  audits.length = 0;
  fullNotices.length = 0;
  fullAudits.length = 0;
});

describe('who manages, and for whom', () => {
  it('administrators and Appreciation managers manage; an employee, or an admin in Manager View without the switch, gets 403', async () => {
    expect(await code(s.templates(w.people.admin))).toBe('OK');
    expect(await code(s.templates(w.people.amy))).toBe('OK');
    expect(await code(s.templates(w.people.ana))).toBe('403');
    expect(await code(s.list(w.people.ben))).toBe('403');
    await prisma.user.update({ where: { id: w.people.admin }, data: { managerView: true } });
    expect(await code(s.list(w.people.admin))).toBe('403');
    await prisma.user.update({ where: { id: w.people.admin }, data: { managerView: false } });
    expect((await s.me(w.people.amy)).canManage).toBe(true);
    expect((await s.me(w.people.ana)).canManage).toBe(false);
  });

  it('a manager picks only active staff of their own companies; an administrator anyone active', async () => {
    const amyPeople = (await s.people(w.people.amy)).map((p) => p.id);
    expect(amyPeople).toEqual(expect.arrayContaining([w.people.ana, w.people.cat]));
    expect(amyPeople).not.toContain(w.people.ben);
    expect(amyPeople).not.toContain(w.people.bob);
    expect(await s.people(w.people.amy, { companyId: w.companies.B })).toEqual([]);
    expect((await s.companies(w.people.amy)).map((c) => c.id)).toEqual([w.companies.A]);
    expect((await s.people(w.people.admin, { search: 'Betaonly' })).map((p) => p.id)).toEqual([w.people.bob]);
    // Someone outside the manager's companies is refused (nothing is made for anyone).
    expect(await code(send(w.people.amy, [w.people.ana, w.people.ben], '2026-11-20'))).toBe('400');
    expect(await prisma.appreciation.count({ where: { recipientId: w.people.ana, day: '2026-11-20' } })).toBe(0);
    // An inactive account can't be picked.
    await prisma.user.update({ where: { id: w.people.bob }, data: { status: 'INACTIVE' } });
    expect(await code(send(w.people.admin, [w.people.bob], '2026-11-20'))).toBe('400');
    await prisma.user.update({ where: { id: w.people.bob }, data: { status: 'ACTIVE' } });
  });

  it('records the company it was sent within: the primary one when in scope, else the shared one', async () => {
    const { ids } = await send(w.people.amy, [w.people.cat], '2026-11-25');
    const r = await prisma.appreciation.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(r.companyId).toBe(w.companies.A); // cat's primary is B, which amy doesn't manage
    const admin = await send(w.people.admin, [w.people.cat], '2026-11-25');
    expect((await prisma.appreciation.findUniqueOrThrow({ where: { id: admin.ids[0]! } })).companyId).toBe(w.companies.B);
    // amy's history: her company's records only (the admin's for cat in B is not hers to see).
    const hist = await s.list(w.people.amy, { personId: w.people.cat });
    expect(hist.rows.map((x) => x.id)).toEqual(ids);
    expect(await code(s.cancel(w.people.amy, admin.ids[0]!))).toBe('404');
  });
});

describe('scheduling in company time and the day’s edges', () => {
  it('today (23:59 company time) is active at once with its bell notice; yesterday is refused', async () => {
    expect(await code(send(w.people.admin, [w.people.ana], '2026-11-17'))).toBe('400');
    const { ids } = await send(w.people.admin, [w.people.ana], '2026-11-18');
    expect(notices).toEqual([{ userId: w.people.ana, title: "You've been appreciated: Great Teamwork", entityId: ids[0] }]);
    expect(audits.map((a) => a.action)).toEqual(['APPRECIATION_CREATED', 'APPRECIATION_ACTIVATED']);
    const me = await s.me(w.people.ana);
    expect(me.today).toBe('2026-11-18');
    const mine = me.live.find((v) => v.id === ids[0])!;
    expect(mine.status).toBe('ACTIVE');
    expect(mine.message).toMatch(/^Thank you Ana Alpha \w+ of Alpha \w+ for 18 Nov 2026$/);
    // 00:00 next day: gone from the Dashboard, expired, can't be accepted.
    clock = new Date('2026-11-18T20:00:00.000Z');
    expect((await s.me(w.people.ana)).live.map((v) => v.id)).not.toContain(ids[0]);
    expect(await code(s.accept(w.people.ana, ids[0]!))).toBe('409 APPRECIATION_EXPIRED');
    const swept = await s.sweep();
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect(audits.filter((a) => a.action === 'APPRECIATION_EXPIRED').map((a) => a.entityId)).toContain(ids[0]);
    expect((await s.list(w.people.admin, { personId: w.people.ana, status: 'EXPIRED' })).rows.map((r) => r.id)).toContain(ids[0]);
    await s.sweep();
    expect(audits.filter((a) => a.action === 'APPRECIATION_EXPIRED' && a.entityId === ids[0])).toHaveLength(1);
  });

  it('a later day waits (Scheduled, no notice) and starts at 00:00 company time through the sweep, once', async () => {
    const { ids } = await send(w.people.admin, [w.people.amy], '2026-11-19');
    expect(notices).toEqual([]);
    expect((await s.me(w.people.amy)).live).toEqual([]);
    expect((await s.list(w.people.admin, { personId: w.people.amy, status: 'SCHEDULED' })).rows.map((r) => r.id)).toEqual(ids);
    clock = new Date('2026-11-18T20:00:00.000Z'); // 00:00 on the 19th
    expect((await s.me(w.people.amy)).live.map((v) => v.id)).toEqual(ids); // live before the sweep (status is the clock's)
    await Promise.all([s.sweep(), s.sweep()]); // two instances at once: one notice
    expect(notices.filter((n) => n.entityId === ids[0])).toHaveLength(1);
    clock = new Date('2026-11-19T19:59:59.000Z'); // 23:59:59 the 19th
    expect((await s.accept(w.people.amy, ids[0]!)).already).toBe(false);
  });

  it('another time zone moves the day (New York)', async () => {
    const ny = svc('America/New_York');
    clock = new Date('2026-11-19T04:30:00.000Z'); // 23:30 on 18 Nov in New York, 08:30 on the 19th in Muscat
    const { ids } = await ny.schedule(w.people.admin, { recipientIds: [w.people.ben], day: '2026-11-18', title: 'T', message: 'M', theme: 'ruby', icon: 'star', animation: 'none' });
    const r = await prisma.appreciation.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(r.startsAt.toISOString()).toBe('2026-11-18T05:00:00.000Z');
    expect(r.endsAt.toISOString()).toBe('2026-11-19T05:00:00.000Z');
    expect((await ny.me(w.people.ben)).live.map((v) => v.id)).toContain(ids[0]);
    // The same instant in Muscat is already the 19th: the 18th is in the past there.
    expect(await code(s.schedule(w.people.admin, { recipientIds: [w.people.ben], day: '2026-11-18', title: 'T', message: 'M', theme: 'ruby', icon: 'star', animation: 'none' }))).toBe('400');
  });
});

describe('accept, popup, several on one day', () => {
  it('a double accept (two devices at once) records one time and one audit entry', async () => {
    clock = new Date('2026-11-21T06:00:00.000Z');
    const { ids } = await send(w.people.admin, [w.people.ben], '2026-11-21');
    const [a, b] = await Promise.all([s.accept(w.people.ben, ids[0]!), s.accept(w.people.ben, ids[0]!)]);
    expect([a.already, b.already].sort()).toEqual([false, true]);
    expect(a.acceptedAt).toBe(b.acceptedAt);
    expect(audits.filter((x) => x.action === 'APPRECIATION_ACCEPTED')).toHaveLength(1);
    // Still on the Dashboard all day, as Accepted; never someone else's to accept.
    expect((await s.me(w.people.ben)).live.find((v) => v.id === ids[0])!.status).toBe('ACCEPTED');
    expect(await code(s.accept(w.people.bob, ids[0]!))).toBe('404');
    // Accepted is kept after the day ends (never Expired).
    clock = new Date('2026-11-23T06:00:00.000Z');
    await s.sweep();
    expect((await s.list(w.people.admin, { personId: w.people.ben, status: 'ACCEPTED' })).rows.map((r) => r.id)).toContain(ids[0]);
  });

  it('closing the popup is stored once (any device sees it closed); not before its day', async () => {
    clock = new Date('2026-11-22T06:00:00.000Z');
    const { ids } = await send(w.people.admin, [w.people.bob], '2026-11-22');
    const first = await s.closePopup(w.people.bob, ids[0]!);
    clock = new Date('2026-11-22T07:00:00.000Z');
    expect((await s.closePopup(w.people.bob, ids[0]!)).popupClosedAt).toBe(first.popupClosedAt);
    expect((await s.me(w.people.bob)).live.find((v) => v.id === ids[0])!.popupClosedAt).toBe(first.popupClosedAt);
    const later = await send(w.people.admin, [w.people.bob], '2026-11-30');
    expect(await code(s.accept(w.people.bob, later.ids[0]!))).toBe('409');
  });

  it('several on one day: all live, newest first; My appreciations lists started ones only', async () => {
    clock = new Date('2026-11-24T06:00:00.000Z');
    const one = await send(w.people.admin, [w.people.gus], '2026-11-24', { title: 'First' }); // gus: archived company only → the site's
    clock = new Date('2026-11-24T06:00:01.000Z');
    const two = await send(w.people.admin, [w.people.gus], '2026-11-24', { title: 'Second' });
    await send(w.people.admin, [w.people.gus], '2026-12-01', { title: 'Later' });
    expect((await s.me(w.people.gus)).live.map((v) => v.title)).toEqual(['Second', 'First']);
    expect((await s.mine(w.people.gus)).map((v) => v.id).sort()).toEqual([one.ids[0], two.ids[0]].sort());
    expect((await s.me(w.people.gus)).live[0]!.company.name).toBe('MICO360');
  });
});

describe('edit and cancel before the start only', () => {
  it('edit moves the day and changes the words; cancel hides it; both refused once it has started', async () => {
    clock = new Date('2026-11-18T10:00:00.000Z');
    const { ids } = await send(w.people.amy, [w.people.ana], '2026-11-26');
    const id = ids[0]!;
    const edited = await s.update(w.people.amy, id, { day: '2026-11-27', title: 'Excellent Work' });
    expect(edited.day).toBe('2026-11-27');
    expect(edited.startsAt).toBe('2026-11-26T20:00:00.000Z');
    expect(audits.map((a) => a.action)).toContain('APPRECIATION_EDITED');
    expect(await code(s.update(w.people.amy, id, { day: '2026-11-01' }))).toBe('400');
    // Started: no edit, no cancel.
    clock = new Date('2026-11-27T01:00:00.000Z');
    expect(await code(s.update(w.people.amy, id, { title: 'x' }))).toBe('409');
    expect(await code(s.cancel(w.people.amy, id))).toBe('409');
    // A future one: cancel, then a second cancel and any edit are refused; it never shows.
    clock = new Date('2026-11-18T10:00:00.000Z');
    const f = (await send(w.people.amy, [w.people.ana], '2026-11-28')).ids[0]!;
    expect((await s.cancel(w.people.amy, f)).status).toBe('CANCELLED');
    expect(await code(s.cancel(w.people.amy, f))).toBe('409');
    expect(await code(s.update(w.people.amy, f, { title: 'x' }))).toBe('409');
    clock = new Date('2026-11-28T06:00:00.000Z');
    expect((await s.me(w.people.ana)).live.map((v) => v.id)).not.toContain(f);
    expect(await code(s.accept(w.people.ana, f))).toBe('409');
    await s.sweep();
    expect(notices.map((n) => n.entityId)).not.toContain(f);
    expect((await s.list(w.people.amy, { status: 'CANCELLED' })).rows.map((r) => r.id)).toContain(f);
    expect(await code(s.cancel(w.people.ana, f))).toBe('403');
  });
});

describe('review fixes', () => {
  it('someone made inactive after scheduling gets no notice on the day; the people list puts the record’s company first', async () => {
    clock = new Date('2026-11-18T10:00:00.000Z');
    const { ids } = await send(w.people.admin, [w.people.bob], '2026-11-29');
    await prisma.user.update({ where: { id: w.people.bob }, data: { status: 'INACTIVE' } });
    clock = new Date('2026-11-29T06:00:00.000Z');
    await s.sweep();
    expect(notices.map((n) => n.entityId)).not.toContain(ids[0]);
    await prisma.user.update({ where: { id: w.people.bob }, data: { status: 'ACTIVE' } });
    const cat = (await s.people(w.people.admin, { search: 'Both' })).find((p) => p.id === w.people.cat)!;
    expect(cat.companies[0]!.id).toBe(w.companies.B); // cat's primary
    expect(s.today()).toBe('2026-11-29');
  });
});

describe('templates', () => {
  it('six built-ins once; built-ins are protected; a copy can be changed and archived', async () => {
    expect(await s.ensureBuiltIns()).toBe(0); // already there
    const list = await s.templates(w.people.amy);
    const builtIns = list.filter((t) => t.builtIn);
    expect(builtIns.map((t) => t.name)).toEqual(['Outstanding Performance', 'Great Teamwork', 'Excellent Work', 'Innovation', 'Dedication', 'Employee of the Day']);
    const teamwork = builtIns[1]!;
    expect(await code(s.updateTemplate(w.people.amy, teamwork.id, { title: 'Changed' }))).toBe('409 BUILT_IN_TEMPLATE');
    expect(await code(s.archiveTemplate(w.people.amy, teamwork.id, true))).toBe('409 BUILT_IN_TEMPLATE');
    const copy = await s.duplicateTemplate(w.people.amy, teamwork.id);
    expect(copy).toMatchObject({ name: 'Great Teamwork (copy)', builtIn: false, theme: 'ocean' });
    expect((await s.updateTemplate(w.people.amy, copy.id, { title: 'Team Spirit', theme: 'emerald' })).title).toBe('Team Spirit');
    await s.archiveTemplate(w.people.amy, copy.id, true);
    expect((await s.templates(w.people.amy)).map((t) => t.id)).not.toContain(copy.id);
    expect((await s.templates(w.people.amy, { archived: true })).find((t) => t.id === copy.id)!.archived).toBe(true);
    expect(audits.filter((a) => a.action === 'APPRECIATION_TEMPLATE_SAVED').length).toBeGreaterThanOrEqual(3);
    expect(await code(s.createTemplate(w.people.ana, { name: 'n', title: 't', message: 'm', theme: 'ruby', icon: 'star', animation: 'none' }))).toBe('403');
  });
});

describe('a note for the manager with the accept (1.24.1)', () => {
  it('accept with a note: saved trimmed, the sender’s bell notice quotes it, the audit says a note was left (not its text)', async () => {
    clock = new Date('2026-12-02T06:00:00.000Z');
    const { ids } = await send(w.people.amy, [w.people.ana], '2026-12-02');
    fullNotices.length = 0;
    const NOTE = 'Thank you, Amy!\nIt means a lot.';
    const r = await s.accept(w.people.ana, ids[0]!, `  ${NOTE}  `);
    expect(r).toMatchObject({ already: false, noteSaved: true });
    expect((await prisma.appreciation.findUniqueOrThrow({ where: { id: ids[0]! } })).acceptNote).toBe(NOTE);
    const n = fullNotices.filter((x) => x.userId === w.people.amy);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ type: 'APPRECIATION', entityType: 'appreciation-note', entityId: ids[0] });
    expect(n[0]!.title).toMatch(/^Ana Alpha \w+ accepted your appreciation: “Thank you, Amy! It means a lot\.”$/);
    const entry = fullAudits.find((a) => a.action === 'APPRECIATION_ACCEPTED' && a.entityId === ids[0])!;
    expect(entry.newValue).toMatchObject({ noteLeft: true });
    expect(JSON.stringify(entry.newValue)).not.toContain('means a lot');
    // The employee sees their own note; the sender and an administrator see it in the history (and the export rows).
    expect((await s.mine(w.people.ana)).find((v) => v.id === ids[0])!.acceptNote).toBe(NOTE);
    expect((await s.list(w.people.amy, { id: ids[0] })).rows.map((x) => [x.id, x.acceptNote])).toEqual([[ids[0], NOTE]]);
    expect((await s.list(w.people.admin, { id: ids[0] })).rows[0]!.acceptNote).toBe(NOTE);
    expect((await s.exportRows(w.people.admin, { personId: w.people.ana })).find((x) => x.id === ids[0])!.acceptNote).toBe(NOTE);
  });

  it('no note (or only spaces): nothing for the sender, the audit says no note; a long note is cut to 80 characters in the notice', async () => {
    clock = new Date('2026-12-03T06:00:00.000Z');
    const { ids } = await send(w.people.admin, [w.people.ana, w.people.cat], '2026-12-03');
    fullNotices.length = 0;
    await s.accept(w.people.ana, ids[0]!, '   ');
    expect(fullNotices.filter((x) => x.userId === w.people.admin)).toEqual([]);
    expect((await prisma.appreciation.findUniqueOrThrow({ where: { id: ids[0]! } })).acceptNote).toBeNull();
    expect(fullAudits.find((a) => a.action === 'APPRECIATION_ACCEPTED' && a.entityId === ids[0])!.newValue).toMatchObject({ noteLeft: false });
    const long = 'a'.repeat(75) + ' bcdefghij klm';
    await s.accept(w.people.cat, ids[1]!, long);
    const t = fullNotices.find((x) => x.userId === w.people.admin)!.title;
    expect(t).toMatch(/accepted your appreciation: “a{75} bcde…”$/);
    // Over 500 characters is refused (nothing saved, not accepted).
    const third = (await send(w.people.admin, [w.people.bob], '2026-12-03')).ids[0]!;
    expect(await code(s.accept(w.people.bob, third, 'x'.repeat(501)))).toBe('400');
    expect((await prisma.appreciation.findUniqueOrThrow({ where: { id: third } })).acceptedAt).toBeNull();
  });

  it('the note can’t be changed after accepting, nor left after the day ends', async () => {
    clock = new Date('2026-12-04T06:00:00.000Z');
    const { ids } = await send(w.people.admin, [w.people.ben, w.people.bob], '2026-12-04');
    await s.accept(w.people.ben, ids[0]!, 'First words');
    fullNotices.length = 0;
    const again = await s.accept(w.people.ben, ids[0]!, 'Changed words');
    expect(again).toMatchObject({ already: true, noteSaved: false });
    expect((await prisma.appreciation.findUniqueOrThrow({ where: { id: ids[0]! } })).acceptNote).toBe('First words');
    expect(fullNotices).toEqual([]);
    // An offline replay of the same accept and note: harmless, still the first.
    expect((await s.accept(w.people.ben, ids[0]!, 'First words')).already).toBe(true);
    // After midnight: refused like the accept, nothing saved.
    clock = new Date('2026-12-04T20:00:00.000Z');
    expect(await code(s.accept(w.people.bob, ids[1]!, 'Late thanks'))).toBe('409 APPRECIATION_EXPIRED');
    expect((await prisma.appreciation.findUniqueOrThrow({ where: { id: ids[1]! } })).acceptNote).toBeNull();
  });

  it('who reads it: the sender and managers in scope; a manager of another company, an employee and someone else’s own list never', async () => {
    clock = new Date('2026-12-05T06:00:00.000Z');
    const forBob = (await send(w.people.admin, [w.people.bob], '2026-12-05')).ids[0]!; // company B
    await s.accept(w.people.bob, forBob, 'Thanks from Beta');
    expect((await s.list(w.people.admin, { id: forBob })).rows[0]!.acceptNote).toBe('Thanks from Beta');
    expect((await s.list(w.people.amy, { id: forBob })).rows).toEqual([]); // amy manages company A only
    expect((await s.exportRows(w.people.amy, {})).map((x) => x.id)).not.toContain(forBob);
    expect(await code(s.list(w.people.ben, { id: forBob }))).toBe('403');
    expect(await code(s.exportRows(w.people.ana, {}))).toBe('403');
    expect((await s.mine(w.people.ben)).map((v) => v.id)).not.toContain(forBob);
    expect((await s.me(w.people.ben)).live.map((v) => v.id)).not.toContain(forBob);
  });
});
