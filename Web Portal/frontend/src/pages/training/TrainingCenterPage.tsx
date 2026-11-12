import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadError } from '../../components/ui/LoadError';
import { EmptyState } from '../../components/ui/EmptyState';
import { buttonClass } from '../../components/ui/Button';
import { useTrainingAccess } from '../../components/training/manage/manage-queries';
import { LearningHubTabs } from '../../components/training/LearningHubTabs';
import { useEffectiveAdmin } from '../../lib/manager-view';
import { CoursesTab } from '../../components/training/manage/CoursesTab';
import { AssignmentsTab } from '../../components/training/manage/AssignmentsTab';
import { RulesTab } from '../../components/training/manage/RulesTab';
import { FeedbackTab } from '../../components/training/manage/FeedbackTab';
import { CertificatesTab } from '../../components/training/manage/CertificatesTab';
import { ReportsTab } from '../../components/training/manage/ReportsTab';
import { SettingsTab } from '../../components/training/manage/SettingsTab';
import { usePageName } from '../../lib/page-meta';

type TabKey = 'courses' | 'assignments' | 'rules' | 'feedback' | 'certificates' | 'settings';

interface Tab {
  key: TabKey;
  label: string;
  /** Administrators only. */
  admin?: boolean;
  element: () => ReactNode;
}

/** Manage's sections, in order (Settings: administrators only). Reports is the Learning Hub's own top tab. */
const TABS: readonly Tab[] = [
  { key: 'courses', label: 'Courses', element: () => <CoursesTab /> },
  { key: 'assignments', label: 'Assignments', element: () => <AssignmentsTab /> },
  { key: 'rules', label: 'Onboarding rules', element: () => <RulesTab /> },
  { key: 'feedback', label: 'Feedback', element: () => <FeedbackTab /> },
  { key: 'certificates', label: 'Certificates', element: () => <CertificatesTab /> },
  { key: 'settings', label: 'Settings', admin: true, element: () => <SettingsTab /> },
];

/**
 * The Learning Hub's Manage and Reports tabs (the former Training Center; owner answers 4, 7, 11–17 and the owner's
 * name, 11 Nov): Training managers and administrators author courses, assign them, set onboarding rules, answer
 * feedback and manage certificates (Manage), and read the reports (?tab=reports); administrators also switch the
 * first-time tour per company. A project manager who is neither sees only Reports, for their own team (read-only).
 * The open section is in the address (?tab=feedback).
 */
export function TrainingCenterPage() {
  const [params] = useSearchParams();
  const accessQ = useTrainingAccess();
  const a = accessQ.data;
  // Manager View (Release B): the Learning Hub stays open (training is work), but its Settings — the tour switch per
  // company — are an administrator's setting, closed while Manager View is on (the server refuses them too).
  const settingsAdmin = useEffectiveAdmin();
  const teamOnly = !!a && !a.manager && a.teamReports;
  const reports = params.get('tab') === 'reports' || teamOnly;
  usePageName(reports ? 'Reports' : 'Manage');

  const header = (
    <>
      <PageHeader eyebrow="Workspace" title="Learning Hub" subtitle={reports ? 'Who has done what, quiz results, and what is overdue' : 'Courses, assignments, onboarding rules, feedback and certificates'} />
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
      <div className="mt-4 min-w-0">{reports ? <ReportsTab readOnly={teamOnly} /> : <ManageSections admin={a.admin && settingsAdmin} />}</div>
    </div>
  );
}

export default TrainingCenterPage;

function ManageSections({ admin }: { admin: boolean }) {
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => !t.admin || admin);
  const current = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0]!;
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
              className={`!min-h-[44px] flex-none whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors ${selected ? 'border-brand bg-brand/5 text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
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
