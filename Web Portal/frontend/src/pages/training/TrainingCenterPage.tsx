import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadError } from '../../components/ui/LoadError';
import { EmptyState } from '../../components/ui/EmptyState';
import { buttonClass } from '../../components/ui/Button';
import { useTrainingAccess } from '../../components/training/manage/manage-queries';
import { CoursesTab } from '../../components/training/manage/CoursesTab';
import { AssignmentsTab } from '../../components/training/manage/AssignmentsTab';
import { RulesTab } from '../../components/training/manage/RulesTab';
import { FeedbackTab } from '../../components/training/manage/FeedbackTab';
import { CertificatesTab } from '../../components/training/manage/CertificatesTab';
import { ReportsTab } from '../../components/training/manage/ReportsTab';
import { SettingsTab } from '../../components/training/manage/SettingsTab';
import { usePageName } from '../../lib/page-meta';

type TabKey = 'courses' | 'assignments' | 'rules' | 'feedback' | 'certificates' | 'reports' | 'settings';

interface Tab {
  key: TabKey;
  label: string;
  /** Administrators only. */
  admin?: boolean;
  element: () => ReactNode;
}

/** The Training Center's tabs, in order (Settings: administrators only). */
const TABS: readonly Tab[] = [
  { key: 'courses', label: 'Courses', element: () => <CoursesTab /> },
  { key: 'assignments', label: 'Assignments', element: () => <AssignmentsTab /> },
  { key: 'rules', label: 'Onboarding rules', element: () => <RulesTab /> },
  { key: 'feedback', label: 'Feedback', element: () => <FeedbackTab /> },
  { key: 'certificates', label: 'Certificates', element: () => <CertificatesTab /> },
  { key: 'reports', label: 'Reports', element: () => <ReportsTab /> },
  { key: 'settings', label: 'Settings', admin: true, element: () => <SettingsTab /> },
];

const SUBTITLE = 'Courses, assignments, onboarding rules and reports for everyone’s training';

/**
 * The Training Center (owner answers 4, 7, 11–17): Training managers and administrators author courses,
 * assign them, set onboarding rules, answer feedback, manage certificates and read the reports;
 * administrators also switch the first-time tour per company. A project manager who is neither sees only
 * the reports, for their own team (read-only). The open tab is in the address (?tab=reports).
 */
export function TrainingCenterPage() {
  usePageName('Training Center');
  const accessQ = useTrainingAccess();
  const a = accessQ.data;

  if (accessQ.isError) {
    return (
      <div data-page="training-center">
        <PageHeader title="Training Center" />
        <LoadError what="the Training Center" onRetry={() => void accessQ.refetch()} />
      </div>
    );
  }
  if (!a) {
    return (
      <div data-page="training-center">
        <PageHeader title="Training Center" />
        <div className="skeleton h-64 rounded-2xl" role="status" aria-label="Loading the Training Center" />
      </div>
    );
  }
  if (!a.manager && a.teamReports) {
    return (
      <div data-page="training-center">
        <PageHeader title="Training Center" subtitle="Your team’s training: who has done what, and what is overdue" />
        <ReportsTab readOnly />
      </div>
    );
  }
  if (!a.manager) {
    return (
      <div data-page="training-center">
        <PageHeader title="Training Center" />
        <EmptyState
          title="Only Training managers and administrators can open the Training Center"
          description="Your own courses, progress and certificates are in My training."
          action={<Link to="/training" className={buttonClass('primary', 'md', '!min-h-[44px]')}>Go to My training</Link>}
        />
      </div>
    );
  }
  return <ManagerTabs admin={a.admin} />;
}

export default TrainingCenterPage;

function ManagerTabs({ admin }: { admin: boolean }) {
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => !t.admin || admin);
  const current = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0]!;
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const show = (key: string, focus = false) => {
    setParams(key === tabs[0]!.key ? {} : { tab: key }, { replace: true });
    if (focus) buttons.current.get(key)?.focus();
  };

  // Arrow keys, Home and End move along the tabs (the open one is the only Tab stop).
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
    <div data-page="training-center" className="min-w-0">
      <PageHeader title="Training Center" subtitle={SUBTITLE} />
      {/* On a phone the tabs scroll sideways inside their own row; the page itself never does. */}
      <div role="tablist" aria-label="Training Center" onKeyDown={onKeyDown} className="-mb-px flex min-w-0 gap-1 overflow-x-auto border-b border-line">
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
              id={`training-tab-${t.key}`}
              aria-controls={`training-panel-${t.key}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => show(t.key)}
              className={`!min-h-[44px] flex-none whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${selected ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div key={current.key} role="tabpanel" id={`training-panel-${current.key}`} aria-labelledby={`training-tab-${current.key}`} className="mt-4 min-w-0">
        {current.element()}
      </div>
    </div>
  );
}
