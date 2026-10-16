import { ValidationError } from '../../lib/http-errors';
import { fmtDate, fmtDay, fmtTimeRange, resolveMinutesTimeZone, type MinutesData } from './minutes';

/**
 * The final minutes of a meeting (the "Final MOM"): what an organizer approves and sends, as
 * opposed to the working minutes printed straight from the notes. Drafted by the AI or from the
 * notes, edited by the organizer, then marked final.
 */
export interface FinalMinutesContent {
  summary: string;
  /** What was discussed, per agenda item (and "Other points"). */
  discussion: Array<{ topic: string; text: string }>;
  decisions: string[];
  /** Risks, issues and open questions. */
  risks: string[];
  nextSteps: string[];
}

const SUMMARY_MAX = 4000;
const TOPIC_MAX = 200;
const TEXT_MAX = 4000;
const ITEM_MAX = 500;
const LIST_MAX = 40;
const TOPICS_MAX = 30;
/** The facts given to the AI are capped, so a huge meeting can't make a huge (paid) prompt. */
const FACTS_MAX = 12_000;

const OTHER = 'Other points';
const isOpen = (i: NonNullable<MinutesData['actionItems']>[number]) => i.open ?? !/^(completed|cancelled)$/i.test(i.statusLabel);
const present = (label: string) => /^(present|late)$/i.test(label);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A first draft without AI: each section filled from the meeting's own notes, agenda and action items. */
export function draftFromNotes(data: MinutesData): FinalMinutesContent {
  const tz = resolveMinutesTimeZone(data.meeting.timeZone, data.companyTimeZone);
  const notes = data.notes;
  const decisions = notes.filter((n) => n.type === 'DECISION').map((n) => n.body.trim());
  const presentCount = data.attendees.filter((a) => present(a.attendanceLabel)).length;
  const covered = data.agenda.filter((a) => a.completed).length;
  const summary =
    data.meeting.description?.trim() ||
    `${data.meeting.title} on ${fmtDate(data.meeting.startAt, tz)}: ${presentCount} of ${plural(data.attendees.length, 'attendee')} present, ` +
      `${covered} of ${plural(data.agenda.length, 'agenda item')} covered, ${plural(decisions.length, 'decision')}.`;

  // Discussion and information notes, under the agenda item they were taken for (in agenda order).
  const talk = notes.filter((n) => n.type === 'DISCUSSION' || n.type === 'INFORMATION');
  const topics = data.agenda.map((a) => a.title);
  const discussion: FinalMinutesContent['discussion'] = [];
  for (const topic of [...topics, OTHER]) {
    const under = talk.filter((n) => (topic === OTHER ? !n.agendaTitle || !topics.includes(n.agendaTitle) : n.agendaTitle === topic));
    if (under.length) discussion.push({ topic, text: under.map((n) => n.body.trim()).join('\n') });
  }

  const risks = [
    ...notes.filter((n) => n.type === 'ISSUE').map((n) => n.body.trim()),
    ...notes.filter((n) => n.type === 'QUESTION').map((n) => `Open question: ${n.body.trim()}`),
  ];
  const nextSteps = [
    ...(data.actionItems ?? [])
      .filter(isOpen)
      .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'))
      .map((i) => `${i.description} — ${i.ownerName || 'unassigned'}${i.dueDate ? `, by ${fmtDay(i.dueDate, 'UTC')}` : ''}`),
    ...notes.filter((n) => n.type === 'ACTION' && !n.trackedAsActionItem).map((n) => n.body.trim()),
  ];
  return normalizeFinalMinutes({ summary, discussion, decisions, risks, nextSteps });
}

/** The meeting as plain facts for the AI to write the final minutes from (bounded in size). */
export function minutesFacts(data: MinutesData): string {
  const tz = resolveMinutesTimeZone(data.meeting.timeZone, data.companyTimeZone);
  const m = data.meeting;
  const names = (pick: (label: string) => boolean) => data.attendees.filter((a) => pick(a.attendanceLabel)).map((a) => a.name);
  const lines: string[] = [
    `Meeting: ${m.title}`,
    `Date: ${fmtDate(m.startAt, tz)}, ${fmtTimeRange(m.startAt, m.endAt, tz)} (${tz})`,
  ];
  if (data.project) {
    const ids = [data.project.code, data.project.number].filter(Boolean).join(', ');
    lines.push(`Project: ${data.project.name}${ids ? ` (${ids})` : ''}`);
  }
  if (m.organizerName) lines.push(`Organizer: ${m.organizerName}`);
  if (m.description?.trim()) lines.push(`Purpose: ${m.description.trim()}`);
  const here = names(present);
  const away = names((l) => /^(absent|excused)$/i.test(l));
  const unknown = names((l) => !present(l) && !/^(absent|excused)$/i.test(l));
  if (here.length) lines.push(`Present: ${here.join(', ')}`);
  if (away.length) lines.push(`Absent: ${away.join(', ')}`);
  if (unknown.length) lines.push(`Attendance not recorded: ${unknown.join(', ')}`);
  if (data.agenda.length) {
    lines.push('Agenda:');
    data.agenda.forEach((a, i) => lines.push(`${i + 1}. ${a.title} (${a.presenterName ? `presenter ${a.presenterName}, ` : ''}${a.completed ? 'covered' : 'not covered'})`));
  }
  if (data.notes.length) {
    lines.push('Notes:');
    for (const n of data.notes) {
      const tags = [n.typeLabel, n.agendaTitle ? `agenda "${n.agendaTitle}"` : null, n.highlighted ? 'key point' : null].filter(Boolean).join(', ');
      lines.push(`[${tags}] ${n.body.trim()}`);
    }
  }
  const open = (data.actionItems ?? []).filter(isOpen);
  if (open.length) {
    lines.push('Open action items:');
    for (const i of open) lines.push(`- ${i.description} — owner ${i.ownerName || 'unassigned'}, due ${i.dueDate ?? 'none'}, ${i.statusLabel}`);
  }
  const facts = lines.join('\n');
  return facts.length > FACTS_MAX ? `${facts.slice(0, FACTS_MAX)}\n(… the rest of the notes are left out)` : facts;
}

const clip = (s: string, n: number) => s.slice(0, n);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A list section: an array of strings or one string with a line per item; blanks dropped, sizes capped. */
function list(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : [];
  return items
    .map(str)
    .filter(Boolean)
    .map((s) => clip(s, ITEM_MAX))
    .slice(0, LIST_MAX);
}

/** Final minutes as saved: every section present, trimmed, blank entries dropped and sizes capped. */
export function normalizeFinalMinutes(input: unknown): FinalMinutesContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('The minutes are not in the expected form.');
  const v = input as Record<string, unknown>;
  const discussion = (Array.isArray(v.discussion) ? v.discussion : [])
    .map((d) => (d && typeof d === 'object' ? (d as Record<string, unknown>) : {}))
    .map((d) => ({ topic: clip(str(d.topic), TOPIC_MAX), text: clip(str(d.text), TEXT_MAX) }))
    .filter((d) => d.topic || d.text)
    .map((d) => ({ topic: d.topic || 'Discussion', text: d.text }))
    .slice(0, TOPICS_MAX);
  return {
    summary: clip(str(v.summary), SUMMARY_MAX),
    discussion,
    decisions: list(v.decisions),
    risks: list(v.risks),
    nextSteps: list(v.nextSteps),
  };
}
