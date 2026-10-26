import { describe, it, expect } from 'vitest';
import { buildClientView, clientTaskStatus, type ClientViewInput } from './client-view-payload';

const NOW = new Date('2026-10-26T08:00:00Z'); // 12:00 in Muscat
const TZ = 'Asia/Muscat';

function input(over: Partial<ClientViewInput> = {}): ClientViewInput {
  return {
    viewer: { name: 'Fatma Al Harthy', email: 'fatma@client.example' },
    project: {
      name: 'Rig 7 Inspection',
      code: 'RIG',
      number: 'OD-2231',
      clientName: 'Oman Drilling Co.',
      status: 'ACTIVE',
      color: '#1E6B8B',
      icon: 'drill',
      imageUrl: '/uploads/p/rig.png',
      startDate: new Date('2026-10-01T00:00:00Z'),
      targetDate: new Date('2026-11-20T00:00:00Z'),
    },
    counts: { total: 8, done: 3 },
    items: [
      { title: 'Site survey', isMilestone: true, clientVisible: true, columnCategory: 'DONE', completedAt: new Date('2026-10-10T00:00:00Z'), dueDate: new Date('2026-10-10T00:00:00Z') },
      { title: 'Install sensors', isMilestone: false, clientVisible: true, columnCategory: 'IN_PROGRESS', completedAt: null, dueDate: new Date('2026-11-02T00:00:00Z') },
      { title: 'Report draft', isMilestone: false, clientVisible: true, columnCategory: 'TODO', completedAt: null, dueDate: null },
    ],
    minutes: [
      {
        meetingId: 'm1',
        title: 'Kick-off',
        startAt: new Date('2026-10-05T06:00:00Z'),
        timeZone: TZ,
        status: 'APPROVED',
        clientVisible: true,
        approvedAt: new Date('2026-10-06T06:00:00Z'),
        content: { summary: 'Agreed the plan.', discussion: [{ topic: 'Scope', text: 'Three rigs.' }], decisions: ['Start 1 Oct'], risks: ['Weather'], nextSteps: ['Survey'] },
      },
    ],
    timeZone: TZ,
    now: NOW,
    ...over,
  };
}

/** Every key anywhere in a value (paths like "milestones[].title"). */
function keyPaths(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => keyPaths(v, `${at}[]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => [`${at}${at ? '.' : ''}${k}`, ...keyPaths(v, `${at}${at ? '.' : ''}${k}`)]);
  return [];
}

describe('the client page payload: an explicit allow-list', () => {
  it('has exactly these fields and nothing else (no ids of people, no descriptions, no internal notes)', () => {
    const paths = [...new Set(keyPaths(buildClientView(input())))].sort();
    expect(paths).toEqual(
      [
        'viewer', 'viewer.name', 'viewer.email',
        'project', 'project.name', 'project.code', 'project.number', 'project.clientName', 'project.status', 'project.statusLabel',
        'project.color', 'project.icon', 'project.imageUrl',
        'progress', 'progress.percentDone',
        'timeline', 'timeline.startDate', 'timeline.targetDate', 'timeline.today', 'timeline.elapsedPercent',
        'milestones', 'milestones[].title', 'milestones[].status', 'milestones[].dueDate',
        'tasks', 'tasks[].title', 'tasks[].status', 'tasks[].dueDate',
        'minutes', 'minutes[].id', 'minutes[].title', 'minutes[].date', 'minutes[].approvedOn', 'minutes[].content',
        'minutes[].content.summary', 'minutes[].content.discussion', 'minutes[].content.discussion[].topic', 'minutes[].content.discussion[].text',
        'minutes[].content.decisions', 'minutes[].content.risks', 'minutes[].content.nextSteps',
        'generatedAt',
      ].sort(),
    );
  });

  it('copies field by field: extra properties on the rows it is given never pass through', () => {
    const leaky = input();
    Object.assign(leaky.project, { description: 'INTERNAL margin 40%', ownerId: 'u-owner', notes: 'secret' });
    Object.assign(leaky.items[0]!, { description: 'internal', assignees: [{ name: 'Omar Ahmed' }], comments: ['hush'] });
    Object.assign(leaky.minutes[0]!, { organizerName: 'Omar Ahmed', approvedById: 'u-1', attendees: ['Bilal'] });
    const json = JSON.stringify(buildClientView(leaky));
    for (const secret of ['INTERNAL', 'u-owner', 'secret', 'internal', 'Omar Ahmed', 'hush', 'u-1', 'Bilal']) expect(json).not.toContain(secret);
  });

  it('shows only items marked "Show to client" — even if the source handed over more', () => {
    const v = buildClientView(
      input({
        items: [
          { title: 'Shown', isMilestone: false, clientVisible: true, columnCategory: 'TODO', completedAt: null, dueDate: null },
          { title: 'Hidden task', isMilestone: false, clientVisible: false, columnCategory: 'TODO', completedAt: null, dueDate: null },
          { title: 'Hidden milestone', isMilestone: true, clientVisible: false, columnCategory: 'TODO', completedAt: null, dueDate: null },
        ],
      }),
    );
    expect(v.tasks.map((t) => t.title)).toEqual(['Shown']);
    expect(v.milestones).toEqual([]);
    expect(JSON.stringify(v)).not.toContain('Hidden');
  });

  it('shows only approved final minutes that are marked', () => {
    const base = input().minutes[0]!;
    const v = buildClientView(
      input({
        minutes: [
          base,
          { ...base, meetingId: 'm2', title: 'Draft minutes', status: 'DRAFT' },
          { ...base, meetingId: 'm3', title: 'Approved, not marked', clientVisible: false },
        ],
      }),
    );
    expect(v.minutes.map((m) => m.id)).toEqual(['m1']);
    expect(JSON.stringify(v)).not.toContain('Draft minutes');
    expect(JSON.stringify(v)).not.toContain('not marked');
  });

  it('splits milestones from tasks, soonest due first (no date last)', () => {
    const v = buildClientView(input());
    expect(v.milestones).toEqual([{ title: 'Site survey', status: 'Done', dueDate: '2026-10-10' }]);
    expect(v.tasks).toEqual([
      { title: 'Install sensors', status: 'In progress', dueDate: '2026-11-02' },
      { title: 'Report draft', status: 'Not started', dueDate: null },
    ]);
  });

  it('counts the whole project for % done, never naming what isn’t marked', () => {
    expect(buildClientView(input()).progress).toEqual({ percentDone: 38 });
    expect(buildClientView(input({ counts: { total: 0, done: 0 } })).progress).toEqual({ percentDone: 0 });
  });

  it('places today on the start → target bar', () => {
    const t = buildClientView(input()).timeline;
    expect(t).toEqual({ startDate: '2026-10-01', targetDate: '2026-11-20', today: '2026-10-26', elapsedPercent: 50 });
    // Before the start and after the target, today is at an end of the bar.
    expect(buildClientView(input({ now: new Date('2026-09-01T08:00:00Z') })).timeline.elapsedPercent).toBe(0);
    expect(buildClientView(input({ now: new Date('2027-01-01T08:00:00Z') })).timeline.elapsedPercent).toBe(100);
    // Without both dates there is no bar.
    const p = input().project;
    expect(buildClientView(input({ project: { ...p, startDate: null } })).timeline.elapsedPercent).toBeNull();
  });

  it('words the project status plainly', () => {
    const p = input().project;
    expect(buildClientView(input({ project: { ...p, status: 'PLANNING' } })).project.statusLabel).toBe('Planning');
    expect(buildClientView(input({ project: { ...p, status: 'ACTIVE' } })).project.statusLabel).toBe('In progress');
    expect(buildClientView(input({ project: { ...p, status: 'ON_HOLD' } })).project.statusLabel).toBe('On hold');
    expect(buildClientView(input({ project: { ...p, status: 'COMPLETED' } })).project.statusLabel).toBe('Completed');
  });

  it('dates the minutes by the meeting’s own day, newest first', () => {
    const base = input().minutes[0]!;
    const v = buildClientView(input({ minutes: [base, { ...base, meetingId: 'm9', title: 'Review', startAt: new Date('2026-10-20T21:30:00Z') }] }));
    // 21:30 UTC is already the 21st in Muscat.
    expect(v.minutes.map((m) => [m.id, m.date])).toEqual([['m9', '2026-10-21'], ['m1', '2026-10-05']]);
    expect(v.minutes[1]!.approvedOn).toBe('2026-10-06');
  });

  it('keeps Arabic text as it is', () => {
    const v = buildClientView(input({ items: [{ title: 'مسح الموقع', isMilestone: true, clientVisible: true, columnCategory: 'TODO', completedAt: null, dueDate: null }] }));
    expect(v.milestones[0]!.title).toBe('مسح الموقع');
  });
});

describe('a task’s status in plain words (its column’s stage, never the column’s own name)', () => {
  it.each([
    ['BACKLOG', null, 'Not started'],
    ['TODO', null, 'Not started'],
    ['IN_PROGRESS', null, 'In progress'],
    ['REVIEW', null, 'In review'],
    ['BLOCKED', null, 'On hold'],
    ['DONE', null, 'Done'],
    ['TODO', new Date(), 'Done'],
    [null, null, 'Not started'],
  ])('%s (completed %s) → %s', (category, completedAt, label) => {
    expect(clientTaskStatus({ columnCategory: category, completedAt })).toBe(label);
  });
});
