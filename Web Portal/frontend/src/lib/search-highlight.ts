/**
 * Showing task search results (GET /search and GET /search/tasks): the server says where the words
 * are — `ranges` in a title or a match's snippet — and the apps cut the text into plain and
 * highlighted pieces, drawn as text (never as HTML).
 */

/** [start, end) in the text's own (UTF-16) positions. */
export interface HighlightRange {
  start: number;
  end: number;
}

export interface HighlightPart {
  text: string;
  /** One of the words searched for. */
  hit: boolean;
}

/** Where a task matched, as the server describes it. */
export interface TaskSearchMatch {
  field: 'title' | 'key' | 'description' | 'comment' | 'checklist' | 'assignee' | 'contact' | 'tag' | 'file';
  /** "Comment by Bilal · 28 Oct 2026", "Checklist item", "External contact"… */
  label: string;
  /** About 140 characters around the match. */
  snippet: string;
  ranges: HighlightRange[];
}

/** One task found (GET /search's tasks, GET /search/tasks's data). */
export interface TaskSearchHit {
  id: string;
  key: string;
  formerKeys?: string[];
  title: string;
  titleRanges?: HighlightRange[];
  projectId: string;
  project?: { id: string; code: string; name: string; archived: boolean };
  status?: { columnId: string; name: string; category: string };
  done?: boolean;
  dueDate?: string | null;
  assignees?: { id: string; name: string }[];
  assigneeCount?: number;
  matches?: TaskSearchMatch[];
  external?: string[];
}

const isRange = (r: unknown): r is HighlightRange =>
  !!r && typeof r === 'object' && Number.isInteger((r as HighlightRange).start) && Number.isInteger((r as HighlightRange).end);

/**
 * The text in pieces, highlighted where the ranges say: ranges are sorted, joined where they touch
 * or overlap, clipped to the text; broken, empty or backwards ones are ignored.
 */
export function highlightParts(text: string, ranges: readonly HighlightRange[] | null | undefined): HighlightPart[] {
  const s = typeof text === 'string' ? text : '';
  if (!s) return [];
  const clean = (Array.isArray(ranges) ? ranges : [])
    .filter(isRange)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(s.length, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRange[] = [];
  for (const r of clean) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const parts: HighlightPart[] = [];
  let at = 0;
  for (const r of merged) {
    if (r.start > at) parts.push({ text: s.slice(at, r.start), hit: false });
    parts.push({ text: s.slice(r.start, r.end), hit: true });
    at = r.end;
  }
  if (at < s.length) parts.push({ text: s.slice(at), hit: false });
  return parts;
}

/** A match as one line: "Comment by Bilal · 28 Oct 2026: …the scaffold permit…". */
export function matchText(m: Pick<TaskSearchMatch, 'label' | 'snippet'>): string {
  return `${m.label}: ${m.snippet}`;
}

/** The full results' filters, as the website's /search address keeps them. */
export interface ResultsFilters {
  q: string;
  projectId?: string;
  /** A column category (TODO, IN_PROGRESS…). */
  status?: string;
  /** A person's id, or "me". */
  assigneeId?: string;
  /** true: finished only; false: open only. */
  done?: boolean;
  /** Include archived projects. */
  archived?: boolean;
}

/** The query of the website's Search results address ("q=…&project=…"), only what is set. */
export function resultsQuery(f: ResultsFilters): string {
  const p = new URLSearchParams();
  p.set('q', String(f.q ?? '').trim());
  if (f.projectId) p.set('project', f.projectId);
  if (f.status) p.set('status', f.status);
  if (f.assigneeId) p.set('assignee', f.assigneeId);
  if (f.done !== undefined) p.set('done', String(f.done));
  if (f.archived) p.set('archived', 'true');
  return p.toString();
}
