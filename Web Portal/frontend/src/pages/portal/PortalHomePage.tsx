import { Link } from 'react-router-dom';
import type { PortalProjectCard } from '../../api/portal';
import { ProjectAvatar } from '../../components/ProjectAvatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePortalMe, usePortalTraining, usePortalTrainingSummary } from '../../components/portal/portal-queries';
import { CompanyMark, LoadFailed, Loading, ProgressBar, StatusBadge, TOUCH } from '../../components/portal/portal-ui';
import { LearnLinkView } from '../../components/training/LearnLink';
import { BookIcon } from '../../components/training/training-ui';
import { OVERDUE_CLASS } from '../../lib/colour-classes';

/** 1.23 The Client portal's home: the projects shared with this client, as cards. */
export function PortalHomePage() {
  const q = usePortalMe();
  return (
    <div className="flex flex-col gap-5">
      <div data-tour="portal-projects">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Your projects</h1>
          <PortalLearnLink />
        </div>
        <p className="mt-1 text-sm text-ink-2">The projects the team has shared with you. Open one to follow its progress.</p>
      </div>
      {q.isPending ? (
        <Loading what="your projects" />
      ) : q.isError ? (
        <LoadFailed what="your projects" onRetry={() => void q.refetch()} />
      ) : q.data.projects.length === 0 ? (
        <EmptyState
          titleAs="h2"
          title="No projects are shared with you yet."
          description="When the project team shares a project with you, it appears here."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.projects.map((p) => (
            <li key={p.id} className="min-w-0">
              <ProjectCard project={p} />
            </li>
          ))}
        </ul>
      )}
      <TrainingCard />
    </div>
  );
}

/** Training Center: "Learn this feature" for the portal — its course (or Help & training when there are several). */
function PortalLearnLink() {
  const courses = (usePortalTraining().data?.catalogue ?? []).filter((c) => c.moduleKey === 'portal');
  if (!courses.length) return null;
  const to = courses.length === 1 ? `/portal/training/courses/${encodeURIComponent(courses[0]!.id)}?module=portal` : '/portal/training';
  return <LearnLinkView to={to} />;
}

/** The Learning Hub on the home page: how many courses wait (red when one is overdue) — badges only, no emails. */
function TrainingCard() {
  const s = usePortalTrainingSummary().data;
  const waiting = typeof s?.assigned === 'number' ? s.assigned : 0;
  const overdue = typeof s?.overdue === 'number' ? s.overdue : 0;
  return (
    <Link
      to="/portal/training"
      className={`card card-hover card-pad flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${TOUCH}`}
    >
      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-brand/10 text-brand">
        <BookIcon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base font-bold text-ink">Learning Hub</span>
        <span className="block text-sm text-ink-2">
          {waiting ? `${waiting} ${waiting === 1 ? 'course' : 'courses'} for you to do` : 'Short courses on using the portal.'}
          {overdue ? <span className={`ms-2 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${OVERDUE_CLASS.chip}`}>{overdue} overdue</span> : null}
        </span>
      </span>
    </Link>
  );
}

const MODULE_WORDS: [keyof PortalProjectCard['modules'], string][] = [
  ['progress', 'Progress & tasks'],
  ['meetings', 'Meetings & minutes'],
];

function ProjectCard({ project: p }: { project: PortalProjectCard }) {
  const details = [p.code, p.number ? `Project no. ${p.number}` : null].filter(Boolean).join(' · ');
  const shared = MODULE_WORDS.filter(([m]) => p.modules[m]).map(([, w]) => w);
  return (
    <Link
      to={`/portal/projects/${encodeURIComponent(p.id)}`}
      className="card card-hover card-pad flex h-full flex-col gap-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {/* Branded with the project's main company (its logo, else the built-in one). */}
      <div className="flex min-w-0 items-center gap-2 border-b border-line pb-3">
        <CompanyMark company={p.company} className="h-7" />
        {p.company ? <span className="min-w-0 truncate text-xs font-semibold text-ink-2"><bdi>{p.company.name}</bdi></span> : null}
      </div>
      <div className="flex min-w-0 items-start gap-3">
        <ProjectAvatar project={p} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words font-display text-base font-bold text-ink"><bdi>{p.name}</bdi></h2>
          {details ? <p className="mt-0.5 text-xs text-ink-2" dir="auto">{details}</p> : null}
          <div className="mt-2">
            <StatusBadge label={p.statusLabel} />
          </div>
        </div>
      </div>
      {p.percentDone !== null ? (
        <div className="mt-auto">
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="text-ink-2">Progress</span>
            <span className="font-semibold text-ink">{p.percentDone}% done</span>
          </div>
          <ProgressBar percent={p.percentDone} label={`${p.name} progress`} />
        </div>
      ) : null}
      {shared.length ? <p className={`text-xs text-ink-2 ${p.percentDone === null ? 'mt-auto' : ''}`}>{shared.join(' · ')}</p> : null}
    </Link>
  );
}
