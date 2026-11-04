import type { PrismaClient } from '@prisma/client';
import { formatDay, wallClock } from '../../lib/export-format';
import { noteText } from '../../lib/rich-text';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import { checklistNames } from './search-docs';
import { readMinutesContent } from './search-index';
import { displayText, findRanges, snippetAround, type TextRange } from './task-search-text';
import { personLabel } from './task-search-matches';
import { normalizeForSearch } from './text-normalize';
import type { SearchHit, SearchKind, SearchMatch } from './search-types';
import type { IndexKind } from './search-docs';

/**
 * 1.23 Search everything — results as they are now: each item found is read again (a deleted or
 * changed one the index was behind on is left out, and re-indexed), with its title and the places
 * that hold the words highlighted, its project, state, date and people, and where it opens. A meeting
 * seen as an invitee from another company shows only what that view holds (never its decisions or
 * action items); notes and draft minutes never reach an invitee (the search scope leaves them out).
 */

const PROJECT_STATUS: Record<string, string> = { PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };
const MEETING_STATUS: Record<string, string> = { DRAFT: 'Draft', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const NOTE_TYPE: Record<string, string> = { DISCUSSION: 'Discussion', DECISION: 'Decision', ACTION: 'Action', ISSUE: 'Issue', QUESTION: 'Question', INFORMATION: 'Information' };
const meetingDone = (status: string) => status === 'COMPLETED' || status === 'CANCELLED';

interface Candidate {
  field: string;
  label: string;
  text: string;
}

/**
 * Where the words are in an item (as task-search-matches does for a task): the title's matches and up
 * to `max` other places — first those that hold words not found yet, then the rest in reading order.
 * `found`: the words found anywhere in it.
 */
export function describeItem(title: string, sources: Candidate[], terms: string[], max = 2): { titleRanges: TextRange[]; matches: SearchMatch[]; found: string[] } {
  const shownTitle = displayText(title);
  const inTitle = new Set(terms.filter((t) => normalizeForSearch(shownTitle).includes(t)));
  const candidates = sources
    .map((s) => ({ ...s, text: displayText(s.text) }))
    .filter((s) => s.text)
    .map((s) => {
      const n = normalizeForSearch(s.text);
      return { ...s, terms: new Set(terms.filter((t) => n.includes(t))) };
    })
    .filter((s) => s.terms.size > 0);
  const missing = new Set(terms.filter((t) => !inTitle.has(t)));
  const picked: typeof candidates = [];
  while (picked.length < max && missing.size) {
    let best: (typeof candidates)[number] | null = null;
    let bestCount = 0;
    for (const c of candidates) {
      if (picked.includes(c)) continue;
      const count = [...c.terms].filter((t) => missing.has(t)).length;
      if (count > bestCount) [best, bestCount] = [c, count];
    }
    if (!best) break;
    picked.push(best);
    for (const t of best.terms) missing.delete(t);
  }
  // Nothing in the title: one place at least shows where it matched.
  if (picked.length === 0 && candidates[0]) picked.push(candidates[0]);
  picked.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
  const found = terms.filter((t) => inTitle.has(t) || candidates.some((c) => c.terms.has(t)));
  return {
    titleRanges: findRanges(shownTitle, terms),
    matches: picked.map((c) => ({ field: c.field, label: c.label, ...snippetAround(c.text, findRanges(c.text, [...c.terms])) })),
    found,
  };
}

export interface DescribeContext {
  terms: string[];
  /** Which found words make an item a result. */
  accept: (found: string[]) => boolean;
  /** Meetings seen as an invitee (their limited view). */
  invitee: ReadonlySet<string>;
  timeZone: string;
  /** An item the index was behind on (re-index it). */
  onStale: (kind: IndexKind, id: string) => void;
}

type ProjectLook = NonNullable<SearchHit['project']>;

/** Each project's look and whether it is archived, for the results' project line. */
export async function projectLooks(prisma: PrismaClient, ids: (string | null | undefined)[]): Promise<Map<string, ProjectLook>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.project.findMany({ where: { id: { in: unique } }, select: { id: true, code: true, name: true, color: true, icon: true, imageUrl: true, ...ARCHIVE_SELECT } });
  return new Map(rows.map((p) => [p.id, { id: p.id, code: p.code, name: p.name, archived: archivedOf(p), color: p.color, icon: p.icon, imageUrl: p.imageUrl }]));
}

/** The non-task results of these kinds and ids, keyed `${kind}:${id}`. */
export async function describeIndexed(prisma: PrismaClient, items: { kind: Exclude<SearchKind, 'task'>; id: string }[], ctx: DescribeContext): Promise<Map<string, SearchHit>> {
  const out = new Map<string, SearchHit>();
  const ids = (kind: SearchKind) => items.filter((i) => i.kind === kind).map((i) => i.id);
  const day = (at: Date) => formatDay(wallClock(at, ctx.timeZone).slice(0, 10));
  const users = new Map<string, string>();
  const nameOf = (id: string | null | undefined) => (id ? users.get(id) : undefined);
  const loadNames = async (list: (string | null | undefined)[]) => {
    const want = [...new Set(list.filter((u): u is string => !!u && !users.has(u)))];
    if (want.length === 0) return;
    for (const u of await prisma.user.findMany({ where: { id: { in: want } }, select: { id: true, firstName: true, lastName: true, username: true } })) users.set(u.id, personLabel(u));
  };
  const keep = (kind: IndexKind, id: string, hit: Omit<SearchHit, 'kind' | 'id' | 'title' | 'titleRanges' | 'matches'>, title: string, sources: Candidate[], max = 2) => {
    const d = describeItem(title, sources, ctx.terms, max);
    if (!ctx.accept(d.found)) {
      ctx.onStale(kind, id);
      return;
    }
    out.set(`${kind}:${id}`, { kind, id, ...hit, title, titleRanges: d.titleRanges, matches: d.matches });
  };

  const [projects, meetings, notes, minutes, files, inspections] = await Promise.all([
    ids('project').length ? prisma.project.findMany({ where: { id: { in: ids('project') }, deletedAt: null }, select: { id: true, code: true, number: true, name: true, description: true, clientName: true, notes: true, status: true, createdAt: true, ownerId: true, managerId: true } }) : [],
    ids('meeting').length
      ? prisma.meeting.findMany({
          where: { id: { in: ids('meeting') }, deletedAt: null },
          select: { id: true, title: true, description: true, location: true, category: true, status: true, startAt: true, projectId: true, organizerId: true, agendaItems: { orderBy: { position: 'asc' }, select: { title: true } }, decisions: { select: { title: true, description: true } }, actionItems: { select: { description: true } }, attendees: { select: { userId: true, externalName: true } } },
        })
      : [],
    ids('note').length
      ? prisma.meetingNote.findMany({ where: { id: { in: ids('note') }, deletedAt: null, meeting: { deletedAt: null } }, select: { id: true, meetingId: true, authorId: true, type: true, body: true, bodyFormat: true, createdAt: true, comments: { select: { body: true } }, checklist: { orderBy: { position: 'asc' }, select: { text: true } }, meeting: { select: { title: true, status: true, projectId: true } } } })
      : [],
    ids('minutes').length ? prisma.meetingMinutes.findMany({ where: { meetingId: { in: ids('minutes') }, meeting: { deletedAt: null } }, select: { meetingId: true, content: true, status: true, approvedAt: true, generatedAt: true, meeting: { select: { title: true, projectId: true, organizerId: true } } } }) : [],
    ids('file').length
      ? prisma.attachment.findMany({ where: { id: { in: ids('file') }, task: { deletedAt: null } }, select: { id: true, taskId: true, filename: true, uploadedById: true, createdAt: true, searchText: { select: { text: true, method: true } }, task: { select: { key: true, title: true, projectId: true, completedAt: true, column: { select: { name: true, category: true } } } } } })
      : [],
    ids('inspection').length
      ? prisma.inspection.findMany({ where: { id: { in: ids('inspection') }, deletedAt: null }, select: { id: true, projectId: true, title: true, description: true, place: true, structure: true, status: true, inspectorId: true, startedAt: true, answers: { select: { note: true, reading: true } }, task: { select: { key: true, title: true } } } })
      : [],
  ]);
  await loadNames([...meetings.flatMap((m) => [m.organizerId, ...m.attendees.map((a) => a.userId)]), ...notes.map((n) => n.authorId), ...minutes.map((m) => m.meeting.organizerId), ...files.map((f) => f.uploadedById), ...inspections.map((i) => i.inspectorId)]);
  const looks = await projectLooks(prisma, [...projects.map((p) => p.id), ...meetings.map((m) => m.projectId), ...notes.map((n) => n.meeting.projectId), ...minutes.map((m) => m.meeting.projectId), ...files.map((f) => f.task.projectId), ...inspections.map((i) => i.projectId)]);
  const look = (id: string | null | undefined) => (id ? (looks.get(id) ?? null) : null);

  for (const p of projects) {
    keep(
      'project',
      p.id,
      { key: p.code, project: look(p.id), status: { label: PROJECT_STATUS[p.status] ?? p.status, category: p.status, done: p.status === 'COMPLETED' || p.status === 'ARCHIVED' }, date: { at: p.createdAt.toISOString(), kind: 'created' }, people: null, target: { type: 'project', projectId: p.id } },
      p.name,
      [
        { field: 'code', label: 'Project code', text: [p.code, p.number].filter(Boolean).join(' · ') },
        { field: 'description', label: 'Description', text: p.description ?? '' },
        { field: 'client', label: 'Client', text: p.clientName ?? '' },
        { field: 'notes', label: 'Notes', text: p.notes ?? '' },
      ],
    );
  }

  for (const m of meetings) {
    const limited = ctx.invitee.has(m.id);
    const people = [...new Set([nameOf(m.organizerId), ...m.attendees.map((a) => (a.userId ? nameOf(a.userId) : a.externalName))].filter((n): n is string => !!n))];
    keep(
      'meeting',
      m.id,
      {
        project: look(m.projectId),
        status: { label: MEETING_STATUS[m.status] ?? m.status, category: m.status, done: meetingDone(m.status) },
        date: { at: m.startAt.toISOString(), kind: 'starts' },
        people: nameOf(m.organizerId) ? { names: [nameOf(m.organizerId)!], count: 1 } : null,
        target: { type: 'meeting', meetingId: m.id },
      },
      m.title,
      [
        { field: 'description', label: 'Description', text: m.description ?? '' },
        ...m.agendaItems.map((a) => ({ field: 'agenda', label: 'Agenda item', text: a.title })),
        { field: 'place', label: 'Place', text: m.location ?? '' },
        { field: 'category', label: 'Category', text: m.category ?? '' },
        ...people.map((n) => ({ field: 'person', label: 'Person', text: n })),
        // The full view only: never what an invitee from another company may not see.
        ...(limited ? [] : m.decisions.map((d) => ({ field: 'decision', label: 'Decision', text: [d.title, d.description].filter(Boolean).join(' — ') }))),
        ...(limited ? [] : m.actionItems.map((a) => ({ field: 'action', label: 'Action item', text: a.description }))),
      ],
    );
  }

  for (const n of notes) {
    keep(
      'note',
      n.id,
      {
        context: n.meeting.title,
        project: look(n.meeting.projectId),
        status: { label: MEETING_STATUS[n.meeting.status] ?? n.meeting.status, category: n.meeting.status, done: meetingDone(n.meeting.status) },
        date: { at: n.createdAt.toISOString(), kind: 'written' },
        people: nameOf(n.authorId) ? { names: [nameOf(n.authorId)!], count: 1 } : null,
        target: { type: 'meeting', meetingId: n.meetingId, noteId: n.id },
      },
      n.meeting.title,
      [
        { field: 'note', label: `${NOTE_TYPE[n.type] ?? 'Note'} note by ${nameOf(n.authorId) ?? 'Someone'} · ${day(n.createdAt)}`, text: noteText(n) },
        ...n.comments.map((c) => ({ field: 'comment', label: 'Comment on the note', text: c.body })),
        ...n.checklist.map((c) => ({ field: 'checklist', label: 'Checklist item', text: c.text })),
      ],
    );
  }

  for (const r of minutes) {
    const c = readMinutesContent(r.content);
    const final = r.status === 'APPROVED';
    keep(
      'minutes',
      r.meetingId,
      {
        context: final ? 'Final minutes' : 'Draft minutes',
        project: look(r.meeting.projectId),
        status: { label: final ? 'Final' : 'Draft', category: final ? 'APPROVED' : 'DRAFT', done: final },
        date: final && r.approvedAt ? { at: r.approvedAt.toISOString(), kind: 'approved' } : { at: r.generatedAt.toISOString(), kind: 'saved' },
        people: nameOf(r.meeting.organizerId) ? { names: [nameOf(r.meeting.organizerId)!], count: 1 } : null,
        target: { type: 'meeting', meetingId: r.meetingId, section: 'minutes' },
      },
      r.meeting.title,
      [
        { field: 'summary', label: 'Summary', text: c.summary },
        ...c.discussion.flatMap((d) => [{ field: 'discussion', label: `Discussion · ${d.topic}`, text: d.text }, { field: 'discussion', label: 'Discussion', text: d.topic }]),
        ...c.decisions.map((d) => ({ field: 'decision', label: 'Decision', text: d })),
        ...c.risks.map((d) => ({ field: 'risk', label: 'Risk or open issue', text: d })),
        ...c.nextSteps.map((d) => ({ field: 'next', label: 'Next step', text: d })),
      ],
    );
  }

  for (const f of files) {
    const done = f.task.completedAt !== null || f.task.column.category === 'DONE';
    keep(
      'file',
      f.id,
      {
        key: f.task.key,
        context: `${f.task.key} ${f.task.title}`,
        project: look(f.task.projectId),
        status: { label: f.task.column.name, category: f.task.column.category, done },
        date: { at: f.createdAt.toISOString(), kind: 'added' },
        people: nameOf(f.uploadedById) ? { names: [nameOf(f.uploadedById)!], count: 1 } : null,
        target: { type: 'file', taskId: f.taskId, fileId: f.id },
      },
      f.filename,
      [{ field: 'file-text', label: f.searchText?.method === 'ocr' ? 'Text in the file (read by AI)' : 'Text in the file', text: f.searchText?.text ?? '' }],
      1,
    );
  }

  for (const i of inspections) {
    keep(
      'inspection',
      i.id,
      {
        ...(i.task ? { key: i.task.key, context: `${i.task.key} ${i.task.title}` } : {}),
        project: look(i.projectId),
        status: { label: i.status === 'FINISHED' ? 'Finished' : 'In progress', category: i.status, done: i.status === 'FINISHED' },
        date: { at: i.startedAt.toISOString(), kind: 'started' },
        people: nameOf(i.inspectorId) ? { names: [nameOf(i.inspectorId)!], count: 1 } : null,
        target: { type: 'inspection', inspectionId: i.id },
      },
      i.title,
      [
        { field: 'description', label: 'Description', text: i.description ?? '' },
        { field: 'place', label: 'Place', text: i.place ?? '' },
        ...checklistNames(i.structure).map((t) => ({ field: 'checklist', label: 'Checklist item', text: t })),
        ...i.answers.flatMap((a) => [{ field: 'answer', label: 'Inspector’s note', text: a.note ?? '' }, { field: 'answer', label: 'Reading', text: a.reading ?? '' }]),
        ...(i.task ? [{ field: 'task', label: 'Task', text: `${i.task.key} ${i.task.title}` }] : []),
      ],
    );
  }
  return out;
}
