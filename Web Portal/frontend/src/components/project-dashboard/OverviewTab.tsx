import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApiProject } from '../../api/projects';
import type { ApiTask } from '../../api/tasks';
import type { ProjectMeetingsOverview } from '../../api/meetings';
import { Badge, type BadgeTone } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { AiSummaryCard } from '../AiSummaryCard';
import { deadlines, milestones, projectTimeline, taskStats, workload, type MilestoneState } from '../../lib/project-dashboard';
import { formatMeetingDay, formatMeetingTimes } from '../../lib/meetingFormat';
import { EmptyNote, FlagIcon, LinkButton, ProgressBar, RepeatIcon, SectionCard, dayText, relativeDays } from './parts';
import type { TaskFilter, TaskGroup } from './TasksTab';

const PROJECT_STATUS_TONE: Record<string, BadgeTone> = { PLANNING: 'info', ACTIVE: 'success', ON_HOLD: 'warning', COMPLETED: 'brand', ARCHIVED: 'neutral' };
const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');

const MILESTONE_LOOK: Record<MilestoneState, string> = {
  done: 'text-success',
  overdue: 'text-danger',
  upcoming: 'text-brand',
  undated: 'text-ink-3',
};

function milestoneNote(state: MilestoneState, daysLeft: number | null): string {
  if (state === 'done') return 'Reached';
  if (state === 'undated') return 'No date set';
  if (daysLeft === null) return '';
  if (state === 'overdue') return `Late by ${-daysLeft} ${daysLeft === -1 ? 'day' : 'days'}`;
  return daysLeft === 0 ? 'Due today' : `Due ${relativeDays(daysLeft)}`;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line py-2 sm:block sm:border-0 sm:py-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium text-ink sm:mt-0.5">{children}</dd>
    </div>
  );
}

export interface OverviewProps {
  project: ApiProject;
  tasks: ApiTask[];
  groups: TaskGroup[];
  today: string;
  timeZone: string;
  statsReady: boolean;
  members: Array<{ id: string; name: string; role: 'MEMBER' | 'MANAGER' }>;
  ownerName: string;
  /** The owner picker (admins), shown instead of the owner's name. */
  ownerControl: ReactNode | null;
  meetings: ProjectMeetingsOverview | null;
  meetingsLoading: boolean;
  onOpenTask: (taskId: string) => void;
  onShow: (tab: 'tasks' | 'meetings' | 'team', filter?: TaskFilter) => void;
  onNewMeeting?: () => void;
  onSummarize: () => Promise<string>;
}

/**
 * The project at a glance: its details and timeline, milestones, deadlines coming up, who runs it
 * and who has what, the next meeting, and the tasks by status.
 */
export function OverviewTab(p: OverviewProps) {
  const { project, tasks, today, timeZone } = p;
  const stats = taskStats(tasks, today);
  const timeline = projectTimeline(project.startDate, project.targetDate, today);
  const marks = milestones(tasks, today);
  const soon = deadlines(tasks, today, 14);
  const people = workload(tasks, today);
  const managers = p.members.filter((m) => m.role === 'MANAGER');
  const next = p.meetings?.stats.nextMeetingId ? p.meetings.meetings.find((m) => m.id === p.meetings!.stats.nextMeetingId) ?? null : null;
  const live = p.meetings?.meetings.find((m) => m.phase === 'ongoing') ?? null;
  const focus = live ?? next;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <SectionCard id="pd-about" title="Project details">
          <p dir="auto" className="text-start text-sm text-ink-2">{project.description || 'No description yet.'}</p>
          <dl className="mt-4 grid gap-x-6 sm:grid-cols-3 sm:gap-y-4">
            <Detail label="Status"><Badge tone={PROJECT_STATUS_TONE[project.status] ?? 'neutral'} dot>{words(project.status)}</Badge></Detail>
            <Detail label="Priority">{words(project.priority)}</Detail>
            <Detail label="Client">{project.clientName ? <bdi>{project.clientName}</bdi> : '—'}</Detail>
            <Detail label="Start date">{dayText(project.startDate)}</Detail>
            <Detail label="Target date">{dayText(project.targetDate)}</Detail>
            <Detail label="Project number">{project.number ? <span className="font-mono">{project.number}</span> : '—'}</Detail>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Owner</span>
            {p.ownerControl ?? <span className="text-sm font-medium text-ink">{p.ownerName}</span>}
            <span className="text-xs text-ink-3">New tasks default-assign to the owner.</span>
          </div>

          <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-ink">Work done</span>
                <span className="tabular-nums text-ink-2">{p.statsReady ? `${stats.completed} of ${stats.total} tasks · ${stats.avgProgress}% overall` : '…'}</span>
              </div>
              <ProgressBar value={p.statsReady ? stats.avgProgress : 0} label="Work done" tone="success" />
            </div>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-ink">Time</span>
                <span className={`tabular-nums ${timeline?.state === 'late' ? 'font-semibold text-danger' : 'text-ink-2'}`}>
                  {!timeline
                    ? 'Set a start and target date'
                    : timeline.state === 'not-started'
                      ? `Starts ${dayText(timeline.start)}`
                      : timeline.state === 'late'
                        ? `${-timeline.daysLeft} days past the target date`
                        : `${timeline.daysLeft} ${timeline.daysLeft === 1 ? 'day' : 'days'} left · ends ${dayText(timeline.end)}`}
                </span>
              </div>
              <ProgressBar value={timeline?.elapsedPct ?? 0} label="Time gone" tone={timeline?.state === 'late' ? 'danger' : 'brand'} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={`/board?project=${encodeURIComponent(project.id)}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-brand hover:border-brand">Open board</Link>
            <button type="button" onClick={() => p.onShow('tasks')} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-ground">View all tasks</button>
            <button type="button" onClick={() => p.onShow('meetings')} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-ground">Meetings</button>
          </div>
        </SectionCard>

        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard id="pd-milestones" title="Milestones" action={marks.length ? <LinkButton onClick={() => p.onShow('tasks', 'milestones')}>All {marks.length}</LinkButton> : null}>
            {!p.statsReady ? (
              <div className="skeleton h-16 rounded-lg" />
            ) : marks.length === 0 ? (
              <EmptyNote>No milestones yet. Tick “Milestone” on a task to list it here.</EmptyNote>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {marks.slice(0, 6).map((m) => (
                  <li key={m.task.id} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 ${MILESTONE_LOOK[m.state]}`}><FlagIcon /></span>
                    <span className="min-w-0 flex-1">
                      <button type="button" onClick={() => p.onOpenTask(m.task.id)} className={`block max-w-full truncate text-start text-sm font-medium hover:text-brand ${m.state === 'done' ? 'text-ink-2 line-through' : 'text-ink'}`}>
                        <bdi>{m.task.title}</bdi>
                      </button>
                      <span className={`text-xs ${m.state === 'overdue' ? 'font-semibold text-danger' : 'text-ink-2'}`}>
                        {m.due ? `${dayText(m.due)} · ` : ''}{milestoneNote(m.state, m.daysLeft)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>

          <SectionCard id="pd-deadlines" title="Upcoming deadlines" action={soon.length ? <LinkButton onClick={() => p.onShow('tasks', 'overdue')}>Overdue tasks</LinkButton> : null}>
            {!p.statsReady ? (
              <div className="skeleton h-16 rounded-lg" />
            ) : soon.length === 0 ? (
              <EmptyNote>Nothing due in the next two weeks.</EmptyNote>
            ) : (
              <ul className="flex flex-col gap-2">
                {soon.slice(0, 6).map((d) => (
                  <li key={d.task.id}>
                    <button type="button" onClick={() => p.onOpenTask(d.task.id)} className="flex w-full items-center gap-2 text-start">
                      <span className="w-14 flex-none font-mono text-[11px] text-ink-3">{d.task.key}</span>
                      <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-brand">{d.task.title}</span>
                      <span className={`flex-none text-xs tabular-nums ${d.daysLeft < 0 ? 'font-semibold text-danger' : d.daysLeft <= 2 ? 'font-semibold text-warning' : 'text-ink-2'}`}>
                        {d.daysLeft < 0 ? `Late · ${dayText(d.due)}` : relativeDays(d.daysLeft)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <AiSummaryCard onSummarize={p.onSummarize} title="AI status summary" />
      </div>

      <div className="min-w-0 space-y-4">
        <SectionCard id="pd-team" title="Team" action={<LinkButton onClick={() => p.onShow('team')}>Manage team</LinkButton>}>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Project manager</p>
          {managers.length ? (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {managers.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm font-medium text-ink"><Avatar name={m.name} size="sm" /><bdi>{m.name}</bdi></li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-ink-2">No manager named — owner · <bdi>{p.ownerName}</bdi></p>
          )}
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Members · {p.members.length}</p>
          {p.members.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1" title={p.members.map((m) => m.name).join(', ')}>
              {p.members.slice(0, 10).map((m) => <Avatar key={m.id} name={m.name} size="sm" />)}
              {p.members.length > 10 ? <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2">+{p.members.length - 10}</span> : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-2">Nobody yet.</p>
          )}
          {people.length ? (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Who has what</p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {people.slice(0, 5).map((w) => (
                  <li key={w.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink"><bdi>{w.name}</bdi></span>
                    <span className="tabular-nums text-ink-2">{w.open} open</span>
                    {w.overdue ? <span className="tabular-nums font-semibold text-danger">{w.overdue} late</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </SectionCard>

        <SectionCard id="pd-next" title={live ? 'Meeting under way' : 'Next meeting'} action={<LinkButton onClick={() => p.onShow('meetings')}>All meetings</LinkButton>}>
          {p.meetingsLoading && !p.meetings ? (
            <div className="skeleton h-20 rounded-lg" />
          ) : focus ? (
            <div>
              <Link to={`/meetings/${focus.id}`} className="block font-semibold text-ink hover:text-brand"><bdi>{focus.title}</bdi></Link>
              <p className="mt-0.5 text-sm text-ink-2">
                {formatMeetingDay(focus.startAt, focus.timeZone || timeZone)} · {formatMeetingTimes(focus.startAt, focus.endAt, focus.timeZone || timeZone)}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                <span>{focus.attendeeCount} {focus.attendeeCount === 1 ? 'person' : 'people'}</span>
                {focus.seriesId ? <span className="inline-flex items-center gap-1 text-ink-3"><RepeatIcon /> Repeats</span> : null}
                {focus.location ? <span>· <bdi>{focus.location}</bdi></span> : null}
              </p>
            </div>
          ) : (
            <EmptyNote>No meeting planned.</EmptyNote>
          )}
          {p.meetings ? (
            <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
              {p.meetings.stats.upcoming} upcoming · {p.meetings.stats.completed} held · {p.meetings.stats.openActionItems} open action {p.meetings.stats.openActionItems === 1 ? 'item' : 'items'}
              {p.meetings.stats.overdueActionItems ? <span className="font-semibold text-danger"> ({p.meetings.stats.overdueActionItems} late)</span> : null}
            </p>
          ) : null}
          {p.onNewMeeting ? <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={p.onNewMeeting}>+ New meeting</Button> : null}
        </SectionCard>

        <SectionCard id="pd-status" title="Tasks by status">
          {!p.statsReady ? (
            <div className="skeleton h-24 rounded-lg" />
          ) : stats.total === 0 ? (
            <EmptyNote>No tasks in this project yet.</EmptyNote>
          ) : (
            <>
              <div className="flex flex-col gap-2.5">
                {p.groups.map((g) => {
                  const pct = stats.total ? Math.round((g.tasks.length / stats.total) * 100) : 0;
                  return (
                    <div key={g.id} className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: g.color }} aria-hidden />
                      <span className="w-24 flex-none truncate text-sm text-ink" title={g.name}>{g.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ground">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: g.color }} />
                      </div>
                      <span className="w-6 flex-none text-right text-sm font-semibold tabular-nums text-ink-2">{g.tasks.length}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
                Open by priority: {stats.byPriority.URGENT} urgent · {stats.byPriority.HIGH} high · {stats.byPriority.NORMAL} normal · {stats.byPriority.LOW} low
              </p>
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
