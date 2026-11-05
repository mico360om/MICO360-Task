import { noteText } from '../../lib/rich-text';
import type { FinalMinutesContent } from '../meetings/final-minutes';
import { normalizeForSearch } from './text-normalize';

/**
 * 1.23 Search everything: the normalised text each kind of item is indexed under (search_index), built
 * the way a task's is (task-search-text): `head` is a line break and the title lines (a project's code
 * and number too), `lead` its main text, `doc` the head then everything it is found by, one item per
 * line (a phrase never runs from one item into the next). A meeting also has `limited`: what someone
 * invited from another company may search of it (never its decisions or action items).
 */

/** Bump when what goes into a document (or how it is normalised) changes: every item is re-indexed. */
export const SEARCH_DOC_VERSION = 1;

/** The kinds of item search_index holds (tasks have their own index). */
export const INDEX_KINDS = ['project', 'meeting', 'note', 'minutes', 'file', 'inspection'] as const;
export type IndexKind = (typeof INDEX_KINDS)[number];

/** A very long item is indexed up to this many characters. */
const MAX_DOC_CHARS = 2_000_000;

export interface SearchDoc {
  head: string;
  lead: string;
  doc: string;
  limited?: string;
}

type Text = string | null | undefined;
const lines = (items: Text[]) => items.map(normalizeForSearch).filter(Boolean);
const cap = (s: string) => (s.length > MAX_DOC_CHARS ? s.slice(0, MAX_DOC_CHARS) : s);

function build(headItems: Text[], lead: Text, rest: Text[]): SearchDoc {
  const head = `\n${lines(headItems).join('\n')}`;
  const leadText = normalizeForSearch(lead);
  const body = [leadText, ...lines(rest)].filter(Boolean).join('\n');
  return { head, lead: leadText, doc: cap(body ? `${head}\n${body}` : head) };
}

export function projectDoc(p: { code: string; number: Text; name: string; description: Text; clientName: Text; notes: Text }): SearchDoc {
  return build([p.code, p.number, p.name], p.description, [p.clientName, p.notes]);
}

export interface MeetingDocSource {
  title: string;
  description: Text;
  location: Text;
  category: Text;
  agenda: string[];
  /** Its people by name (accounts and guests). */
  people: string[];
  decisions: { title: string; description: Text }[];
  actionItems: string[];
}

export function meetingDoc(m: MeetingDocSource): SearchDoc {
  const shared: Text[] = [...m.agenda, m.location, m.category, ...m.people];
  const full = build([m.title], m.description, [...shared, ...m.decisions.flatMap((d) => [d.title, d.description]), ...m.actionItems]);
  const limited = build([m.title], m.description, shared);
  return { ...full, limited: limited.doc };
}

export function noteDoc(n: { body: string; bodyFormat?: 'PLAIN' | 'RICH' | null; comments: string[]; checklist: string[] }): SearchDoc {
  return build([], noteText(n), [...n.comments, ...n.checklist]);
}

export function minutesDoc(c: FinalMinutesContent): SearchDoc {
  return build([], c.summary, [...c.discussion.flatMap((d) => [d.topic, d.text]), ...c.decisions, ...c.risks, ...c.nextSteps]);
}

export function fileDoc(f: { filename: string; text: Text }): SearchDoc {
  return build([f.filename], f.text, []);
}

export interface InspectionDocSource {
  title: string;
  description: Text;
  place: Text;
  structure: unknown;
  answers: { note: Text; reading: Text }[];
  task: { key: string; title: string } | null;
}

/** The section titles and item names of an inspection's copied checklist (whatever shape it has). */
export function checklistNames(structure: unknown): string[] {
  const sections = (structure && typeof structure === 'object' ? (structure as { sections?: unknown }).sections : null) ?? [];
  if (!Array.isArray(sections)) return [];
  const out: string[] = [];
  for (const s of sections) {
    if (!s || typeof s !== 'object') continue;
    const sec = s as { title?: unknown; items?: unknown };
    if (typeof sec.title === 'string') out.push(sec.title);
    for (const it of Array.isArray(sec.items) ? sec.items : []) {
      const item = it as { label?: unknown; help?: unknown } | null;
      if (typeof item?.label === 'string') out.push(item.label);
      if (typeof item?.help === 'string') out.push(item.help);
    }
  }
  return out;
}

export function inspectionDoc(i: InspectionDocSource): SearchDoc {
  return build([i.title], i.description, [i.place, ...checklistNames(i.structure), ...i.answers.flatMap((a) => [a.note, a.reading]), i.task?.key, i.task?.title]);
}

/** Words for the spelling-mistake pass, from a normalised text: letters only, 3–40 of them, each once (at most 5,000). */
export function vocabularyWords(normalized: string): string[] {
  const seen = new Set<string>();
  for (const w of normalized.split(/[^\p{L}\p{M}]+/u)) {
    if (w.length < 3 || w.length > 40 || /\p{N}/u.test(w)) continue;
    seen.add(w);
    if (seen.size >= 5000) break;
  }
  return [...seen];
}
