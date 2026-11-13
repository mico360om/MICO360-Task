import { describe, it, expect } from 'vitest';
import { readQuery, type ReaderContext, type ReadResult } from './search-reader';

// 1.23.6 The built-in reader: plain English turned into filter chips, everything else left as words.
// Today is Saturday 7 Nov 2026; the company week starts on Sunday (1 Nov – 7 Nov).
const ctx: ReaderContext = {
  today: '2026-11-07',
  weekStart: 0,
  projects: [
    { id: 'p-mico', code: 'MICO', name: 'MICO360 Implementation' },
    { id: 'p-rig', code: 'RIG', name: 'Rig 7 Overhaul' },
    { id: 'p-acme', code: 'ACME', name: 'Acme Monthly Works' },
    { id: 'p-hr', code: 'HR2', name: 'Human Resources' },
  ],
  people: [
    { id: 'u-bilal', firstName: 'Bilal', lastName: 'Ahmed', username: 'bilal' },
    { id: 'u-bilal2', firstName: 'Bilal', lastName: 'Khan', username: 'bkhan' },
    { id: 'u-sara', firstName: 'Sara', lastName: 'Ali', username: 'sara.ali' },
    { id: 'u-khalid', firstName: 'Khalid', lastName: 'Said', username: 'khalid.s' },
  ],
};

/** What a phrase should read as: its chips' labels in order, the filters, and the words left. */
type Want = { chips: string[]; words: string; filters?: Partial<ReadResult['filters']> };
const nothing = (q: string): Want => ({ chips: [], words: q });

const TABLE: [string, Want][] = [
  // The owner's example
  ['Show overdue MICO tasks assigned to me', { chips: ['Tasks', 'Overdue', 'MICO', 'Assigned to me'], words: '', filters: { kinds: ['task'], due: 'overdue', projectId: 'p-mico', assignee: ['me'] } }],
  ['show me open tasks in MICO due this week', { chips: ['Tasks', 'Due this week', 'Open', 'MICO'], words: '', filters: { kinds: ['task'], done: false, projectId: 'p-mico', due: { from: '2026-11-01', to: '2026-11-07' } } }],
  // Everyday title words stay words
  ['high pressure test', nothing('high pressure test')],
  ['open hole log', nothing('open hole log')],
  ['blocked drain', nothing('blocked drain')],
  ['rig 3 inspection', nothing('rig 3 inspection')],
  ['rig', nothing('rig')],
  ['notes', nothing('notes')],
  ['minutes', nothing('minutes')],
  ['high', nothing('high')],
  ['open', nothing('open')],
  ['late delivery', nothing('late delivery')],
  ['Close-out tasks', nothing('Close-out tasks')],
  ['Toolbox talk today', nothing('Toolbox talk today')],
  ['permit for rig move', nothing('permit for rig move')],
  ['clients', nothing('clients')],
  ['mine', nothing('mine')],
  ['Work in progress report', nothing('Work in progress report')],
  ['assigned to Zed', nothing('assigned to Zed')],
  ['bill of quantities', nothing('bill of quantities')],
  ['mast inspection', nothing('mast inspection')],
  // Task numbers come first (1.22.3)
  ['MICO-142', nothing('MICO-142')],
  ['mico 142', nothing('mico 142')],
  ['#RIG-4', nothing('#RIG-4')],
  // Quoted words are never read
  ['"high priority" valve', nothing('"high priority" valve')],
  ['"overdue" invoices', nothing('"overdue" invoices')],
  // Priority
  ['high priority', { chips: ['High priority'], words: '', filters: { priorities: ['HIGH'] } }],
  ['priority high pump', { chips: ['High priority'], words: 'pump', filters: { priorities: ['HIGH'] } }],
  ['priority: low', { chips: ['Low priority'], words: '', filters: { priorities: ['LOW'] } }],
  ['high-priority tasks', { chips: ['Tasks', 'High priority'], words: '', filters: { priorities: ['HIGH'], kinds: ['task'] } }],
  ['urgent', { chips: ['Urgent'], words: '', filters: { priorities: ['URGENT'] } }],
  ['urgent pump repair', { chips: ['Urgent'], words: 'pump repair', filters: { priorities: ['URGENT'] } }],
  ['please show all the urgent tasks', { chips: ['Tasks', 'Urgent'], words: '' }],
  ['low priority tasks for RIG', { chips: ['Tasks', 'Low priority', 'RIG'], words: '', filters: { projectId: 'p-rig' } }],
  // State
  ['open tasks', { chips: ['Tasks', 'Open'], words: '', filters: { kinds: ['task'], done: false } }],
  ['done tasks', { chips: ['Tasks', 'Done'], words: '', filters: { done: true } }],
  ['completed tasks this week', { chips: ['Tasks', 'This week', 'Done'], words: '', filters: { done: true, from: '2026-11-01', to: '2026-11-07' } }],
  ['blocked tasks', { chips: ['Tasks', 'Blocked'], words: '', filters: { statuses: ['BLOCKED'] } }],
  ['tasks that are blocked', { chips: ['Tasks', 'Blocked'], words: '' }],
  ['in review', { chips: ['In review'], words: '', filters: { statuses: ['REVIEW'] } }],
  ['tasks in progress', { chips: ['Tasks', 'In progress'], words: '', filters: { statuses: ['IN_PROGRESS'], kinds: ['task'] } }],
  ['not done valves', { chips: ['Open'], words: 'valves', filters: { done: false } }],
  ['waiting for approval', { chips: ['Waiting for approval'], words: '', filters: { approval: true } }],
  ['tasks waiting for approval in MICO', { chips: ['Tasks', 'Waiting for approval', 'MICO'], words: '' }],
  // Due dates (tasks and checklist items)
  ['overdue', { chips: ['Overdue'], words: '', filters: { due: 'overdue' } }],
  ['Expedite overdue invoices', { chips: ['Overdue'], words: 'Expedite invoices' }],
  ['due today', { chips: ['Due today'], words: '', filters: { due: { from: '2026-11-07', to: '2026-11-07' } } }],
  ['due tomorrow', { chips: ['Due tomorrow'], words: '', filters: { due: { from: '2026-11-08', to: '2026-11-08' } } }],
  ['due this week', { chips: ['Due this week'], words: '', filters: { due: { from: '2026-11-01', to: '2026-11-07' } } }],
  ['due next week', { chips: ['Due next week'], words: '', filters: { due: { from: '2026-11-08', to: '2026-11-14' } } }],
  ['due this month', { chips: ['Due this month'], words: '', filters: { due: { from: '2026-11-01', to: '2026-11-30' } } }],
  ['due before 20 Nov', { chips: ['Due before 20 Nov'], words: '', filters: { due: { to: '2026-11-19' } } }],
  ['no due date', { chips: ['No due date'], words: '', filters: { due: 'none' } }],
  ['tasks without a due date', { chips: ['Tasks', 'No due date'], words: '', filters: { due: 'none' } }],
  // When (each kind's own date)
  ['since 1 Nov', { chips: ['Since 1 Nov'], words: '', filters: { from: '2026-11-01' } }],
  ['pump since 1 November', { chips: ['Since 1 Nov'], words: 'pump', filters: { from: '2026-11-01' } }],
  ['since 2026-10-01', { chips: ['Since 1 Oct'], words: '', filters: { from: '2026-10-01' } }],
  ['since 15 Dec', { chips: ['Since 15 Dec 2025'], words: '', filters: { from: '2025-12-15' } }],
  ['since monday', { chips: ['Since 2 Nov'], words: '', filters: { from: '2026-11-02' } }],
  // A weekday is the coming one (on or after today), except after since / after / from (ruling 6).
  ['due friday', { chips: ['Due 13 Nov'], words: '', filters: { due: { from: '2026-11-13', to: '2026-11-13' } } }],
  ['meetings on saturday', { chips: ['Meetings', 'On 7 Nov'], words: '', filters: { from: '2026-11-07', to: '2026-11-07' } }],
  ['before 15 Nov', { chips: ['Before 15 Nov'], words: '', filters: { to: '2026-11-14' } }],
  ['between 1 Nov and 15 Nov', { chips: ['1 Nov – 15 Nov'], words: '', filters: { from: '2026-11-01', to: '2026-11-15' } }],
  ['meetings last week', { chips: ['Meetings', 'Last week'], words: '', filters: { kinds: ['meeting'], from: '2026-10-25', to: '2026-10-31' } }],
  ['files this month', { chips: ['Files', 'This month'], words: '', filters: { kinds: ['file'], from: '2026-11-01', to: '2026-11-30' } }],
  ['tasks today', { chips: ['Tasks', 'Today'], words: '', filters: { from: '2026-11-07', to: '2026-11-07' } }],
  // People
  ['assigned to Sara', { chips: ['Assigned to Sara Ali'], words: '', filters: { assignee: ['u-sara'] } }],
  ['assigned to bilal', { chips: ['Assigned to Bilal (2 people)'], words: '', filters: { assignee: ['u-bilal', 'u-bilal2'] } }],
  ['assigned to bilal khan valves', { chips: ['Assigned to Bilal Khan'], words: 'valves', filters: { assignee: ['u-bilal2'] } }],
  ['assigned to khalid.s', { chips: ['Assigned to Khalid Said'], words: '', filters: { assignee: ['u-khalid'] } }],
  ['unassigned tasks', { chips: ['Tasks', 'Unassigned'], words: '', filters: { assignee: 'none' } }],
  ['created by me', { chips: ['Created by me'], words: '', filters: { creator: ['me'] } }],
  ['meetings organised by me', { chips: ['Meetings', 'Organised by me'], words: '', filters: { organizer: ['me'] } }],
  ['organized by Sara', { chips: ['Organised by Sara Ali'], words: '', filters: { organizer: ['u-sara'] } }],
  ['my tasks', { chips: ['Tasks', 'Mine'], words: '', filters: { kinds: ['task'], mine: true } }],
  ['my meetings this week', { chips: ['Meetings', 'This week', 'Mine'], words: '' }],
  ['overdue tasks mine', { chips: ['Tasks', 'Overdue', 'Mine'], words: '' }],
  ['tasks for me', { chips: ['Tasks', 'Mine'], words: '' }],
  // Projects (only with a cue)
  ['MICO tasks', { chips: ['Tasks', 'MICO'], words: '', filters: { projectId: 'p-mico', kinds: ['task'] } }],
  ['mico tasks about valves', { chips: ['Tasks', 'MICO'], words: 'valves' }],
  ['in RIG', { chips: ['RIG'], words: '', filters: { projectId: 'p-rig' } }],
  ['project MICO', { chips: ['MICO'], words: '', filters: { projectId: 'p-mico' } }],
  ['pump in Acme Monthly Works', { chips: ['ACME'], words: 'pump', filters: { projectId: 'p-acme' } }],
  ['HR2 meetings', { chips: ['Meetings', 'HR2'], words: '', filters: { projectId: 'p-hr' } }],
  // Kinds
  ['meeting notes about pump', { chips: ['Meeting notes'], words: 'pump', filters: { kinds: ['note'] } }],
  ['meeting minutes', { chips: ['Minutes'], words: '', filters: { kinds: ['minutes'] } }],
  ['show minutes', { chips: ['Minutes'], words: '' }],
  ['checklist items assigned to me', { chips: ['Checklist items', 'Assigned to me'], words: '', filters: { kinds: ['checklist'], assignee: ['me'] } }],
  ['overdue checklist items assigned to me', { chips: ['Checklist items', 'Overdue', 'Assigned to me'], words: '', filters: { kinds: ['checklist'], due: 'overdue', assignee: ['me'] } }],
  ['show clients', { chips: ['Clients & contacts'], words: '', filters: { kinds: ['contact'] } }],
  ['clients and contacts', { chips: ['Clients & contacts'], words: '' }],
  ['tasks about pump', { chips: ['Tasks'], words: 'pump', filters: { kinds: ['task'] } }],
  ['meetings with Khalid', { chips: ['Meetings'], words: 'Khalid' }],
  ['list tasks', { chips: ['Tasks'], words: '' }],
  ['find files about permits', { chips: ['Files'], words: 'permits' }],
];

describe('the built-in reader: the phrase table', () => {
  it(`has ${TABLE.length} phrases (60 or more)`, () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
  });
  for (const [q, want] of TABLE) {
    it(`“${q}”`, () => {
      const r = readQuery(q, ctx);
      expect(r.chips.map((c) => c.label), 'chips').toEqual(want.chips);
      expect(r.words, 'words').toBe(want.words);
      if (want.filters) for (const [k, v] of Object.entries(want.filters)) expect(r.filters[k as keyof ReadResult['filters']], k).toEqual(v);
      if (want.chips.length === 0) expect(r.filters).toEqual({});
    });
  }
});

describe('the built-in reader: chips taken off', () => {
  it('a chip taken off drops its filter and its words', () => {
    const r = readQuery('Show overdue MICO tasks assigned to me', ctx, { off: ['due'] });
    expect(r.chips.map((c) => c.label)).toEqual(['Tasks', 'MICO', 'Assigned to me']);
    expect(r.filters.due).toBeUndefined();
    expect(r.words).toBe('');
  });

  it('every chip off: no filters, and the words that were read stay out', () => {
    const r = readQuery('urgent pump repair', ctx, { off: ['priority'] });
    expect(r.chips).toEqual([]);
    expect(r.filters).toEqual({});
    expect(r.words).toBe('pump repair');
  });

  it('each chip says which words it was read from', () => {
    const r = readQuery('Show overdue MICO tasks assigned to me', ctx);
    expect(r.chips.map((c) => [c.key, c.text])).toEqual([
      ['kind', 'tasks'],
      ['due', 'overdue'],
      ['project', 'MICO'],
      ['assignee', 'assigned to me'],
    ]);
  });
});

describe('the built-in reader: safety', () => {
  it('only the projects and people given are read (what the person may see)', () => {
    const r = readQuery('Show overdue MICO tasks assigned to Sara', { ...ctx, projects: [], people: [] });
    expect(r.chips.map((c) => c.label)).toEqual(['Tasks', 'Overdue']);
    expect(r.words).toBe('MICO assigned to Sara');
  });

  it('a very long text or odd characters never throw', () => {
    expect(() => readQuery('x '.repeat(500), ctx)).not.toThrow();
    expect(readQuery('', ctx)).toEqual({ chips: [], words: '', filters: {} });
    expect(readQuery('   ', ctx).words).toBe('');
    expect(() => readQuery('due 99 Foo since 31/02 before 2026-13-45 “unclosed', ctx)).not.toThrow();
  });

  it('a date that does not exist is not read', () => {
    expect(readQuery('since 31 Feb', ctx).chips).toEqual([]);
    expect(readQuery('before 2026-13-45', ctx).chips).toEqual([]);
  });
});

describe('1.24 category:… reads as a Category chip', () => {
  it('category:Electrical and category:"Civil works" — tasks of that category, the rest left as words', () => {
    const r = readQuery('category:Electrical pump', ctx);
    expect(r.chips.map((c) => [c.key, c.label])).toEqual([['category', 'Category: Electrical']]);
    expect(r.filters.categories).toEqual(['Electrical']);
    expect(r.words).toBe('pump');
    const two = readQuery('overdue category:"Civil works" categories:HSE', ctx);
    expect(two.chips.map((c) => c.label)).toEqual(['Overdue', 'Category: Civil works or HSE']);
    expect(two.filters).toMatchObject({ due: 'overdue', categories: ['Civil works', 'HSE'] });
    expect(two.words).toBe('');
  });
  it('taken off ("Show 2 hidden filters") it stays words; a plain "category" word is a word', () => {
    expect(readQuery('category:Electrical', ctx, { off: ['category'] })).toMatchObject({ chips: [], words: 'category:Electrical' });
    expect(readQuery('category review', ctx)).toMatchObject({ chips: [], words: 'category review' });
  });
});
