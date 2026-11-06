import { Link } from 'react-router-dom';
import { Highlighted } from '../ui/Highlighted';
import { ProjectAvatar } from '../ProjectAvatar';
import { FoundTaskKey } from '../TaskKey';
import { KindIcon } from './KindIcon';
import { STATUS_META } from '../../lib/taskStatus';
import { isOverdue } from '../../lib/due-date';
import { CONTACT_SUB_LABEL, KIND_META, dateLabel, targetLink, type SearchHit } from '../../lib/search-everything';
import { DENSE_FACE, DENSE_TEXT } from '../../lib/density-tokens';

/** "Bilal Ahmed +2", or nothing. */
function peopleLine(hit: SearchHit): string | null {
  const first = hit.people?.names[0];
  if (!first) return null;
  const more = (hit.people?.count ?? 1) - 1;
  return more > 0 ? `${first} +${more}` : first;
}

const MATCH_WORDS = { close: 'Close match', some: 'Some of the words' } as const;

/**
 * One search result (any kind): its kind, number and title with the words marked, what it belongs to,
 * its project (with its picture), state, date and people, and up to two places it matched. A task or a
 * file opens in the task panel (`onOpen`); everything else is a link to its page (open it in a new tab
 * too). `compact`: fewer lines (the AI panel's best matches).
 */
export function ResultRow({ hit, timeZone, onOpen, compact = false }: { hit: SearchHit; timeZone: string; onOpen: (hit: SearchHit) => void; compact?: boolean }) {
  const to = targetLink(hit);
  // 1.23.6: a "Clients & contacts" result says which of the three it is.
  const kindLabel = hit.kind === 'contact' && hit.sub ? CONTACT_SUB_LABEL[hit.sub] : KIND_META[hit.kind].label;
  const date = dateLabel(hit, timeZone);
  const late = (hit.kind === 'task' || hit.kind === 'checklist') && hit.date?.kind === 'due' && !hit.status?.done && isOverdue(hit.date.at, timeZone);
  const dot = hit.kind === 'task' || hit.kind === 'file' || (hit.kind === 'contact' && hit.sub === 'external') ? STATUS_META[hit.status?.category ?? '']?.color : undefined;
  const people = peopleLine(hit);
  const body = (
    <>
      <KindIcon kind={hit.kind} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-1 compact:gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{kindLabel}</span>
          {hit.key && hit.kind === 'task' ? <FoundTaskKey value={hit.key} former={hit.formerKeys} dense="compact" /> : null}
          <span dir="auto" data-result-title className={`min-w-0 text-sm font-semibold [overflow-wrap:anywhere] ${DENSE_TEXT} ${hit.status?.done ? 'text-ink-2' : 'text-ink'}`}>
            <Highlighted text={hit.title} ranges={hit.titleRanges} />
          </span>
          {hit.match ? <span className="rounded-md bg-ground px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{MATCH_WORDS[hit.match]}</span> : null}
        </span>
        {/* A file's or an inspection's task (a note's and the minutes' meeting is their title). */}
        {hit.context && (hit.kind === 'file' || hit.kind === 'inspection') ? (
          <span dir="auto" className="block text-xs text-ink-2 [overflow-wrap:anywhere]">
            Task {hit.context}
          </span>
        ) : null}
        {/* 1.23.6: a checklist item's task and checklist; a contact's task; how many projects name a client. */}
        {hit.context && (hit.kind === 'checklist' || hit.kind === 'contact') ? (
          <span dir="auto" className="block text-xs text-ink-2 [overflow-wrap:anywhere]">
            {hit.kind === 'checklist' ? `Task ${hit.context}` : hit.context}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-2">
          {hit.project ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <ProjectAvatar project={{ name: hit.project.name, color: hit.project.color, icon: hit.project.icon, imageUrl: hit.project.imageUrl }} size="sm" className={DENSE_FACE} />
              <span dir="auto" className="truncate">{hit.project.archived ? `${hit.project.name} (archived)` : hit.project.name}</span>
            </span>
          ) : null}
          {hit.status ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ink-3" style={dot ? { backgroundColor: dot } : undefined} />
              <span dir="auto">{hit.status.label}</span>
            </span>
          ) : null}
          {date ? <span className={late ? 'text-danger' : undefined}>{date}</span> : null}
          {people && !compact ? <span dir="auto">{people}</span> : null}
        </span>
        {(compact ? hit.matches.slice(0, 1) : hit.matches).map((m, i) => (
          <span key={i} dir="auto" className="block text-xs text-ink-3 [overflow-wrap:anywhere]">
            <span className="font-medium text-ink-2">{m.label}: </span>
            <Highlighted text={m.snippet} ranges={m.ranges} />
          </span>
        ))}
      </span>
    </>
  );
  // Compact rows (1.23.0, lib/density): a third less padding, the title a step smaller, smaller chips and pictures.
  const look = `flex w-full items-start gap-3 rounded-lg border border-line bg-surface p-3 text-start transition-colors compact:gap-2 compact:p-2 hover:bg-ground focus-visible:bg-ground [@media(pointer:coarse)]:!min-h-11`;
  return to ? (
    <Link to={to} data-result={`${hit.kind}:${hit.id}`} className={look}>
      {body}
    </Link>
  ) : (
    <button type="button" data-result={`${hit.kind}:${hit.id}`} onClick={() => onOpen(hit)} className={look}>
      {body}
    </button>
  );
}
