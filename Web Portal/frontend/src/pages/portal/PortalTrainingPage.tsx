import { useId, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { type CatalogueFilters, type TrainingModule } from "../../api/training";
import {
  usePortalApi,
  usePortalPreview,
  usePreviewOff,
} from "../../components/portal/portal-context";
import { usePortalTraining } from "../../components/portal/portal-queries";
import {
  LoadFailed,
  Loading,
  TOUCH,
  usePortalPageName,
} from "../../components/portal/portal-ui";
import { CourseView } from "../../components/training/CourseView";
import { LessonPlayer } from "../../components/training/LessonPlayer";
import {
  CatalogueFilterBar,
  CourseGrid,
  MyLearningSections,
  filterCourses,
} from "../../components/training/TrainingLists";
import {
  LearnerProvider,
  usePortalSide,
} from "../../components/training/learner";
import { useTourStore } from "../../components/training/tour-store";
import {
  useCourse,
  useLessonView,
} from "../../components/training/training-queries";
import { learningGroups } from "../../components/training/training-words";
import { BookIcon } from "../../components/training/training-ui";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";

/** The portal's pages read and write training through the portal's API (the client's own, or a preview's). */
function PortalTrainingSide({ children }: { children: ReactNode }) {
  const side = usePortalSide(usePortalApi());
  return <LearnerProvider side={side}>{children}</LearnerProvider>;
}

const PortalH1 = ({ children }: { children: ReactNode }) => (
  <h1 className="break-words font-display text-2xl font-bold text-ink sm:text-3xl">
    {children}
  </h1>
);

/**
 * The portal's Learning Hub (owner answer 1; 12 Nov §8; 13 Nov new look): the same learning dashboard as staff — Up
 * next, the progress ring, the guide's own lessons (or modules) as tiles, the certificate card, other courses — then
 * Done, then the other courses meant for clients — a course already above is never listed twice; the filters only above
 * 3 courses. In the portal's own words (its subtitle; no Browse all courses, Manage, Reports or Check it online), every
 * link inside the portal. "Tour of the site" stays here (the portal has no account menu). Badges only, no emails.
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
  const [filters, setFilters] = useState<Required<CatalogueFilters>>({
    module: "",
    difficulty: "",
    q: "",
  });
  const coursesId = useId();
  // The courses not listed above already (To do, Done or Up next).
  const others = useMemo(() => {
    if (!q.data) return [];
    const g = learningGroups(q.data);
    const listed = new Set([
      ...(g.upNext ? [g.upNext.id] : []),
      ...g.todo.map((c) => c.id),
      ...g.done.map((c) => c.id),
    ]);
    return q.data.catalogue.filter((c) => !listed.has(c.id));
  }, [q.data]);
  const anyListed = !!q.data && others.length < q.data.catalogue.length;
  const modules = useMemo(
    () => [...new Set(others.map((c) => c.moduleKey))] as TrainingModule[],
    [others],
  );
  const shown = useMemo(
    () => filterCourses(others, filters),
    [others, filters],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <PortalH1>Learning Hub</PortalH1>
          <p className="mt-1 text-sm text-ink-2">
            Short courses on using the Client portal.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={`${TOUCH} ${off.className}`}
          disabled={off.disabled}
          title={off.title}
          onClick={startTour}
        >
          Tour of the site
        </Button>
      </div>
      {q.isPending ? (
        <Loading what="your courses" />
      ) : q.isError ? (
        <LoadFailed what="your courses" onRetry={() => void q.refetch()} />
      ) : (
        <>
          <MyLearningSections data={q.data} />
          {others.length || !q.data.catalogue.length ? (
            <section
              aria-labelledby={coursesId}
              className="flex flex-col gap-3"
            >
              <h2
                id={coursesId}
                className="font-display text-base font-bold text-ink"
              >
                {anyListed ? "More courses" : "Courses"}{" "}
                <span className="font-normal text-ink-2">
                  ({others.length})
                </span>
              </h2>
              {others.length ? (
                <>
                  {others.length > 3 ? (
                    <CatalogueFilterBar
                      value={filters}
                      onChange={setFilters}
                      modules={modules}
                      showModule={modules.length > 1}
                      showDifficulty={
                        new Set(others.map((c) => c.difficulty)).size > 1
                      }
                    />
                  ) : null}
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
                  title={
                    preview
                      ? "Preview — the client’s courses aren’t shown here."
                      : "No courses yet."
                  }
                  description={
                    preview
                      ? "The client sees the courses meant for clients and what is assigned to them."
                      : "When the team publishes a course for clients, it appears here."
                  }
                />
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One course in the portal. */
export function PortalTrainingCoursePage() {
  const { id = "" } = useParams();
  return (
    <PortalTrainingSide>
      <PortalCourse id={id} />
    </PortalTrainingSide>
  );
}

function PortalCourse({ id }: { id: string }) {
  usePortalPageName(useCourse(id).data?.title);
  return (
    <CourseView
      key={id}
      courseId={id}
      renderHeader={(title) => <PortalH1>{title}</PortalH1>}
    />
  );
}

/** One lesson in the portal. */
export function PortalTrainingLessonPage() {
  const { courseId = "", lessonId = "" } = useParams();
  return (
    <PortalTrainingSide>
      <PortalLesson courseId={courseId} lessonId={lessonId} />
    </PortalTrainingSide>
  );
}

function PortalLesson({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) {
  usePortalPageName(useLessonView(lessonId).data?.title);
  return (
    <LessonPlayer
      key={lessonId}
      courseId={courseId}
      lessonId={lessonId}
      renderTitle={(title) => <PortalH1>{title}</PortalH1>}
    />
  );
}
