import { useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TRAINING_MODULES, type CatalogueFilters, type Difficulty, type TrainingModule } from '../../api/training';
import { Button, buttonClass } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadError } from '../../components/ui/LoadError';
import { PageHeader } from '../../components/ui/PageHeader';
import { CatalogueFilterBar, CourseGrid, MyTrainingSections } from '../../components/training/TrainingLists';
import { useTourStore } from '../../components/training/tour-store';
import { useCatalogue, useMyTraining, useTrainingAccess } from '../../components/training/training-queries';
import { BookIcon, TOUCH_MIN } from '../../components/training/training-ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

type Tab = 'mine' | 'catalogue';
const TABS: { key: Tab; label: string }[] = [
  { key: 'mine', label: 'My training' },
  { key: 'catalogue', label: 'Catalogue' },
];

/** Staff see courses for every module but the Client portal's (those are for clients). */
const STAFF_MODULES = TRAINING_MODULES.filter((m) => m !== 'portal');
const isModule = (v: string | null): v is TrainingModule => !!v && (TRAINING_MODULES as readonly string[]).includes(v);
const isDifficulty = (v: string | null): v is Difficulty => v === 'BEGINNER' || v === 'INTERMEDIATE' || v === 'ADVANCED';

/**
 * My training (Workspace): what is assigned (mandatory first, due days, red Overdue), in progress, completed and
 * the certificates; the catalogue of courses for the parts of the site the person can use. Training managers and
 * administrators reach the Training Center from here; people who run a project, their team's training.
 */
export function MyTrainingPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'catalogue' ? 'catalogue' : 'mine';
  const access = useTrainingAccess().data;
  const startTour = useTourStore((s) => s.start);
  const buttons = useRef(new Map<Tab, HTMLButtonElement>());

  const go = (next: Tab) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'catalogue') p.set('tab', 'catalogue');
        else {
          p.delete('tab');
          p.delete('module');
          p.delete('difficulty');
          p.delete('q');
        }
        return p;
      },
      { replace: true },
    );
  };
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === tab);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    const next = TABS[j]!.key;
    go(next);
    buttons.current.get(next)?.focus();
  };

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="My training"
        subtitle="Short courses on the parts of the site you use — at your own pace."
        learn="training"
        actions={
          <>
            <Button variant="secondary" size="sm" className={TOUCH_MIN} onClick={startTour}>
              Take the tour
            </Button>
            {access?.manager ? (
              <Link to="/training/manage" className={buttonClass('primary', 'sm', TOUCH_MIN)}>
                Training Center
              </Link>
            ) : access?.teamReports ? (
              <Link to="/training/manage" className={buttonClass('secondary', 'sm', TOUCH_MIN)}>
                Team training
              </Link>
            ) : null}
          </>
        }
      />
      <div role="tablist" aria-label="My training" onKeyDown={onTabKey} className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => {
          const selected = t.key === tab;
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
              onClick={() => go(t.key)}
              className={`!min-h-[44px] flex-none border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${selected ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`training-panel-${tab}`} aria-labelledby={`training-tab-${tab}`} className="mt-4">
        {tab === 'mine' ? <MinePanel onCatalogue={() => go('catalogue')} /> : <CataloguePanel />}
      </div>
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
