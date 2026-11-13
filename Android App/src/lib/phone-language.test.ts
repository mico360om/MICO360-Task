/**
 * Final pass, item 1: a phone set to Turkish still finds, filters and sorts the website's way. Its
 * dotless "ı" made "SITE".toLocaleLowerCase() "sıte" — a search for "site" missed "SITE WALK" — and
 * localeCompare without a locale put "Cyrus" before "Çağrı". The phone's language is faked by making
 * Turkish the default of every case change, comparison and Intl.Collator made without a locale.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiTask } from './types';

const PHONE = 'tr-TR';
const real = {
  lower: String.prototype.toLocaleLowerCase,
  upper: String.prototype.toLocaleUpperCase,
  compare: String.prototype.localeCompare,
  Collator: Intl.Collator,
};

const task = (over: Partial<ApiTask> = {}): ApiTask => ({
  id: 't1', key: 'RIG-14', title: 'SITE WALK', description: null, projectId: 'p1', columnId: 'c1', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, progress: 0, completedAt: null, ...over,
});
const person = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName, username: id, active: true });
const meeting = (over: Record<string, unknown>) => ({ id: 'm1', title: 'SITE WALK', status: 'SCHEDULED', startAt: '2026-11-02T05:00:00Z', endAt: null, projectId: null, organizerId: 'u1', location: null, category: null, ...over });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-30T08:00:00Z');

describe('a phone in Turkish', () => {
  beforeAll(() => {
    vi.resetModules();
    String.prototype.toLocaleLowerCase = function (this: string, l?: string | string[]) {
      return real.lower.call(this, l ?? PHONE);
    };
    String.prototype.toLocaleUpperCase = function (this: string, l?: string | string[]) {
      return real.upper.call(this, l ?? PHONE);
    };
    String.prototype.localeCompare = function (this: string, that: string, l?: string | string[], o?: Intl.CollatorOptions) {
      return real.compare.call(this, that, l ?? PHONE, o);
    };
    // Every Intl member kept (they aren't enumerable, so a spread would drop them); only Collator's default changes.
    const fake = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Intl)) as typeof Intl;
    Object.defineProperty(fake, 'Collator', {
      value: new Proxy(real.Collator, {
        construct: (T, [l, o]) => new T(l ?? PHONE, o),
        apply: (T, _t, [l, o]) => new T(l ?? PHONE, o),
      }),
    });
    vi.stubGlobal('Intl', fake);
  });
  afterAll(() => {
    String.prototype.toLocaleLowerCase = real.lower;
    String.prototype.toLocaleUpperCase = real.upper;
    String.prototype.localeCompare = real.compare;
    vi.unstubAllGlobals();
  });

  it('the fake really is the phone’s language', () => {
    expect('SITE'.toLocaleLowerCase()).toBe('sıte');
    expect('ii'.toLocaleUpperCase()).toBe('İİ');
    expect(['Çağrı', 'Cyrus'].sort((a, b) => a.localeCompare(b))).toEqual(['Cyrus', 'Çağrı']);
    expect(new Intl.Collator().compare('Çağrı', 'Cyrus')).toBeGreaterThan(0);
  });

  it('every search finds a capital I as on the website', async () => {
    const { applyFilters, DEFAULT_FILTERS } = await import('./calendar-model');
    const item = { key: 't1', kind: 'task', task: task(), date: '2026-10-30', status: 'todo', projectArchived: false, recurring: false } as never;
    expect(applyFilters([item], { ...DEFAULT_FILTERS, q: 'site' }, { myId: 'u1' })).toHaveLength(1);
    expect(applyFilters([item], { ...DEFAULT_FILTERS, q: 'rig-14' }, { myId: 'u1' })).toHaveLength(1);

    const { filterCalendarMeetings } = await import('./calendar-meetings');
    expect(filterCalendarMeetings([meeting({ projectId: 'p1' }) as never], { ...DEFAULT_FILTERS, q: 'site' }, { myId: 'u1' })).toHaveLength(1);

    const { highlightParts, searchSnippet, inboxSections } = await import('./chat-model');
    expect(highlightParts('INSPECTION DUE', 'inspection')).toEqual([{ text: 'INSPECTION', match: true }, { text: ' DUE', match: false }]);
    expect(searchSnippet(`${'x '.repeat(100)}RIG INSPECTION ${'y '.repeat(100)}`, 'inspection', 10)).toContain('INSPECTION');
    expect(inboxSections({ inbox: [], projects: [{ id: 'p1', name: 'RIG INSPECTIONS' }], myId: 'u1', nameOf: () => '', query: 'rig' }).channels).toHaveLength(1);

    const { dmCandidates } = await import('./chat-ui');
    expect(dmCandidates([{ ...person('u2', 'ILKER', 'Demir'), username: 'idemir' }] as never, 'u1', 'ilker')).toHaveLength(1);

    const { searchEmoji } = await import('./emoji');
    expect(searchEmoji('SMILE').map((e) => e.char)).toContain('😄');

    const { filterMeetings } = await import('./meeting-list');
    const ctx = { timeZone: TZ, now: NOW, projectName: () => null, organizerName: () => null };
    expect(filterMeetings([meeting({}) as never], { q: 'site', projectId: '', status: 'ALL', range: 'any' }, ctx)).toHaveLength(1);

    const { shownGroups } = await import('./project-dashboard');
    expect(shownGroups([{ id: 'c1', name: 'To do', color: null, category: 'TODO', tasks: [task()] }], 'all', 'site', '2026-10-30', TZ)[0]?.tasks).toHaveLength(1);

    const { clientSuggestions } = await import('./project-form');
    expect(clientSuggestions([{ clientName: 'Globex Oman' }], 'glo')).toEqual(['Globex Oman']);

    const { filterPeople } = await import('./workload');
    expect(filterPeople([{ id: 'u1', name: 'IBRAHIM Said' }] as never, 'ibrahim')).toHaveLength(1);
  });

  it('a role typed in capitals is the same role, and initials are English capitals', async () => {
    const { roleCounts } = await import('./role-counts');
    expect(roleCounts([['u1'], ['u2']], ['u1', 'u2'], { u1: 'inspector', u2: 'INSPECTOR' }).roles).toEqual([{ name: 'inspector', tasks: 2 }]);
    const { roleWontCount } = await import('./template-words');
    expect(roleWontCount('INSPECTOR', roleCounts([['u1']], ['u1'], { u1: 'inspector' }))).toBe(false);
    const { projectInitials } = await import('./project-identity');
    expect(projectInitials('inspection index')).toBe('II');
  });

  it('every list sorts in English order', async () => {
    const names = (rows: { label?: string; name?: string }[]) => rows.map((r) => (r.label ?? r.name)!.split(' ')[0]);
    const dir = [person('u2', 'Cyrus', 'Khan'), person('u3', 'Çağrı', 'Demir')];

    const { dmCandidates, memberRows } = await import('./chat-ui');
    expect(names(dmCandidates(dir as never, 'u1', ''))).toEqual(['Çağrı', 'Cyrus']);
    expect(names(memberRows(['u2', 'u3'], dir as never, 'u1', () => false, NOW))).toEqual(['Çağrı', 'Cyrus']);

    const { membersInOrder, addableUsers } = await import('./project-team');
    expect(membersInOrder(dir.map((p) => ({ ...p, role: 'MEMBER' })) as never).map((m) => m.firstName)).toEqual(['Çağrı', 'Cyrus']);
    expect(names(addableUsers(dir, []))).toEqual(['Çağrı', 'Cyrus']);

    const { invitableOptions } = await import('./meeting-ai');
    expect(names(invitableOptions(dir as never, null, []))).toEqual(['Çağrı', 'Cyrus']);

    const { sortMyTasks } = await import('./my-tasks');
    const rows = ['Cyrus walk', 'Çağrı walk'].map((title) => ({ task: task({ title }) }));
    expect(sortMyTasks(rows as never, 'title').map((r) => r.task.title)).toEqual(['Çağrı walk', 'Cyrus walk']);

    const { groupByDay } = await import('./calendar-model');
    const items = rows.map((r, i) => ({ key: `t${i}`, kind: 'task', task: r.task, date: '2026-10-30', status: 'todo', projectArchived: false, recurring: false }));
    expect(groupByDay(items as never).get('2026-10-30')!.map((i) => i.task.title)).toEqual(['Çağrı walk', 'Cyrus walk']);

    const { groupMeetings } = await import('./meeting-list');
    const meetings = ['Cyrus visit', 'Çağrı visit'].map((title, i) => meeting({ id: `m${i}`, title }));
    expect(groupMeetings(meetings as never, { timeZone: TZ, now: NOW }, 'title')[0]!.items.map((m) => m.title)).toEqual(['Çağrı visit', 'Cyrus visit']);

    const { clientSuggestions } = await import('./project-form');
    expect(clientSuggestions([{ clientName: 'Contoso Oil' }, { clientName: 'Çağrı Oil' }], '')).toEqual(['Çağrı Oil', 'Contoso Oil']);

    const { workload, projectDeadlines } = await import('./project-dashboard');
    const people = [task({ id: 'a', assignees: [{ id: 'u2', name: 'Cyrus Khan' }] as never }), task({ id: 'b', assignees: [{ id: 'u3', name: 'Çağrı Demir' }] as never })];
    expect(names(workload(people, '2026-10-30', TZ))).toEqual(['Çağrı', 'Cyrus']);
    const due = ['Cyrus walk', 'Çağrı walk'].map((title, i) => task({ id: `d${i}`, title, dueDate: '2026-11-02' }));
    expect(projectDeadlines(due, '2026-10-30', 14, TZ).map((d) => d.task.title)).toEqual(['Çağrı walk', 'Cyrus walk']);
  });
});
