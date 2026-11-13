import { describe, it, expect } from 'vitest';
import { createTopBarMeetings, TOP_BAR_MEETING_LIMIT } from './top-bar-meetings';
import type { SearchAllInput, SearchAllResult } from './search-engine';
import type { SearchHit } from './search-types';
import type { SearchScopeAll } from './search-scope';

// Review #22/#10/N3 (13 Nov 2026): the top bar's meetings come from the search engine (the index, with the
// person's scope read for the request); the database tests (tests/integration/top-bar-meeting-search)
// check who finds what. Here: how the engine's meetings and notes become the top bar's meetings.

const scope: SearchScopeAll = { projectIds: ['p1'], meetings: { full: ['m1'], invitee: [], editable: [] } };
const hit = (kind: 'meeting' | 'note', id: string, meetingId: string, title: string, snippet?: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  kind,
  id,
  title,
  titleRanges: [],
  project: null,
  status: null,
  date: null,
  people: null,
  matches: snippet ? [{ field: kind === 'note' ? 'note' : 'agenda', label: 'Where', snippet, ranges: [] }] : [],
  target: kind === 'note' ? { type: 'meeting', meetingId, noteId: id } : { type: 'meeting', meetingId },
  ...extra,
});

type Row = { id: string; projectId: string | null; description: string | null; agendaItems: { title: string }[] };
function make(hits: SearchHit[], rows: Row[]) {
  const asked: SearchAllInput[] = [];
  const read: string[][] = [];
  const engine = { async search(input: SearchAllInput): Promise<SearchAllResult> { asked.push(input); return { hits, next: null, corrected: [] }; } };
  const prisma = {
    meeting: {
      async findMany(args: { where: { id: { in: string[] } } }) {
        read.push(args.where.id.in);
        return rows.filter((r) => args.where.id.in.includes(r.id));
      },
    },
  };
  return { search: createTopBarMeetings({ prisma: prisma as never, engine }), asked, read };
}
const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, projectId: null, description: null, agendaItems: [], ...extra });

describe('the top bar’s meetings (createTopBarMeetings)', () => {
  it('asks the index for meetings and notes holding every word, in the person’s scope for this request', async () => {
    const t = make([], []);
    expect(await t.search.search({ q: 'pump valve', scope, viewerId: 'u1' })).toEqual([]);
    expect(t.asked).toEqual([{ q: 'pump valve', scope, viewerId: 'u1', kinds: ['meeting', 'note'], limit: 2 * TOP_BAR_MEETING_LIMIT, exactOnly: true }]);
    expect(t.read).toEqual([]); // nothing found: nothing more is read
  });

  it('a note found stands for its meeting, once, in the engine’s order; its project as the meeting has it', async () => {
    const t = make(
      [hit('note', 'n1', 'm2', 'Budget review', '…supplier penalty of 40k…'), hit('meeting', 'm1', 'm1', 'Pump overhaul', 'Agenda: penalty clause'), hit('note', 'n2', 'm2', 'Budget review', 'second penalty note')],
      [row('m1', { projectId: 'p1' }), row('m2')],
    );
    expect(await t.search.search({ q: 'penalty', scope, viewerId: 'u1' })).toEqual([
      { id: 'm2', title: 'Budget review', projectId: null, snippet: '…supplier penalty of 40k…' },
      { id: 'm1', title: 'Pump overhaul', projectId: 'p1', snippet: 'Agenda: penalty clause' },
    ]);
  });

  it('found by its title alone: the start of the meeting (description, then agenda), else the title', async () => {
    const long = 'x'.repeat(200);
    const t = make(
      [hit('meeting', 'm1', 'm1', 'Site handover'), hit('meeting', 'm2', 'm2', 'Weekly'), hit('meeting', 'm3', 'm3', 'Empty'), hit('meeting', 'm4', 'm4', 'Long')],
      [row('m1', { description: '  Who takes over\n the keys. ', agendaItems: [{ title: 'Permits' }] }), row('m2', { agendaItems: [{ title: 'Safety' }, { title: 'Crane' }] }), row('m3'), row('m4', { description: long })],
    );
    const found = await t.search.search({ q: 'site', scope, viewerId: 'u1' });
    expect(found.map((m) => m.snippet)).toEqual(['Who takes over the keys. — Permits', 'Safety — Crane', 'Empty', `${'x'.repeat(140)}…`]);
  });

  it('leaves out close or partial matches, other kinds, and a meeting deleted since; at most TOP_BAR_MEETING_LIMIT', async () => {
    const many = Array.from({ length: 15 }, (_, i) => hit('meeting', `m${i}`, `m${i}`, `Meeting ${i}`, 'here'));
    const t = make(
      [hit('meeting', 'close', 'close', 'Close', 'x', { match: 'close' }), hit('meeting', 'gone', 'gone', 'Gone', 'x'), { ...hit('meeting', 'f1', 'f1', 'File'), kind: 'file', target: { type: 'file', taskId: 't', fileId: 'f1' } }, ...many],
      [...many.map((h) => row(h.id))],
    );
    const found = await t.search.search({ q: 'here', scope, viewerId: 'u1' });
    expect(found.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    expect(t.read).toHaveLength(1); // one read for every candidate
  });
});
