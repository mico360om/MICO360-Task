import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { type CatalogueFilters, type TrainingModule } from '../../api/training';
import { usePortalApi, usePortalPreview, usePreviewOff } from '../../components/portal/portal-context';
import { usePortalTraining } from '../../components/portal/portal-queries';
import { LoadFailed, Loading, TOUCH, usePortalPageName } from '../../components/portal/portal-ui';
import { CourseView } from '../../components/training/CourseView';
import { LessonPlayer } from '../../components/training/LessonPlayer';
import { CatalogueFilterBar, CourseGrid, MyTrainingSections, filterCourses } from '../../components/training/TrainingLists';
import { LearnerProvider, usePortalSide } from '../../components/training/learner';
import { useTourStore } from '../../components/training/tour-store';
import { useCourse, useLessonView } from '../../components/training/training-queries';
import { BookIcon } from '../../components/training/training-ui';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';

/** The portal's pages read and write training through the portal's API (the client's own, or a preview's). */
function PortalTrainingSide({ children }: { children: ReactNode }) {
  const side = usePortalSide(usePortalApi());
  return <LearnerProvider side={side}>{children}</LearnerProvider>;
}

const PortalH1 = ({ children }: { children: ReactNode }) => <h1 className="break-words font-display text-2xl font-bold text-ink sm:text-3xl">{children}</h1>;

/**
 * Help & training (owner answer 1): the client's own training — what the team assigned (with due days and a red
 * Overdue), in progress, completed, certificates — and the courses meant for clients. Badges only, no emails.
 */
export function PortalTrainingPage() {
  usePortalPageName(null);
  return (
    <PortalTrainingSide>
      <PortalTrainingHome />
    </PortalTrainingSide>
  );
}

function PortalTrainingHome() {
  const q = usePortalTraining();
  const preview = usePortalPreview();
  const off = usePreviewOff();
  const startTour = useTourStore((s) => s.start);
  const [filters, setFilters] = useState<Required<CatalogueFilters>>({ module: '', difficulty: '', q: '' });
  const modules = useMemo(() => [...new Set((q.data?.catalogue ?? []).map((c) => c.moduleKey))] as TrainingModule[], [q.data]);
  const shown = useMemo(() => filterCourses(q.data?.catalogue ?? [], filters), [q.data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <PortalH1>Learning Hub</PortalH1>
          <p className="mt-1 text-sm text-ink-2">Short courses on using the Client portal — at your own pace.</p>
        </div>
        <Button variant="secondary" size="sm" className={`${TOUCH} ${off.className}`} disabled={off.disabled} title={off.title} onClick={startTour}>
          Take the tour
        </Button>
      </div>
      {q.isPending ? (
        <Loading what="your training" />
      ) : q.isError ? (
        <LoadFailed what="your training" onRetry={() => void q.refetch()} />
      ) : (
        <>
          <MyTrainingSections data={q.data} />
          <section aria-labelledby="portal-courses" className="flex flex-col gap-3">
            <h2 id="portal-courses" className="font-display text-base font-bold text-ink">
              Courses <span className="font-normal text-ink-2">({q.data.catalogue.length})</span>
            </h2>
            {q.data.catalogue.length ? (
              <>
                {q.data.catalogue.length > 3 ? <CatalogueFilterBar value={filters} onChange={setFilters} modules={modules} /> : null}
                {shown.length ? (
                  <CourseGrid courses={shown} />
                ) : (
                  <p className="text-sm text-ink-2" role="status">
                    No courses match.
                  </p>
                )}
              </>
            ) : (
              <EmptyState
                titleAs="h3"
                icon={<BookIcon size={24} />}
                title={preview ? 'Preview — the client’s courses aren’t shown here.' : 'No courses yet.'}
                description={preview ? 'The client sees the courses meant for clients and what is assigned to them.' : 'When the team publishes a course for clients, it appears here.'}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** One course in the portal. */
export function PortalTrainingCoursePage() {
  const { id = '' } = useParams();
  return (
    <PortalTrainingSide>
      <PortalCourse id={id} />
    </PortalTrainingSide>
  );
}

function PortalCourse({ id }: { id: string }) {
  usePortalPageName(useCourse(id).data?.title);
  return <CourseView key={id} courseId={id} renderHeader={(title) => <PortalH1>{title}</PortalH1>} />;
}

/** One lesson in the portal. */
export function PortalTrainingLessonPage() {
  const { courseId = '', lessonId = '' } = useParams();
  return (
    <PortalTrainingSide>
      <PortalLesson courseId={courseId} lessonId={lessonId} />
    </PortalTrainingSide>
  );
}

function PortalLesson({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  usePortalPageName(useLessonView(lessonId).data?.title);
  return <LessonPlayer key={lessonId} courseId={courseId} lessonId={lessonId} renderTitle={(title) => <PortalH1>{title}</PortalH1>} />;
}
