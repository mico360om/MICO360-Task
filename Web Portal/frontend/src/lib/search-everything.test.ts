import { describe, it, expect } from 'vitest';
import { KIND_META, SEARCH_KINDS, allQuery, dateLabel, everythingFilters, everythingAddress, hasEverythingFilters, targetLink, type SearchHit } from './search-everything';

const hit = (over: Partial<SearchHit>): SearchHit => ({
  kind: 'task', id: 't1', title: 'Pump', titleRanges: [], project: null, status: null, date: null, people: null, matches: [], target: { type: 'task', taskId: 't1' }, ...over,
});

describe('search everything — the website’s side', () => {
  it('names every kind (singular, plural)', () => {
    expect(SEARCH_KINDS.map((k) => KIND_META[k].label)).toEqual(['Task', 'Project', 'Meeting', 'Note', 'Minutes', 'File', 'Inspection']);
    expect(KIND_META.inspection.plural).toBe('Inspections');
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
