import { describe, it, expect } from 'vitest';
import { portalCard, portalComments, portalMeetingView, portalProject, portalTaskView, type PortalCommentSource, type PortalMeetingSource, type PortalTaskSource } from './portal-payload';
import type { GrantRow } from './client-grants';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-30T08:00:00Z');
const grant = (over: Partial<GrantRow> = {}): GrantRow => ({ projectId: 'p1', progress: true, meetings: false, canComment: false, canSignOff: false, canRespond: false, canDownload: false, ...over });
const project = {
  id: 'p1', code: 'RIG', number: 'C-77', name: 'Rig upgrade', clientName: 'Acme', status: 'ACTIVE', color: '#8B1E1E', icon: null, imageUrl: null,
  startDate: new Date('2026-10-01T08:00:00Z'), targetDate: new Date('2026-12-01T08:00:00Z'),
  company: { name: 'Prolens Projects LLC', logoUrl: '/uploads/logo.png' },
  // Anything else a row may carry never reaches the answer.
  notes: 'INTERNAL NOTE', managerId: 'u-omar',
} as unknown as Parameters<typeof portalCard>[0];
const task = (over: Partial<PortalTaskSource> & Record<string, unknown> = {}): PortalTaskSource =>
  ({
    id: 't1', key: 'RIG-4', title: 'Install pump', description: 'Secret internal description', isMilestone: false, clientVisible: true, clientShowDescription: false,
    columnCategory: 'IN_PROGRESS', completedAt: null, dueDate: new Date('2026-10-29T08:00:00Z'), approvalRequestedAt: null, clientAcceptedAt: null,
    assignees: [{ name: 'Omar Staff' }], columnName: 'Doing (internal)',
    ...over,
  }) as PortalTaskSource;

describe('Client portal answers (allow-list)', () => {
  it('a project card: its look, its company, the progress only with the Progress module', () => {
    const card = portalCard(project, grant(), { total: 4, done: 1 });
    expect(card).toEqual({
      id: 'p1', code: 'RIG', number: 'C-77', name: 'Rig upgrade', status: 'ACTIVE', statusLabel: 'In progress', color: '#8B1E1E', icon: null, imageUrl: null,
      company: { name: 'Prolens Projects LLC', logoUrl: '/uploads/logo.png' }, percentDone: 25,
      modules: { progress: true, meetings: false }, actions: { comment: false, signOff: false, respond: false, download: false },
    });
    expect(portalCard(project, grant({ progress: false, meetings: true }), { total: 4, done: 1 }).percentDone).toBeNull();
    expect(JSON.stringify(card)).not.toMatch(/INTERNAL|u-omar/);
  });

  it('the project page lists only shared tasks, with no people, column names or descriptions', () => {
    const view = portalProject({
      project, grant: grant(), counts: { total: 3, done: 1 }, timeZone: TZ, now: NOW,
      tasks: [task(), task({ id: 't2', key: 'RIG-5', title: 'Hidden', clientVisible: false }), task({ id: 't3', key: 'RIG-6', title: 'Kick-off', isMilestone: true })],
    });
    expect(view.progress!.tasks.map((t) => t.key)).toEqual(['RIG-4']);
    expect(view.progress!.milestones.map((t) => t.key)).toEqual(['RIG-6']);
    expect(view.progress!.tasks[0]).toEqual({ id: 't1', key: 'RIG-4', title: 'Install pump', status: 'In progress', dueDate: '2026-10-29', late: true, acceptedOn: null, awaitingSignOff: false, hasDescription: false });
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/Hidden|Secret|Omar|Doing \(internal\)|INTERNAL/);
  });

  it('without the Progress module there is no progress, no milestones and no tasks', () => {
    const view = portalProject({ project, grant: grant({ progress: false, meetings: true }), counts: { total: 3, done: 1 }, tasks: [task()], timeZone: TZ, now: NOW });
    expect(view.progress).toBeNull();
    expect(JSON.stringify(view)).not.toContain('Install pump');
  });

  it('a done task waits for sign-off until accepted; waiting for approval shows as in progress', () => {
    const done = task({ columnCategory: 'DONE', completedAt: new Date('2026-10-29T10:00:00Z') });
    const view = portalTaskView(done, grant({ canSignOff: true }), null, 'c1', TZ, NOW);
    expect(view.task).toMatchObject({ status: 'Done', awaitingSignOff: true, acceptedOn: null });
    expect(view.can.signOff).toBe(true);
    const accepted = portalTaskView({ ...done, clientAcceptedAt: new Date('2026-10-29T12:00:00Z') }, grant({ canSignOff: true }), null, 'c1', TZ, NOW);
    expect(accepted.task).toMatchObject({ acceptedOn: '2026-10-29', awaitingSignOff: false });
    expect(accepted.can.signOff).toBe(false);
    const waiting = portalTaskView(task({ columnCategory: 'REVIEW', approvalRequestedAt: NOW }), grant({ canSignOff: true }), null, 'c1', TZ, NOW);
    expect(waiting.task).toMatchObject({ status: 'In progress', awaitingSignOff: false });
    // Without the action nothing is offered, even on a done task.
    expect(portalTaskView(done, grant(), null, 'c1', TZ, NOW).can.signOff).toBe(false);
  });

  it('the description only with its own tick', () => {
    expect(portalTaskView(task(), grant(), null, 'c1', TZ, NOW).task.description).toBeNull();
    expect(portalTaskView(task({ clientShowDescription: true, description: 'Pump spec v2' }), grant(), null, 'c1', TZ, NOW).task.description).toBe('Pump spec v2');
  });

  it('comments: the client’s own and the ticked team replies to them — nothing else', () => {
    let n = 0;
    const c = (id: string, over: Partial<PortalCommentSource>): PortalCommentSource => ({ id, userId: 'u-staff', parentId: null, body: id, fromClient: false, clientVisible: false, createdAt: new Date(Date.UTC(2026, 9, 30, 1, n++)), editedAt: null, ...over });
    const rows = [
      c('mine', { userId: 'c1', fromClient: true }),
      c('reply-shown', { parentId: 'mine', clientVisible: true }),
      c('reply-internal', { parentId: 'mine' }),
      c('staff-top', { clientVisible: true }), // ticked but not a reply to the client
      c('other-client', { userId: 'c2', fromClient: true }),
      c('reply-to-other', { parentId: 'other-client', clientVisible: true }),
      c('spoofed', { userId: 'c1', fromClient: false }), // a staff-side row under the client's id can't pass as theirs
    ];
    const seen = portalComments(rows, 'c1');
    expect(seen.map((x) => [x.id, x.from])).toEqual([['mine', 'you'], ['reply-shown', 'team']]);
    expect(seen[1]).toMatchObject({ replyTo: 'mine' });
    expect(JSON.stringify(seen)).not.toContain('u-staff');
    // Without the Comment action there is no thread at all.
    expect(portalTaskView(task(), grant(), rows, 'c1', TZ, NOW).comments).toBeNull();
    expect(portalTaskView(task(), grant({ canComment: true }), rows, 'c1', TZ, NOW).comments).toHaveLength(2);
  });
});

describe('Client portal meetings (allow-list)', () => {
  const meeting = (over: Partial<PortalMeetingSource> & Record<string, unknown> = {}): PortalMeetingSource =>
    ({
      id: 'm1', title: 'Weekly progress', description: 'Bring the drawings', status: 'SCHEDULED', startAt: new Date('2026-11-02T06:00:00Z'), endAt: new Date('2026-11-02T07:00:00Z'),
      timeZone: null, location: 'Site office', onlineLink: 'https://meet.example/x', invitation: { response: 'PENDING' },
      agenda: [{ title: 'Pump status', expectedMinutes: 10, ownerId: 'u-omar', ownerName: 'Omar Staff' }], minutes: null,
      organizerId: 'u-omar', attendees: [{ name: 'Omar Staff' }], notes: [{ body: 'INTERNAL live note' }],
      ...over,
    }) as PortalMeetingSource;

  it('an invited client sees the meeting, its place and agenda topics — never its people or notes', () => {
    const v = portalMeetingView(meeting(), [], grant({ meetings: true, canRespond: true }), TZ);
    expect(v.meeting).toMatchObject({ id: 'm1', date: '2026-11-02', invited: true, response: 'PENDING', location: 'Site office', onlineLink: 'https://meet.example/x', description: 'Bring the drawings', status: 'Scheduled' });
    expect(v.agenda).toEqual([{ title: 'Pump status', minutes: 10 }]);
    expect(v.can).toEqual({ respond: true, markDone: true, downloadMinutes: false });
    expect(JSON.stringify(v)).not.toMatch(/Omar|u-omar|INTERNAL/);
  });

  it('a meeting there only for its shown minutes: no place, link, description or agenda', () => {
    const v = portalMeetingView(
      meeting({ invitation: null, minutes: { approvedAt: new Date('2026-11-03T06:00:00Z'), showRisks: false, people: ['Omar Staff', 'Omar'], content: { summary: 'Agreed with Omar', discussion: [], decisions: ['Go'], risks: ['Budget risk'], nextSteps: ['Order pumps — Omar Staff, by 5 Nov'] } } }),
      [],
      grant({ meetings: true, canRespond: true, canDownload: true }),
      TZ,
    );
    expect(v.meeting).toMatchObject({ invited: false, response: null, location: null, onlineLink: null, description: null, hasMinutes: true });
    expect(v.agenda).toEqual([]);
    expect(v.minutes!.approvedOn).toBe('2026-11-03');
    expect(v.minutes!.content.risks).toEqual([]); // not ticked when shown
    expect(v.minutes!.content.nextSteps).toEqual(['Order pumps — by 5 Nov']); // the owner taken off, as on the client page
    expect(v.can).toEqual({ respond: false, markDone: true, downloadMinutes: true });
  });

  it('own action items are listed with their state', () => {
    const v = portalMeetingView(meeting(), [{ id: 'a1', description: 'Send drawings', status: 'OPEN', dueDate: new Date('2026-11-05T08:00:00Z') }, { id: 'a2', description: 'Old', status: 'COMPLETED', dueDate: null }], grant({ meetings: true }), TZ);
    expect(v.actionItems).toEqual([{ id: 'a1', description: 'Send drawings', dueDate: '2026-11-05', done: false, cancelled: false }, { id: 'a2', description: 'Old', dueDate: null, done: true, cancelled: false }]);
    expect(v.can.markDone).toBe(false); // the Reply action isn't granted
  });

  it('a cancelled meeting can’t be answered', () => {
    expect(portalMeetingView(meeting({ status: 'CANCELLED' }), [], grant({ meetings: true, canRespond: true }), TZ).can.respond).toBe(false);
  });
});
