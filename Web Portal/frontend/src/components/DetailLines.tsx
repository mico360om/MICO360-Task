import type { ReactNode } from 'react';

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

export function DescriptionLine({ description, className = '' }: { description: string | null | undefined; className?: string }) {
  const line = descriptionFirstLine(description);
  if (!line) return null;
  return (
    <p data-testid="card-description" dir="auto" className={`truncate text-start text-xs text-ink-2 ${className}`}>
      {line}
    </p>
  );
}

export interface TagLike {
  id: string;
  name: string;
  color: string;
}

/** The task's tags: a small chip each, with the tag's own colour as a dot (a tag's colour is the person's choice). */
export function TagChips({ tags, className = '' }: { tags: TagLike[] | null | undefined; className?: string }) {
  if (!tags?.length) return null;
  return (
    <span data-testid="card-tags" className={`flex flex-wrap gap-1 ${className}`}>
      {tags.map((g) => (
        <span key={g.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-[11px] font-medium text-ink-2">
          <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: g.color }} />
          <span dir="auto" className="truncate">{g.name}</span>
        </span>
      ))}
    </span>
  );
}

/** Everyone on it, by name (the faces beside it show at most three). */
export function PeopleLine({ people, className = '', icon }: { people: { id: string; name: string }[] | null | undefined; className?: string; icon?: ReactNode }) {
  if (!people?.length) return null;
  return (
    <p data-testid="card-people" className={`flex items-start gap-1 text-[11px] leading-snug text-ink-2 ${className}`}>
      {icon ?? (
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none text-ink-3">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <path d="M16 4.5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" />
        </svg>
      )}
      <span className="sr-only">Assigned to </span>
      <span dir="auto" className="min-w-0">{people.map((p) => p.name).join(', ')}</span>
    </p>
  );
}
