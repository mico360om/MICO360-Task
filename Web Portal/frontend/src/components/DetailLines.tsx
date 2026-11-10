import type { ReactNode } from 'react';
import type { HighlightRange } from '../lib/search-highlight';
import { Highlighted } from './ui/Highlighted';

/**
 * 1.23.8 Detailed rows and cards (lib/density): the extra lines a task shows there — the description's first
 * line, its tags and everyone on it, by name. Shared by the board's cards and the lists' rows, so they read the
 * same everywhere. Each draws nothing when there is nothing to say.
 */

/** A description's first line with words: plain text (a stray tag or extra spaces taken out), at most 200 letters. */
export function descriptionFirstLine(description: string | null | undefined): string {
  if (!description) return '';
  const line = description
    .replace(/<[^>]*>/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .find(Boolean);
  if (!line) return '';
  return line.length > 200 ? `${line.slice(0, 199).trimEnd()}…` : line;
}

/** `as="span"`: inside a button (a row that is one button), where only inline content may go. */
type LineTag = 'p' | 'span';

export function DescriptionLine({ description, className = '', as: Tag = 'p' }: { description: string | null | undefined; className?: string; as?: LineTag }) {
  const line = descriptionFirstLine(description);
  if (!line) return null;
  return (
    <Tag data-testid="card-description" dir="auto" className={`block truncate text-start text-xs text-ink-2 ${className}`}>
      {line}
    </Tag>
  );
}

/** The checklist's count ("2/5", ticked of all) — said in full to screen readers. */
export function ChecklistCount({ counts, className = '' }: { counts?: { checklistDone: number; checklistTotal: number } | null; className?: string }) {
  if (!counts || counts.checklistTotal <= 0) return null;
  return (
    <span data-testid="card-checklist" className={`inline-flex items-center gap-1 text-[11px] text-ink-2 ${className}`}>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-ink-3">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
      <span className="sr-only">Checklist: </span>
      {counts.checklistDone}/{counts.checklistTotal}
      <span className="sr-only"> done</span>
    </span>
  );
}

export interface TagLike {
  id: string;
  name: string;
  color: string;
}

/**
 * The task's tags: a small chip each, with the tag's own colour as a dot (a tag's colour is the person's choice).
 * `marked` (board search, 10 Nov): the ids of the tags that hold a word searched for, marked as found words are.
 */
export function TagChips({ tags, className = '', marked }: { tags: TagLike[] | null | undefined; className?: string; marked?: readonly string[] }) {
  if (!tags?.length) return null;
  return (
    <span data-testid="card-tags" className={`flex flex-wrap gap-1 ${className}`}>
      {tags.map((g) => (
        <span
          key={g.id}
          {...(marked?.includes(g.id) ? { 'data-marked': '' } : {})}
          className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${marked?.includes(g.id) ? 'bg-warning-soft font-semibold text-ink' : 'bg-ground font-medium text-ink-2'}`}
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: g.color }} />
          <span dir="auto" className="truncate">{g.name}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Everyone on it, by name (the faces beside it show at most three). `found` (board search, 10 Nov): where
 * the words searched for are in each person's name, marked.
 */
export function PeopleLine({
  people,
  className = '',
  icon,
  as: Tag = 'p',
  found,
}: {
  people: { id: string; name: string }[] | null | undefined;
  className?: string;
  icon?: ReactNode;
  as?: LineTag;
  found?: readonly { id: string; ranges: HighlightRange[] }[];
}) {
  if (!people?.length) return null;
  return (
    <Tag data-testid="card-people" className={`flex items-start gap-1 text-[11px] leading-snug text-ink-2 ${className}`}>
      {icon ?? (
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none text-ink-3">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <path d="M16 4.5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" />
        </svg>
      )}
      <span className="sr-only">Assigned to </span>
      <span dir="auto" className="min-w-0">
        {found?.length
          ? people.map((p, i) => (
              <span key={p.id}>
                {i > 0 ? ', ' : null}
                <Highlighted text={p.name} ranges={found.find((f) => f.id === p.id)?.ranges} />
              </span>
            ))
          : people.map((p) => p.name).join(', ')}
      </span>
    </Tag>
  );
}
