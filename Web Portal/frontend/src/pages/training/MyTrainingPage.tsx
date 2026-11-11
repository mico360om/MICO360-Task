import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TRAINING_MODULES, type CatalogueFilters, type Difficulty, type TrainingModule } from '../../api/training';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadError } from '../../components/ui/LoadError';
import { PageHeader } from '../../components/ui/PageHeader';
import { CatalogueFilterBar, CourseGrid, MyTrainingSections } from '../../components/training/TrainingLists';
import { useTourStore } from '../../components/training/tour-store';
import { useCatalogue, useMyTraining } from '../../components/training/training-queries';
import { LearningHubTabs } from '../../components/training/LearningHubTabs';
import { usePageName } from '../../lib/page-meta';
import { BookIcon, TOUCH_MIN } from '../../components/training/training-ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

/** Staff see courses for every module but the Client portal's (those are for clients). */
const STAFF_MODULES = TRAINING_MODULES.filter((m) => m !== 'portal');
const isModule = (v: string | null): v is TrainingModule => !!v && (TRAINING_MODULES as readonly string[]).includes(v);
const isDifficulty = (v: string | null): v is Difficulty => v === 'BEGINNER' || v === 'INTERMEDIATE' || v === 'ADVANCED';

/**
 * The Learning Hub (Workspace; the owner's name for the Training Center, 11 Nov): "My learning" — what is assigned
 * (mandatory first, due days, red Overdue), in progress, completed and the certificates — and the "Catalogue" of
 * courses for the parts of the site the person can use. Administrators and Training managers also have Manage and
 * Reports; people who run a project, Reports (LearningHubTabs).
 */
export function MyTrainingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tab: 'mine' | 'catalogue' = params.get('tab') === 'catalogue' ? 'catalogue' : 'mine';
  const startTour = useTourStore((s) => s.start);
  usePageName(tab === 'catalogue' ? 'Catalogue' : 'My learning');

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Learning Hub"
        subtitle="Short courses on the parts of the site you use — at your own pace."
        learn="training"
        actions={
          <Button variant="secondary" size="sm" className={TOUCH_MIN} onClick={startTour}>
            Take the tour
          </Button>
        }
      />
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
        <span className="animate-pulse motion-reduce:animate-none">Loading your training…</span>
      </p>
    );
  }
  if (q.isError) return <LoadError what="your training" onRetry={() => void q.refetch()} />;
  return <MyTrainingSections data={q.data} onCatalogue={onCatalogue} />;
}

/** The catalogue: filters in the address (a Learn link or a back link opens it filtered), the server filters. */
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
      <CatalogueFilterBar value={filters} onChange={change} modules={STAFF_MODULES} />
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
