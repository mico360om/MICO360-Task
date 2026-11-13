import type { PrismaClient } from '@prisma/client';
import type { SearchAllInput, SearchAllResult } from './search-engine';
import type { SearchScopeAll } from './search-scope';
import { displayText } from './task-search-text';

/** One meeting in the top bar's Meetings group (GET /search → meetings: the website, the app and the extension read it). */
export interface SearchMeetingResult {
  id: string;
  title: string;
  projectId: string | null;
  /** A short excerpt around the match — or, found by its title, the start of the meeting (or the title). */
  snippet: string;
}

/** At most this many meetings are returned (the website, the app and the extension show six). */
export const TOP_BAR_MEETING_LIMIT = 10;
/** Notes read from the index for them: one meeting may be found by several of its notes. */
const NOTES_READ = 2 * TOP_BAR_MEETING_LIMIT;
/** How much of a meeting a title-only result shows. */
const PREVIEW_CHARS = 140;
/** Agenda items read for that preview. */
const PREVIEW_AGENDA = 5;

export interface TopBarMeetingsDeps {
  prisma: Pick<PrismaClient, 'meeting'>;
  engine: { search(input: SearchAllInput): Promise<SearchAllResult> };
}

export interface TopBarMeetingSearch {
  search(input: { q: string; scope: SearchScopeAll; viewerId: string }): Promise<SearchMeetingResult[]>;
}

/**
 * The top bar's meetings (review #22, #10 and N3, 13 Nov 2026): the meetings — by their title,
 * description, agenda, decisions and people, and by their notes — that hold every word, from the search
 * index (Arabic-normalised, part of a word too, as the results page), best first, at most
 * TOP_BAR_MEETING_LIMIT. Only meetings the person may open: `scope` is search-scope's, read for this
 * request (the meetings list's scope, with meeting-access.ts's companies rule — an attendee taken off a
 * meeting, or someone whose companies are all archived, finds nothing of it at once); someone invited from
 * another company finds a meeting by what that view shows (never its notes or decisions). Nothing about
 * who may see a meeting is kept between requests, and no fixed slice of the oldest meetings is read.
 */
export function createTopBarMeetings({ prisma, engine }: TopBarMeetingsDeps): TopBarMeetingSearch {
  async function search({ q, scope, viewerId }: { q: string; scope: SearchScopeAll; viewerId: string }): Promise<SearchMeetingResult[]> {
    // Whole matches only (no spelling or some-words pass), as the top bar's other kinds. The meetings
    // found themselves first, then those found by a note: one meeting's many notes never crowd the rest out.
    const [meetings, notes] = await Promise.all([
      engine.search({ q, scope, viewerId, kinds: ['meeting'], limit: TOP_BAR_MEETING_LIMIT, exactOnly: true }),
      engine.search({ q, scope, viewerId, kinds: ['note'], limit: NOTES_READ, exactOnly: true }),
    ]);
    const found = new Map<string, { snippet: string; title: string }>();
    for (const hit of [...meetings.hits, ...notes.hits]) {
      if (hit.match || hit.target.type !== 'meeting' || found.has(hit.target.meetingId)) continue;
      // A note found stands for its meeting (its title is the meeting's): where it matched is the snippet.
      found.set(hit.target.meetingId, { title: hit.title, snippet: hit.matches[0]?.snippet ?? '' });
    }
    if (found.size === 0) return [];
    // Each meeting's project, and the start of it for one found by its title alone (its description,
    // then its agenda: what everyone who may find it may see).
    const rows = await prisma.meeting.findMany({
      where: { id: { in: [...found.keys()] }, deletedAt: null },
      select: { id: true, projectId: true, description: true, agendaItems: { orderBy: { position: 'asc' }, take: PREVIEW_AGENDA, select: { title: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: SearchMeetingResult[] = [];
    for (const [id, f] of found) {
      const row = byId.get(id);
      if (!row) continue; // deleted meanwhile
      out.push({ id, title: f.title, projectId: row.projectId, snippet: f.snippet || preview([row.description, ...row.agendaItems.map((a) => a.title)]) || f.title });
      if (out.length >= TOP_BAR_MEETING_LIMIT) break;
    }
    return out;
  }
  return { search };
}

/** The first PREVIEW_CHARS characters of these texts, one after another. */
function preview(texts: (string | null)[]): string {
  const text = texts.map(displayText).filter(Boolean).join(' — ');
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trim()}…` : text;
}
