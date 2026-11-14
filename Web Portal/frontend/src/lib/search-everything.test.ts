import { describe, it, expect } from 'vitest';
import { KIND_META, SEARCH_KINDS, allQuery, dateLabel, everythingFilters, everythingAddress, hasEverythingFilters, isSavedSearch, savedAddress, savedFiltersOf, targetLink, taskPanelOf, type SearchHit } from './search-everything';

const hit = (over: Partial<SearchHit>): SearchHit => ({
  kind: 'task', id: 't1', title: 'Pump', titleRanges: [], project: null, status: null, date: null, people: null, matches: [], target: { type: 'task', taskId: 't1' }, ...over,
});

describe('search everything — the website’s side', () => {
  it('names every kind (singular, plural)', () => {
    expect(SEARCH_KINDS.map((k) => KIND_META[k].label)).toEqual(['Task', 'Project', 'Meeting', 'Note', 'Minutes', 'File', 'Inspection', 'Checklist item', 'Client or contact']);
    expect(KIND_META.inspection.plural).toBe('Inspections');
    // 1.23.6
    expect(KIND_META.checklist.plural).toBe('Checklist items');
    expect(KIND_META.contact.plural).toBe('Clients & contacts');
  });

  it('1.23.6: the chips taken off and "Search the words instead" live in the address and go to the server', () => {
    const f = everythingFilters(new URLSearchParams('q=overdue%20tasks&off=due,nonsense,kind,due&plain=1'));
    expect(f).toEqual({ q: 'overdue tasks', off: ['due', 'kind'], plain: true });
    expect(everythingAddress(f)).toBe('q=overdue+tasks&off=due%2Ckind&plain=1');
    expect(allQuery(f)).toBe('q=overdue+tasks&off=due%2Ckind&plain=true');
    expect(hasEverythingFilters(f)).toBe(false); // neither is a filter of what to find
  });

  it('1.23.6: where the new kinds open', () => {
    expect(targetLink(hit({ kind: 'contact', target: { type: 'client', name: 'Northwind Trading' } }))).toBe('/projects?client=Northwind%20Trading');
    expect(targetLink(hit({ kind: 'contact', target: { type: 'account', userId: 'u 1' } }))).toBe('/admin/users?open=u%201');
    expect(targetLink(hit({ kind: 'checklist', target: { type: 'checklist', taskId: 't1', itemId: 'i1' } }))).toBeNull();
    expect(taskPanelOf(hit({ kind: 'checklist', target: { type: 'checklist', taskId: 't1', itemId: 'i1' } }))).toEqual({ task: 't1', mark: ['item', 'i1'] });
    expect(taskPanelOf(hit({ kind: 'contact', target: { type: 'contact', taskId: 't1', contactId: 'c1' } }))).toEqual({ task: 't1', mark: ['contact', 'c1'] });
    expect(taskPanelOf(hit({ kind: 'file', target: { type: 'file', taskId: 't1', fileId: 'f1' } }))).toEqual({ task: 't1', mark: ['file', 'f1'] });
    expect(taskPanelOf(hit({}))).toEqual({ task: 't1' });
    expect(taskPanelOf(hit({ kind: 'contact', target: { type: 'client', name: 'x' } }))).toBeNull();
  });

  it('1.23.6: a saved search keeps the page’s filters (never the AI flag), and the page knows when it shows one', () => {
    const page = everythingFilters(new URLSearchParams('q=overdue&type=task&person=me&off=due&ai=1'));
    const filters = savedFiltersOf(page);
    expect(filters).toEqual({ type: 'task', person: 'me', off: ['due'] });
    expect(savedAddress({ q: 'overdue', filters })).toBe('q=overdue&type=task&person=me&off=due');
    expect(isSavedSearch(page, { q: 'overdue', filters })).toBe(true);
    expect(isSavedSearch({ ...page, person: undefined }, { q: 'overdue', filters })).toBe(false);
  });

  it('reads the filters from the address and writes them back, only what is set', () => {
    const f = everythingFilters(new URLSearchParams('q=pump&type=file&project=p1&status=DONE&person=me&from=2026-11-01&to=2026-11-07&done=false&archived=true&ai=1&task=t9'));
    expect(f).toEqual({ q: 'pump', type: 'file', projectId: 'p1', status: 'DONE', person: 'me', from: '2026-11-01', to: '2026-11-07', done: false, archived: true, ai: true });
    expect(everythingAddress(f)).toBe('q=pump&type=file&project=p1&status=DONE&person=me&from=2026-11-01&to=2026-11-07&done=false&archived=true&ai=1');
    expect(everythingFilters(new URLSearchParams('q=x&type=chat&status=LATE&from=3-11-2026'))).toEqual({ q: 'x' }); // nonsense is dropped
    expect(everythingFilters(new URLSearchParams('q=x&assignee=me&status=DONE'))).toEqual({ q: 'x', type: 'task', status: 'DONE', person: 'me' }); // an address from before 1.23 (tasks only)
    expect(hasEverythingFilters({ q: 'x' })).toBe(false);
    expect(hasEverythingFilters({ q: 'x', person: 'me' })).toBe(true);
  });

  it('asks the server with the same filters (a task status only with tasks)', () => {
    expect(allQuery({ q: ' pump ', type: 'task', status: 'TODO', person: 'u1', done: true }, 'c1')).toBe('q=pump&type=task&status=TODO&person=u1&done=true&cursor=c1');
    expect(allQuery({ q: 'pump', status: 'TODO' })).toBe('q=pump');
  });

  it('says what a date is (due, starts, written…), in the company’s days', () => {
    expect(dateLabel(hit({ date: { at: '2026-10-30T20:30:00.000Z', kind: 'due' } }), 'Asia/Muscat')).toBe('Due 31 Oct 2026');
    expect(dateLabel(hit({ date: { at: '2026-11-10T06:00:00.000Z', kind: 'starts' } }), 'Asia/Muscat')).toBe('Starts 10 Nov 2026');
    expect(dateLabel(hit({ date: { at: '2026-11-03T06:00:00.000Z', kind: 'approved' } }), 'Asia/Muscat')).toBe('Approved 3 Nov 2026');
    expect(dateLabel(hit({}), 'Asia/Muscat')).toBeNull();
  });

  it('leads each result to its place', () => {
    expect(targetLink(hit({ target: { type: 'project', projectId: 'p1' } }))).toBe('/projects/p1');
    expect(targetLink(hit({ target: { type: 'meeting', meetingId: 'm1' } }))).toBe('/meetings/m1');
    expect(targetLink(hit({ target: { type: 'meeting', meetingId: 'm1', noteId: 'n1' } }))).toBe('/meetings/m1#note-n1');
    expect(targetLink(hit({ target: { type: 'meeting', meetingId: 'm1', section: 'minutes' } }))).toBe('/meetings/m1#final-minutes');
    expect(targetLink(hit({ target: { type: 'inspection', inspectionId: 'i1' } }))).toBe('/inspections/i1');
    expect(targetLink(hit({ target: { type: 'task', taskId: 't1' } }))).toBeNull(); // the task panel
    expect(targetLink(hit({ target: { type: 'file', taskId: 't1', fileId: 'f1' } }))).toBeNull();
  });
});
