import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadError } from '../../components/ui/LoadError';
import { EmptyState } from '../../components/ui/EmptyState';
import { buttonClass } from '../../components/ui/Button';
import { useTrainingAccess } from '../../components/training/manage/manage-queries';
import { LearningHubTabs } from '../../components/training/LearningHubTabs';
import { CoursesTab } from '../../components/training/manage/CoursesTab';
import { AssignmentsTab } from '../../components/training/manage/AssignmentsTab';
import { FeedbackTab } from '../../components/training/manage/FeedbackTab';
import { CertificatesTab } from '../../components/training/manage/CertificatesTab';
import { ReportsTab } from '../../components/training/manage/ReportsTab';
import { usePageName } from '../../lib/page-meta';

type TabKey = 'courses' | 'assignments' | 'certificates' | 'feedback';

interface Tab {
  key: TabKey;
  label: string;
  element: () => ReactNode;
}

/**
 * Manage's sections, in order (12 Nov: four, down from six). Reports is the Learning Hub's own top tab. "Assigned"
 * keeps its earlier address (?tab=assignments); New staff only rows there replace the onboarding rules' tab, and the
 * first-time tour switch is in System Settings.
 */
const TABS: readonly Tab[] = [
  { key: 'courses', label: 'Courses', element: () => <CoursesTab /> },
  { key: 'assignments', label: 'Assigned', element: () => <AssignmentsTab /> },
  { key: 'certificates', label: 'Certificates', element: () => <CertificatesTab /> },
  { key: 'feedback', label: 'Feedback', element: () => <FeedbackTab /> },
];

/** Addresses from before (bookmarks, the old Rules tab's links) and the section they open now. */
const OLD_TABS: Readonly<Record<string, TabKey>> = { rules: 'assignments' };

/**
 * The Learning Hub's Manage and Reports tabs (the former Training Center; owner answers 4, 7, 11–17 and the owner's
 * name, 11 Nov; simplified 12 Nov): Training managers and administrators author courses, assign them, manage
 * certificates and answer feedback (Manage), and read the reports (?tab=reports). A project manager who is neither
 * sees only Reports, for their own team (read-only). The open section is in the address (?tab=feedback).
 */
export function TrainingCenterPage() {
  const [params] = useSearchParams();
  const accessQ = useTrainingAccess();
  const a = accessQ.data;
  const teamOnly = !!a && !a.manager && a.teamReports;
  const reports = params.get('tab') === 'reports' || teamOnly;
  usePageName(reports ? 'Reports' : 'Manage');

  const header = (
    <>
      <PageHeader eyebrow="Workspace" title="Learning Hub" subtitle={reports ? 'Who has done what, quiz results, and what is overdue' : 'Courses, who has them, certificates and feedback'} />
      <LearningHubTabs current={a && !a.manager && !a.teamReports ? null : reports ? 'reports' : 'manage'} />
    </>
  );

  if (accessQ.isError) {
    return (
      <div data-page="learning-hub-manage">
        {header}
        <div className="mt-4">
          <LoadError what="the Learning Hub" onRetry={() => void accessQ.refetch()} />
        </div>
      </div>
    );
  }
  if (!a) {
    return (
      <div data-page="learning-hub-manage">
        {header}
        <div className="skeleton mt-4 h-64 rounded-2xl" role="status" aria-label="Loading the Learning Hub" />
      </div>
    );
  }
  if (!a.manager && !a.teamReports) {
    return (
      <div data-page="learning-hub-manage">
        {header}
        <div className="mt-4">
          <EmptyState
            title="Only Training managers and administrators can manage the Learning Hub"
            description="Your own courses, progress and certificates are in My learning."
            action={<Link to="/training" className={buttonClass('primary', 'md', '!min-h-[44px]')}>Go to My learning</Link>}
          />
        </div>
      </div>
    );
  }
  return (
    <div data-page="learning-hub-manage" className="min-w-0">
      {header}
      <div className="mt-4 min-w-0">{reports ? <ReportsTab readOnly={teamOnly} /> : <ManageSections />}</div>
    </div>
  );
}

export default TrainingCenterPage;

function ManageSections() {
  const [params, setParams] = useSearchParams();
  const tabs = TABS;
  const asked = params.get('tab') ?? '';
  const current = tabs.find((t) => t.key === (OLD_TABS[asked] ?? asked)) ?? tabs[0]!;
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const show = (key: string, focus = false) => {
    setParams(key === tabs[0]!.key ? {} : { tab: key }, { replace: true });
    if (focus) buttons.current.get(key)?.focus();
  };

  // Arrow keys, Home and End move along the sections (the open one is the only Tab stop).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex((t) => t.key === current.key);
    const go = (i: number) => {
      e.preventDefault();
      show(tabs[(i + tabs.length) % tabs.length]!.key, true);
    };
    if (e.key === 'ArrowRight') go(at + 1);
    else if (e.key === 'ArrowLeft') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(tabs.length - 1);
  }

  return (
    <div className="min-w-0">
      {/* On a phone the sections scroll sideways inside their own row; the page itself never does. */}
      <div role="tablist" aria-label="Manage" onKeyDown={onKeyDown} className="-mb-px flex min-w-0 gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const selected = t.key === current.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                if (el) buttons.current.set(t.key, el);
                else buttons.current.delete(t.key);
              }}
              type="button"
              role="tab"
              id={`manage-tab-${t.key}`}
              aria-controls={`manage-panel-${t.key}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => show(t.key)}
              className={`!min-h-[44px] flex-none whitespace-nowrap rounded-t-lg border-b-2 px-2.5 py-2 text-sm font-medium transition-colors sm:px-3 ${selected ? 'border-brand bg-brand/5 text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div key={current.key} role="tabpanel" id={`manage-panel-${current.key}`} aria-labelledby={`manage-tab-${current.key}`} className="mt-4 min-w-0">
        {current.element()}
      </div>
    </div>
  );
}
