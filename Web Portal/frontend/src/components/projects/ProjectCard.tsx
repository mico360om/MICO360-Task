import { Fragment, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProjectOverview, ProjectStatus } from '../../api/projects';
import { ProjectAvatar } from '../ProjectAvatar';
import { Avatar } from '../ui/Avatar';
import { ActionMenu, type ActionMenuItem } from '../meeting/ActionMenu';
import { ProjectStatusMenu } from './ProjectStatusMenu';
import { nextDueLabel, progressOf, targetLabel, updatedLabel } from '../../lib/project-list';

export interface ProjectCardProps {
  project: ProjectOverview;
  /** Today's 'YYYY-MM-DD' in the company time zone. */
  today: string;
  now: Date;
  timeZone: string;
  /** Change the status (people who may); without it the status is a plain label. */
  onChangeStatus?: (project: ProjectOverview, status: ProjectStatus) => void;
  /** Open the project's edit form (people who may). */
  onEdit?: (project: ProjectOverview) => void;
  /** Ask to archive the project (people who may). */
  onArchive?: (project: ProjectOverview) => void;
}

/** How many team faces show before "+N". */
const FACES = 4;

const MORE_BUTTON =
  'grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 transition-colors hover:border-brand/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

function Figure({ label, children, late }: { label: string; children: ReactNode; late?: boolean }) {
  return (
    // The value shows above its label; the label comes first for screen readers.
    <div className="flex min-w-0 flex-col-reverse px-4 py-2.5">
      <dt className="truncate text-[11px] text-ink-2">{label}</dt>
      <dd data-late={late === undefined ? undefined : String(late)} className={`truncate font-display text-lg font-bold tabular-nums leading-tight ${late ? 'text-danger' : 'text-ink'}`}>
        {children}
      </dd>
    </div>
  );
}

/**
 * A project on the Projects page: its colour, picture and name; under the name its status (a menu
 * for those who may change it) and code · number · client; "⋯"; progress and last update; open, overdue and next
 * due; the team, owner and target date. The title is the card's one link — stretched over the
 * card — and the buttons sit above it, so nothing interactive is nested.
 */
export function ProjectCard({ project: p, today, now, timeZone, onChangeStatus, onEdit, onArchive }: ProjectCardProps) {
  const navigate = useNavigate();
  const progress = progressOf(p.stats);
  const target = targetLabel(p, today, timeZone);
  const next = nextDueLabel(p.stats.nextDue, today);
  const meta: ReactNode[] = [
    <span key="code" className="rounded bg-ground px-1.5 py-px font-mono text-[11px] text-ink-2">{p.code}</span>,
    ...(p.number ? [<span key="number">No. <bdi>{p.number}</bdi></span>] : []),
    ...(p.clientName ? [<bdi key="client">{p.clientName}</bdi>] : []),
  ];
  const faces = p.team.slice(0, FACES);
  const more = Math.max(0, p.teamCount - faces.length);
  const teamText = `Team: ${faces.map((m) => m.name).join(', ')}${more ? ` and ${more} more` : ''}`;

  const actions: ActionMenuItem[] = [];
  if (onEdit) actions.push({ label: 'Edit', onSelect: () => onEdit(p) });
  actions.push({ label: 'Open board', onSelect: () => navigate(`/board?project=${encodeURIComponent(p.id)}`) });
  if (onArchive && p.status !== 'ARCHIVED') actions.push({ label: 'Archive…', danger: true, onSelect: () => onArchive(p) });

  return (
    <article
      data-project-card
      className="relative flex flex-col rounded-2xl border border-line bg-surface shadow-card transition-[border-color,box-shadow] duration-200 hover:border-brand/30 hover:shadow-lift focus-within:z-20"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 rounded-t-2xl" style={{ background: p.color }} />

      <div className="flex items-start gap-3 px-4 pb-3 pt-5">
        {/* Initials as large text (19px bold): white then reads at 3:1 or more on every colour the
            project form offers — at the usual 14px, #B7791F falls short of 4.5:1. */}
        <ProjectAvatar project={p} size="lg" className="shadow-soft !text-[1.2rem]" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold leading-snug">
            <Link
              to={`/projects/${p.id}`}
              title={p.name}
              className="line-clamp-2 text-ink outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:text-brand focus-visible:after:ring-2 focus-visible:after:ring-brand/60"
            >
              <bdi>{p.name}</bdi>
            </Link>
          </h2>
          {/* The status sits under the name, so a long name keeps the card's width. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="relative z-10 flex">
              <ProjectStatusMenu project={p} onChange={onChangeStatus ? (s) => onChangeStatus(p, s) : undefined} />
            </span>
            <p data-testid="project-meta" className="min-w-0 text-xs leading-relaxed text-ink-2">
              {meta.map((part, i) => (
                <Fragment key={i}>
                  {i ? <span aria-hidden="true" className="text-ink-3"> · </span> : null}
                  {part}
                </Fragment>
              ))}
            </p>
          </div>
        </div>
        <div className="relative z-10 -me-1 flex flex-none items-center">
          <ActionMenu label={`More actions for ${p.name}`} items={actions} buttonClassName={MORE_BUTTON} />
        </div>
      </div>

      <div className="px-4 pb-3">
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-ground">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${progress.pct}%`, background: p.color }} />
        </div>
        <p className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-ink-2">
          <span data-testid="project-progress">
            {p.stats.total ? (
              <>
                <span className="font-semibold text-ink">{progress.pct}%</span>
                {progress.text.replace(/^\d+%/, '')}
              </>
            ) : (
              progress.text
            )}
          </span>
          <span>{updatedLabel(p.stats.lastActivityAt, now, timeZone)}</span>
        </p>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-line border-y border-line rtl:divide-x-reverse">
        <Figure label="Open">{p.stats.open}</Figure>
        <Figure label="Overdue" late={p.stats.overdue > 0}>{p.stats.overdue}</Figure>
        <Figure label="Next due">
          <span aria-hidden="true">{next.short}</span>
          <span className="sr-only">{next.long}</span>
        </Figure>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-xs text-ink-2">
        {faces.length ? (
          <span data-testid="project-team" className="flex flex-none items-center">
            <span className="sr-only">{teamText}</span>
            {/* A small overlap, so each face keeps both initials in view. */}
            <span aria-hidden="true" className="flex items-center -space-x-1 rtl:space-x-reverse">
              {faces.map((m) => (
                <span key={m.id} data-face className="flex rounded-full">
                  <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                </span>
              ))}
              {more ? (
                <span className="grid h-6 min-w-6 place-items-center rounded-full border border-surface bg-ground px-1 text-[10px] font-semibold text-ink-2">+{more}</span>
              ) : null}
            </span>
          </span>
        ) : null}
        <span data-testid="project-owner" className="min-w-0 truncate">
          {p.owner ? (
            <>
              Owner · <bdi className="font-medium text-ink">{p.owner.name}</bdi>
            </>
          ) : (
            <span className="text-ink-3">No owner</span>
          )}
        </span>
        <span data-late={String(target.late)} className={`ms-auto whitespace-nowrap ${target.late ? 'font-semibold text-danger' : ''}`}>
          {target.text}
        </span>
      </div>
    </article>
  );
}
