import { formatDay, wallClock } from '../../lib/export-format';
import { displayText, findRanges, snippetAround, type SearchContact, type TaskSearchSource, type TextRange } from './task-search-text';
import { normalizeForSearch } from './text-normalize';

/** Where in a task a search matched. */
export type MatchField = 'title' | 'key' | 'description' | 'comment' | 'checklist' | 'assignee' | 'contact' | 'tag' | 'file';

export interface TaskMatch {
  field: MatchField;
  /** "Comment by Bilal · 28 Oct 2026", "Checklist item", "External contact"… */
  label: string;
  /** About 140 characters of that field around the match. */
  snippet: string;
  /** What to highlight in `snippet` (UTF-16 positions, end exclusive). */
  ranges: TextRange[];
}

export interface SearchPerson {
  firstName: string;
  lastName: string;
  username: string;
}

/** A task as it is now, for describing its matches (comments newest first). */
export interface TaskSearchLive extends TaskSearchSource {
  comments: { id: string; parentId: string | null; body: string; createdAt: Date; author: SearchPerson | null }[];
  checklist: { text: string; done: boolean }[];
}

/** A person's name as the apps write it: first and last, else the username. */
export function personLabel(p: SearchPerson | null | undefined): string {
  if (!p) return 'Someone';
  return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || p.username || 'Someone';
}

const contactLine = (c: SearchContact) => [c.name, c.company, c.designation, c.email, c.phone, c.remarks].map(displayText).filter(Boolean).join(' · ');

interface Candidate {
  field: MatchField;
  label: string;
  text: string;
  terms: Set<string>;
}

/**
 * Where the words matched in a task, from what it holds now: the title's matches (highlighted in the
 * title itself) and up to `max` other places — first those that hold the words not found yet, so
 * every word is accounted for, then the rest in reading order (description, newest comments,
 * checklist, assignees, external contacts, tags, files, keys it had). `complete` is false when a
 * word is nowhere in the task — the index was behind it, and the task is not a result.
 */
export function describeMatches(
  task: TaskSearchLive,
  terms: string[],
  { timeZone, max = 3 }: { timeZone: string; max?: number },
): { titleRanges: TextRange[]; matches: TaskMatch[]; complete: boolean; found: string[] } {
  const title = displayText(task.title);
  const day = (at: Date) => formatDay(wallClock(at, timeZone).slice(0, 10));
  const sources: Omit<Candidate, 'terms'>[] = [
    { field: 'description', label: 'Description', text: displayText(task.description) },
    ...task.comments.map((c) => ({
      field: 'comment' as const,
      label: `${c.parentId ? 'Reply' : 'Comment'} by ${personLabel(c.author)} · ${day(c.createdAt)}`,
      text: displayText(c.body),
    })),
    ...task.checklist.map((i) => ({ field: 'checklist' as const, label: 'Checklist item', text: displayText(i.text) })),
    ...task.assignees.map((a) => ({ field: 'assignee' as const, label: 'Assigned to', text: [personLabel(a), a.username].filter(Boolean).join(' · ') })),
    ...task.contacts.map((c) => ({ field: 'contact' as const, label: 'External contact', text: contactLine(c) })),
    ...task.tags.map((t) => ({ field: 'tag' as const, label: 'Tag', text: displayText(t.name) })),
    ...task.files.map((f) => ({ field: 'file' as const, label: 'File', text: displayText(f.filename) })),
    ...task.formerKeys.map((k) => ({ field: 'key' as const, label: 'Former key', text: displayText(k) })),
  ];
  const candidates: Candidate[] = [];
  for (const s of sources) {
    if (!s.text) continue;
    const n = normalizeForSearch(s.text);
    const found = new Set(terms.filter((t) => n.includes(t)));
    if (found.size) candidates.push({ ...s, terms: found });
  }
  const inTitle = (t: string) => normalizeForSearch(task.title).includes(t) || normalizeForSearch(task.key).includes(t);
  const missing = new Set(terms.filter((t) => !inTitle(t)));
  // Every word is in the title or the key: the highlighted title says it all, no other line is needed.
  const titleSaysAll = missing.size === 0;
  const picked: Candidate[] = [];
  while (picked.length < max && missing.size) {
    let best: Candidate | null = null;
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
  for (const c of candidates) {
    if (titleSaysAll || picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  // Shown in reading order, whatever order they were picked in.
  picked.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));

  const found = terms.filter((t) => inTitle(t) || candidates.some((c) => c.terms.has(t)));
  return {
    titleRanges: findRanges(title, terms),
    matches: picked.map((c) => ({ field: c.field, label: c.label, ...snippetAround(c.text, findRanges(c.text, [...c.terms])) })),
    complete: found.length === terms.length,
    found,
  };
}

