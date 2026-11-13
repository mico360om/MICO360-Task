import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TRAINING_MODULES, type CatalogueFilters, type Difficulty, type TrainingModule } from '../../api/training';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadError } from '../../components/ui/LoadError';
import { PageHeader } from '../../components/ui/PageHeader';
import { CatalogueFilterBar, CourseGrid, MyLearningSections } from '../../components/training/TrainingLists';
import { useCatalogue, useMyTraining } from '../../components/training/training-queries';
import { LearningHubTabs } from '../../components/training/LearningHubTabs';
import { usePageName } from '../../lib/page-meta';
import { BookIcon } from '../../components/training/training-ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

/** Staff see courses for every module but the Client portal's (those are for clients). */
const STAFF_MODULES = TRAINING_MODULES.filter((m) => m !== 'portal');
const isModule = (v: string | null): v is TrainingModule => !!v && (TRAINING_MODULES as readonly string[]).includes(v);
const isDifficulty = (v: string | null): v is Difficulty => v === 'BEGINNER' || v === 'INTERMEDIATE' || v === 'ADVANCED';

/** All courses shows its Module filter above this many courses (12 Nov §3). */
const MODULE_FILTER_ABOVE = 8;

/**
 * The Learning Hub (12 Nov, simple and to the point; 13 Nov new look): "My learning" — a learning dashboard (Up next,
 * progress, every module as a tile, the certificate, other courses), then Done — and "All courses" for the parts of
 * the site the person can use. Administrators and Training managers also
 * have Manage and Reports; people who run a project with assigned team courses, Reports (LearningHubTabs). The tour
 * is "Tour of the site" in the account menu.
 */
export function MyTrainingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tab: 'mine' | 'catalogue' = params.get('tab') === 'catalogue' ? 'catalogue' : 'mine';
  usePageName(tab === 'catalogue' ? 'All courses' : 'My learning');

  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Learning Hub" subtitle="Your training, one part at a time." learn="training" />
      <LearningHubTabs current={tab} />
      <div className="mt-4">{tab === 'mine' ? <MinePanel onCatalogue={() => navigate('/training?tab=catalogue')} /> : <CataloguePanel />}</div>
    </div>
  );
}

function MinePanel({ onCatalogue }: { onCatalogue: () => void }) {
  const q = useMyTraining();
  if (q.isPending) {
    return (
      <p role="status" className="py-12 text-center text-sm text-ink-2">
        <span className="animate-pulse motion-reduce:animate-none">Loading your courses…</span>
      </p>
    );
  }
  if (q.isError) return <LoadError what="your courses" onRetry={() => void q.refetch()} />;
  return <MyLearningSections data={q.data} onBrowse={onCatalogue} />;
}

/**
 * All courses: filters in the address (a Learn link or a back link opens it filtered: R7), the server filters. The
 * Module filter shows above 8 courses and Difficulty when the courses differ (read from the whole list).
 */
function CataloguePanel() {
  const [params, setParams] = useSearchParams();
  const fromAddress = (): Required<CatalogueFilters> => ({
    module: isModule(params.get('module')) ? (params.get('module') as TrainingModule) : '',
    difficulty: isDifficulty(params.get('difficulty')) ? (params.get('difficulty') as Difficulty) : '',
    q: params.get('q') ?? '',
  });
  const [typed, setTyped] = useState(fromAddress().q);
  const filters = { ...fromAddress(), q: typed };
  // The search is asked for once typing pauses.
  const search = useDebouncedValue(typed.trim(), 300);
  const q = useCatalogue({ module: filters.module, difficulty: filters.difficulty, q: search });
  const all = useCatalogue({ module: '', difficulty: '', q: '' });
  const everything = all.data?.courses ?? [];
  const showModule = everything.length > MODULE_FILTER_ABOVE;
  const showDifficulty = new Set(everything.map((c) => c.difficulty)).size > 1;

  const change = (v: Required<CatalogueFilters>) => {
    setTyped(v.q);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('tab', 'catalogue');
        for (const [k, val] of [
          ['module', v.module],
          ['difficulty', v.difficulty],
          ['q', v.q.trim()],
        ] as const) {
          if (val) p.set(k, val);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <CatalogueFilterBar value={filters} onChange={change} modules={STAFF_MODULES} showModule={showModule} showDifficulty={showDifficulty} />
      {q.isPending ? (
        <p role="status" className="py-12 text-center text-sm text-ink-2">
          <span className="animate-pulse motion-reduce:animate-none">Loading the courses…</span>
        </p>
      ) : q.isError ? (
        <LoadError what="the courses" onRetry={() => void q.refetch()} />
      ) : q.data.courses.length === 0 ? (
        <EmptyState
          titleAs="h2"
          icon={<BookIcon size={24} />}
          title={filters.module || filters.difficulty || filters.q ? 'No courses match.' : 'No courses yet.'}
          description={filters.module || filters.difficulty || filters.q ? 'Try another search or filter.' : 'Courses appear here when the training team publishes them.'}
        />
      ) : (
        <>
          <p className="text-sm text-ink-2" role="status">
            {q.data.courses.length} {q.data.courses.length === 1 ? 'course' : 'courses'}
          </p>
          <CourseGrid courses={q.data.courses} module={filters.module || null} />
        </>
      )}
    </div>
  );
}
