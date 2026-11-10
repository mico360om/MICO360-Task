import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { nextActionsKey, projectActivityKey, projectHealthApi, projectHealthKey, type HealthPerson, type ProjectHealthDetail, type ProjectRisk } from '../../api/project-health';
import type { ApiActivity } from '../../api/activity';
import type { ProjectCompletion } from '../../api/projects';
import { completionText } from '../../lib/project-health';
import { ACTION_TONE, ACTION_VERB, PROJECT_LINES, detailOf, titleOf } from '../../lib/activity-lines';
import { relativeTime } from '../../lib/relative-time';
import { dateTimeText } from '../../lib/day-words';
import { TOUCH_TALL } from '../../lib/touch';
import { Avatar } from '../ui/Avatar';
import { LoadError } from '../ui/LoadError';
import { TaskKey, TaskKeyButton } from '../TaskKey';
import { HealthBadge } from '../projects/HealthBadge';
import { PrioritiesWidget } from '../dashboard/PrioritiesWidget';
import { EmptyNote, LinkButton, ProgressBar, SectionCard, dayText } from './parts';
import { HEALTH_CLASS, healthClass } from '../../lib/colour-classes';

/** The Overview's Risks card shows this many, then "Show all". */
export const RISKS_SHOWN = 5;
/** Next actions shows this many, then "Show all". */
export const NEXT_ACTIONS_SHOWN = 7;

/** A well-formed answer (an older server, or a stand-in, answers something else: treated as not loaded). */
const isDetail = (d: unknown): d is ProjectHealthDetail =>
  !!d && typeof d === 'object' && Array.isArray((d as ProjectHealthDetail).reasons) && Array.isArray((d as ProjectHealthDetail).risks) && !!(d as ProjectHealthDetail).owners;

/** One project's health (cards on the Overview share one request). */
export function useProjectHealth(projectId: string) {
  const q = useQuery({ queryKey: projectHealthKey(projectId), queryFn: () => projectHealthApi(apiClient).health(projectId), enabled: !!projectId, staleTime: 15_000 });
  return { q, detail: isDetail(q.data) ? q.data : null };
}

function Loading({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="skeleton h-16 rounded-lg" />;
}

function People({ people, empty = '—' }: { people: HealthPerson[]; empty?: string }) {
  if (people.length === 0) return <span className="text-ink-3">{empty}</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {people.map((p) => (
        <span key={p.id} className="inline-flex min-w-0 items-center gap-1.5">
          <Avatar name={p.name} src={p.avatarUrl} size="sm" />
          <bdi className="truncate text-sm font-medium text-ink">{p.name}</bdi>
        </span>
      ))}
    </span>
  );
}

/**
 * 1.23.5 Health: the one rule's mark with every reason (worst first), and the completion in the project's
 * own mode with the other beside it ("62% by weight · 70% by count").
 */
export function HealthCard({ projectId, completion }: { projectId: string; completion: ProjectCompletion | null }) {
  const { q, detail } = useProjectHealth(projectId);
  return (
    <SectionCard id="pd-health" title="Health" action={detail ? <HealthBadge rag={detail.rag} reasons={detail.reasons} /> : null}>
      {q.isLoading ? (
        <Loading label="Loading the project’s health" />
      ) : !detail ? (
        <LoadError what="the project’s health" onRetry={() => void q.refetch()} className="py-2 text-center" />
      ) : (
        <>
          <ul className="flex flex-col gap-1.5" aria-label="Why">
            {detail.reasons.map((r) => (
              <li key={r.code + r.text} className={`flex items-start gap-2 text-sm ${r.level === 'RED' ? 'font-medium ' : ''}${(healthClass(r.level) ?? HEALTH_CLASS.ON_TRACK).text}`}>
                <span aria-hidden="true" className={`mt-1.5 h-2 w-2 flex-none rounded-full ${(healthClass(r.level) ?? HEALTH_CLASS.ON_TRACK).dot}`} />
                <bdi>{r.text}</bdi>
              </li>
            ))}
          </ul>
          {completion ? (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                <span className="font-semibold text-ink">Completion</span>
                <span data-testid="health-completion" className="tabular-nums text-ink-2">{completionText(completion)}</span>
              </div>
              <ProgressBar value={completion.pct} label={completion.mode === 'WEIGHT' ? 'Completion by weight' : 'Completion'} tone="success" />
              {detail.timeUsedPct !== null ? <p className="mt-1.5 text-xs text-ink-2">{detail.timeUsedPct}% of the planned time used</p> : null}
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

function RiskItem({ r, onOpenTask }: { r: ProjectRisk; onOpenTask: (taskId: string) => void }) {
  const red = r.level === 'RED';
  return (
    <li className={`rounded-lg border-s-4 bg-ground/60 px-3 py-2 ${red ? 'border-danger' : 'border-warning'}`}>
      <p className={`text-sm font-semibold ${red ? 'text-danger' : 'text-warning'}`}>
        <span className="sr-only">{red ? 'Serious risk: ' : 'Risk: '}</span>
        <bdi>{r.title}</bdi>
      </p>
      <p className="mt-0.5 text-xs text-ink-2">{r.detail}</p>
      {r.tasks.length ? (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {r.tasks.slice(0, 4).map((t) => (
            <TaskKeyButton key={t.id} value={t.key} title={t.title} onClick={() => onOpenTask(t.id)} />
          ))}
          {r.tasks.length > 4 ? <span className="text-xs text-ink-3">+{r.tasks.length - 4} more</span> : null}
        </p>
      ) : null}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
        <span className="font-semibold uppercase tracking-wide text-ink-3">Accountable</span>
        <People people={r.accountable} empty="No one named" />
      </div>
    </li>
  );
}

/** 1.23.5 Risks: spotted from the data, each with an explanation and who is accountable; the first five, then "Show all". */
export function RisksCard({ projectId, onOpenTask }: { projectId: string; onOpenTask: (taskId: string) => void }) {
  const { q, detail } = useProjectHealth(projectId);
  const [all, setAll] = useState(false);
  const risks = detail?.risks ?? [];
  const shown = all ? risks : risks.slice(0, RISKS_SHOWN);
  return (
    <SectionCard
      id="pd-risks"
      title={detail ? `Risks · ${risks.length}` : 'Risks'}
      action={risks.length > RISKS_SHOWN ? <LinkButton onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all (${risks.length})`}</LinkButton> : null}
    >
      {q.isLoading ? (
        <Loading label="Loading the project’s risks" />
      ) : !detail ? (
        <LoadError what="the project’s risks" onRetry={() => void q.refetch()} className="py-2 text-center" />
      ) : risks.length === 0 ? (
        <EmptyNote>No risks spotted — nothing late, held up or overloaded.</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {shown.map((r) => (
            <RiskItem key={`${r.code}:${r.tasks.map((t) => t.id).join(',')}:${r.title}`} r={r} onOpenTask={onOpenTask} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** 1.23.5 Accountable owners: the project owner, its managers, and each open milestone's owners. */
export function OwnersCard({ projectId, onOpenTask }: { projectId: string; onOpenTask: (taskId: string) => void }) {
  const { q, detail } = useProjectHealth(projectId);
  return (
    <SectionCard id="pd-owners" title="Accountable owners">
      {q.isLoading ? (
        <Loading label="Loading the accountable owners" />
      ) : !detail ? (
        <LoadError what="the accountable owners" onRetry={() => void q.refetch()} className="py-2 text-center" />
      ) : (
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Project owner</dt>
            <dd className="mt-1">{detail.owners.owner ? <People people={[detail.owners.owner]} /> : <span className="text-sm text-ink-3">No owner</span>}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">{detail.owners.managers.length === 1 ? 'Manager' : 'Managers'}</dt>
            <dd className="mt-1">
              <People people={detail.owners.managers} empty="No manager named" />
            </dd>
          </div>
          {detail.owners.milestones.length ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Open milestones</dt>
              <dd>
                <ul className="mt-1 flex flex-col gap-2">
                  {detail.owners.milestones.map((m) => (
                    <li key={m.id} className="min-w-0">
                      <button type="button" onClick={() => onOpenTask(m.id)} className={`flex min-w-0 max-w-full items-center gap-1.5 text-start text-sm hover:text-brand ${TOUCH_TALL}`}>
                        <TaskKey value={m.key} />
                        <bdi className="truncate font-medium text-ink">{m.title}</bdi>
                        {m.due ? <span className="flex-none text-xs text-ink-2">· {dayText(m.due)}</span> : null}
                      </button>
                      <div className="mt-0.5">
                        <People people={m.owners} empty="No one assigned" />
                      </div>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      )}
    </SectionCard>
  );
}

/** 1.23.5 Next actions: the project's next things to do, in the 1.23.4 priorities order, with its quick actions. */
export function NextActionsCard({ projectId, onOpenTask }: { projectId: string; onOpenTask: (taskId: string, list?: string[]) => void }) {
  return (
    <PrioritiesWidget
      onOpenTask={onOpenTask}
      list={{
        queryKey: nextActionsKey(projectId),
        fetch: (fresh) => projectHealthApi(apiClient).nextActions(projectId, fresh),
        title: 'Next actions',
        headingId: 'pd-next-actions-heading',
        empty: 'Nothing to do next — nothing late, due this week, blocked or waiting for someone.',
        what: 'the next actions',
        first: NEXT_ACTIONS_SHOWN,
        chips: false,
        // The project page listens to its project and reads the list again (ProjectDetailPage).
        live: false,
        testId: 'next-actions',
      }}
    />
  );
}

function ActivityLine({ a, onOpenTask }: { a: ApiActivity; onOpenTask: (taskId: string) => void }) {
  const detail = detailOf(a);
  const title = titleOf(a);
  return (
    <li className="flex gap-2 text-sm">
      <Avatar name={a.actor?.name ?? '?'} src={a.actor?.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="leading-snug text-ink">
          <bdi className="font-semibold">{a.actor?.name ?? 'Someone'}</bdi> <span className={ACTION_TONE[a.action] ?? 'text-ink-2'}>{ACTION_VERB[a.action] ?? a.action.toLowerCase().replace(/_/g, ' ')}</span>{' '}
          {a.task ? (
            <TaskKeyButton value={a.task.key} onClick={() => onOpenTask(a.task!.id)} className="align-middle" />
          ) : PROJECT_LINES.has(a.action) && a.project ? (
            <bdi className="font-medium text-ink">{a.project.name}</bdi>
          ) : (
            <span className="text-ink-2">a task</span>
          )}
        </p>
        {title || detail ? (
          <p className="line-clamp-2 text-xs text-ink-2 sm:line-clamp-1" title={[title, detail].filter(Boolean).join(' · ')}>
            {title ? <bdi>{title}</bdi> : null}
            {detail ? <span className="text-ink-3">{title ? ' · ' : ''}{detail}</span> : null}
          </p>
        ) : null}
        <time className="text-[11px] text-ink-3" dateTime={a.createdAt} title={dateTimeText(a.createdAt)}>
          {relativeTime(a.createdAt)}
        </time>
      </div>
    </li>
  );
}

/** 1.23.5 Recent activity: the project's last 10 entries, as the Activity page words them. */
export function RecentActivityCard({ projectId, onOpenTask }: { projectId: string; onOpenTask: (taskId: string) => void }) {
  const q = useQuery({ queryKey: projectActivityKey(projectId), queryFn: () => projectHealthApi(apiClient).activity(projectId), enabled: !!projectId, staleTime: 15_000 });
  const rows = Array.isArray(q.data) ? q.data : null;
  return (
    <SectionCard id="pd-activity" title="Recent activity">
      {q.isLoading ? (
        <Loading label="Loading recent activity" />
      ) : !rows ? (
        <LoadError what="recent activity" onRetry={() => void q.refetch()} className="py-2 text-center" />
      ) : rows.length === 0 ? (
        <EmptyNote>No activity yet — new, moved and finished tasks show up here.</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((a) => (
            <ActivityLine key={a.id} a={a} onOpenTask={onOpenTask} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
