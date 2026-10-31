import { describe, it, expect } from 'vitest';
import { describeMatches, type TaskSearchLive } from './task-search-matches';

const task = (over: Partial<TaskSearchLive> = {}): TaskSearchLive => ({
  key: 'OPS-17',
  formerKeys: ['RIG-4'],
  title: 'Check the base plates',
  description: 'Walk the site before the shift starts.',
  comments: [
    { id: 'c2', parentId: 'c1', body: 'Done, the scaffold permit is signed.', createdAt: new Date('2026-10-28T18:30:00Z'), author: { firstName: 'Sara', lastName: 'Nasser', username: 'sara' } },
    { id: 'c1', parentId: null, body: 'Who has the scaffold permit?', createdAt: new Date('2026-10-27T06:00:00Z'), author: { firstName: 'Bilal', lastName: '', username: 'bilal' } },
  ],
  checklist: [{ text: 'Photograph the scaffold tags', done: false }],
  assignees: [{ firstName: 'Bilal', lastName: 'Ahmed', username: 'bilal.a' }],
  contacts: [{ name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: null }],
  tags: [{ name: 'Safety' }],
  files: [{ filename: 'Permit-Scan.pdf' }],
  ...over,
});
const tz = 'Asia/Muscat';
const marked = (m: { snippet: string; ranges: { start: number; end: number }[] }) => m.ranges.map((r) => m.snippet.slice(r.start, r.end));

describe('describeMatches — where a task matched, for the results', () => {
  it('highlights the title, and lists no separate line for it', () => {
    const r = describeMatches(task(), ['base'], { timeZone: tz });
    expect(r.complete).toBe(true);
    expect(r.titleRanges).toEqual([{ start: 10, end: 14 }]);
    expect(r.matches).toEqual([]);
  });

  it('names a comment’s author and day (company time), a reply as a reply', () => {
    const r = describeMatches(task({ checklist: [] }), ['permit'], { timeZone: tz, max: 3 });
    const comments = r.matches.filter((m) => m.field === 'comment');
    expect(comments.map((m) => m.label)).toEqual(['Reply by Sara Nasser · 28 Oct 2026', 'Comment by Bilal · 27 Oct 2026']);
    expect(marked(comments[0]!)).toEqual(['permit']);
  });

  it('labels every kind of field', () => {
    const labels = (q: string[]) => describeMatches(task(), q, { timeZone: tz }).matches.map((m) => [m.field, m.label]);
    expect(labels(['site before'])).toEqual([['description', 'Description']]);
    expect(labels(['photograph'])).toEqual([['checklist', 'Checklist item']]);
    expect(labels(['bilal.a'])).toEqual([['assignee', 'Assigned to']]);
    expect(labels(['site lead'])).toEqual([['contact', 'External contact']]);
    expect(labels(['safety'])).toEqual([['tag', 'Tag']]);
    expect(labels(['scan.pdf'])).toEqual([['file', 'File']]);
    expect(labels(['rig-4'])).toEqual([['key', 'Former key']]);
  });

  it('finds an external contact by any of their details, shown together', () => {
    for (const q of ['oxy', 'ahmed@oxy', '9912', 'al said']) {
      const [m] = describeMatches(task({ assignees: [] }), [q], { timeZone: tz }).matches;
      expect(m?.field, q).toBe('contact');
      expect(m?.snippet).toBe('Ahmed Al Said · OXY · Site lead · ahmed@oxy.com · +968 9912 3456');
    }
  });

  it('a person is found by first name, last name or username', () => {
    for (const q of ['bilal', 'ahmed', 'bilal.a']) {
      const ms = describeMatches(task({ comments: [], contacts: [] }), [q], { timeZone: tz }).matches;
      expect(ms.some((m) => m.field === 'assignee' && m.snippet === 'Bilal Ahmed · bilal.a'), q).toBe(true);
    }
  });

  it('shows the places that hold the words first, so every word is accounted for', () => {
    const r = describeMatches(task(), ['safety', 'site lead', 'photograph'], { timeZone: tz });
    expect(r.complete).toBe(true);
    expect(r.matches.map((m) => m.field).sort()).toEqual(['checklist', 'contact', 'tag']);
  });

  it('at most `max` places', () => {
    expect(describeMatches(task(), ['scaffold'], { timeZone: tz, max: 2 }).matches).toHaveLength(2);
    expect(describeMatches(task(), ['scaffold'], { timeZone: tz }).matches).toHaveLength(3);
  });

  it('is incomplete when a word is nowhere in the task (the index was behind)', () => {
    expect(describeMatches(task(), ['scaffold', 'crane'], { timeZone: tz }).complete).toBe(false);
  });

  it('a key the task has now counts as found, without a line of its own', () => {
    const r = describeMatches(task(), ['ops-17'], { timeZone: tz });
    expect(r.complete).toBe(true);
    expect(r.matches).toEqual([]);
  });

  it('finds Arabic whatever its letter forms', () => {
    const r = describeMatches(task({ title: 'إدارة الموقع', comments: [] }), ['اداره'], { timeZone: tz });
    expect(r.complete).toBe(true);
    expect(r.titleRanges).toEqual([{ start: 0, end: 5 }]);
  });

  it('a comment by someone whose account is gone is "Someone"’s', () => {
    const r = describeMatches(task({ comments: [{ id: 'x', parentId: null, body: 'crane booked', createdAt: new Date('2026-10-30T08:00:00Z'), author: null }] }), ['crane'], { timeZone: tz });
    expect(r.matches[0]?.label).toBe('Comment by Someone · 30 Oct 2026');
  });
});
