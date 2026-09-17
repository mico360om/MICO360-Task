import { Link } from 'react-router-dom';
import { PROJECT_STATUSES, projectStatusLabel, type ApiProject, type ProjectStatus } from '../api/projects';
import { Reveal } from './ui/Reveal';
import { SearchableSelect } from './ui/SearchableSelect';
import { Badge, type BadgeTone } from './ui/Badge';
import { Avatar } from './ui/Avatar';
import { EmptyState } from './ui/EmptyState';
import { assetUrl } from '../api/client';

/** Per-project rollup shown on the card (task stats + owner). All fields optional. */
export interface ProjectCardMeta {
  ownerName?: string | null;
  ownerAvatar?: string | null;
  total?: number;
  overdue?: number;
  completedPct?: number;
  members?: number;
}

export interface ProjectsListProps {
  projects: ApiProject[];
  /** When true, each card gets an admin status control. */
  canManage?: boolean;
  /** Change a project's status (ARCHIVED routes through the archive action in the parent). */
  onChangeStatus?: (id: string, status: ProjectStatus) => void;
  /** Optional per-project rollup keyed by project id. */
  meta?: Record<string, ProjectCardMeta>;
}

const STATUS_OPTIONS = PROJECT_STATUSES.map((s) => ({ value: s, label: projectStatusLabel(s) }));

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  PLANNING: 'info',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'brand',
  ARCHIVED: 'neutral',
};

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null);

function Stat({ icon, value, label, tone = 'text-ink' }: { icon: React.ReactNode; value: string | number; label: string; tone?: string }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span className="text-ink-3" aria-hidden>{icon}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

export function ProjectsList({ projects, canManage, onChangeStatus, meta }: ProjectsListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        }
        title="No projects yet"
        description={canManage ? 'Create your first project with “New project”.' : 'Projects you can access will appear here.'}
      />
    );
  }
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p, i) => {
        const m = meta?.[p.id];
        const start = fmtDate(p.startDate);
        const target = fmtDate(p.targetDate);
        const hasProgress = typeof m?.completedPct === 'number' && (m.total ?? 0) > 0;
        return (
          <Reveal key={p.id} delay={((i % 5) + 1) as 1 | 2 | 3 | 4 | 5}>
            <div className="card card-hover group relative flex flex-col">
              <Link to={`/projects/${p.id}`} className="flex flex-1 flex-col gap-3 overflow-hidden rounded-t-2xl p-5">
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: p.color }} aria-hidden="true" />
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md bg-ground px-2 py-0.5 font-mono text-xs text-ink-2">{p.code}</span>
                  <Badge tone={STATUS_TONE[p.status]} dot>{projectStatusLabel(p.status)}</Badge>
                </div>

                <div className="flex items-center gap-3">
                  {p.imageUrl ? (
                    <img src={assetUrl(p.imageUrl)} alt="" className="h-11 w-11 flex-none rounded-xl object-cover shadow-soft" />
                  ) : (
                    <span className="grid h-11 w-11 flex-none place-items-center rounded-xl text-sm font-bold text-white shadow-soft" style={{ background: p.color }} aria-hidden="true">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-base font-bold text-ink transition-colors group-hover:text-brand">{p.name}</h3>
                    {p.clientName ? <p className="truncate text-xs text-ink-2">{p.clientName}</p> : <p className="truncate text-xs text-ink-3">Internal</p>}
                  </div>
                </div>

                {/* Progress */}
                {hasProgress ? (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground">
                      <div className="h-full rounded-full bg-brand-sheen transition-all duration-500" style={{ width: `${m!.completedPct}%` }} />
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-ink-2">{m!.completedPct}%</span>
                  </div>
                ) : null}

                {/* Stats row: tasks, overdue, members */}
                {m ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5">
                    <Stat
                      icon={<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M8 12l2.5 2.5L16 9" /></svg>}
                      value={m.total ?? 0}
                      label="Tasks"
                    />
                    <Stat
                      icon={<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>}
                      value={m.overdue ?? 0}
                      label="Overdue"
                      tone={(m.overdue ?? 0) > 0 ? 'text-danger' : 'text-ink'}
                    />
                    {typeof m.members === 'number' ? (
                      <Stat
                        icon={<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 6.5a3 3 0 0 1 0 5.5M20 20a5 5 0 0 0-4-4.9" /></svg>}
                        value={m.members}
                        label="Members"
                      />
                    ) : null}
                    {start || target ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-2" title="Start → Target">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                        {start ?? '—'} → {target ?? '—'}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* Owner */}
                {m?.ownerName ? (
                  <div className="flex items-center gap-2 text-xs text-ink-2">
                    <Avatar name={m.ownerName} size="sm" src={m.ownerAvatar} />
                    <span className="truncate">Owner · <span className="font-medium text-ink">{m.ownerName}</span></span>
                  </div>
                ) : null}
              </Link>

              {canManage && onChangeStatus ? (
                <div className="flex items-center gap-2 border-t border-line px-5 py-3">
                  <span className="text-xs font-medium text-ink-2">Status</span>
                  <div className="min-w-0 flex-1">
                    <SearchableSelect
                      ariaLabel={`Status for ${p.name}`}
                      options={STATUS_OPTIONS}
                      value={p.status}
                      onChange={(v) => onChangeStatus(p.id, v as ProjectStatus)}
                    />
                  </div>
                </div>
              ) : (
                <Link to={`/projects/${p.id}`} className="flex items-center gap-1 px-5 pb-4 text-xs font-semibold text-brand opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100">
                  Open project
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </Link>
              )}
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}
