import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Breadcrumbs } from '../../components/ui/Breadcrumbs';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadError } from '../../components/ui/LoadError';
import { EmptyState } from '../../components/ui/EmptyState';
import { buttonClass } from '../../components/ui/Button';
import { ApiError } from '../../lib/api-client';
import { usePageName } from '../../lib/page-meta';
import { manageKeys, tc, useManageOptions } from '../../components/training/manage/manage-queries';
import { CourseNoticeLine, courseFacts } from '../../components/training/manage/CoursesTab';
import { CourseDetailsForm } from '../../components/training/manage/CourseDetailsForm';
import { PublishPanel } from '../../components/training/manage/PublishPanel';
import { ModulesEditor } from '../../components/training/manage/ModulesEditor';
import { LessonsEditor } from '../../components/training/manage/LessonsEditor';
import { DownloadsSection } from '../../components/training/manage/DownloadsSection';

/** "Learning Hub › Manage › <course>". */
const crumbs = (title: ReactNode) => (
  <Breadcrumbs
    items={[
      { label: 'Learning Hub', to: '/training' },
      { label: 'Manage', to: '/training/manage' },
      { label: title },
    ]}
  />
);

/**
 * Learning Hub → Manage → a course's editor (Training managers and administrators): Publish and the course's state,
 * its details, its modules (who sees each one), its lessons (videos, step-by-step guides, documents and quizzes, in
 * order) and its downloads. "Preview as learner" opens the course as learners see it. A notice about the course (a
 * built-in course that was edited, so it wasn't merged) is shown at the top. `?publish=1` (the Manage list's "Publish
 * changes" / "Publish again") opens the publish window at once, then leaves the address.
 */
export function CourseEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const [arrival] = useState(() => ({ id, publish: params.get('publish') === '1' }));
  // ?publish=1 stays armed until the first settled state (data present, nothing fetching): a stale cached copy is refreshed first, a fresh one is not.
  const [armed, setArmed] = useState(true);
  const courseQ = useQuery({ queryKey: manageKeys.course(id), queryFn: () => tc().manageCourse(id), enabled: !!id });
  const optionsQ = useManageOptions(courseQ.isSuccess);
  const course = courseQ.data;
  usePageName(course ? course.title : 'Edit course');

  const refreshed = courseQ.isSuccess && !courseQ.isFetching;
  useEffect(() => {
    if (refreshed) setArmed(false);
  }, [refreshed]);

  // Once read, ?publish=1 leaves the address (a reload or Back doesn't open the window again).
  useEffect(() => {
    if (!params.has('publish')) return;
    const next = new URLSearchParams(params);
    next.delete('publish');
    setParams(next, { replace: true });
  }, [params, setParams]);

  if (courseQ.isError) {
    const status = courseQ.error instanceof ApiError ? courseQ.error.status : 0;
    return (
      <div data-page="course-editor">
        {crumbs('Edit course')}
        <PageHeader title="Edit course" />
        {status === 403 ? (
          <EmptyState title="Only Training managers and administrators can manage the Learning Hub" description="Your own courses are in My learning." action={<Link to="/training" className={buttonClass('primary', 'md', '!min-h-[44px]')}>Go to My learning</Link>} />
        ) : status === 404 ? (
          <EmptyState title="This course doesn’t exist" description="It may have been deleted." />
        ) : (
          <LoadError what="the course" onRetry={() => void courseQ.refetch()} />
        )}
      </div>
    );
  }
  if (!course) {
    return (
      <div data-page="course-editor">
        {crumbs('Edit course')}
        <PageHeader title="Edit course" />
        <div className="skeleton h-96 rounded-2xl" role="status" aria-label="Loading the course" />
      </div>
    );
  }

  return (
    <div data-page="course-editor" className="min-w-0">
      {crumbs(<bdi>{course.title}</bdi>)}
      <PageHeader
        title={course.title}
        actions={
          <Link to={`/training/courses/${encodeURIComponent(course.id)}`} className={buttonClass('secondary', 'md', '!min-h-[44px]')}>
            Preview as learner
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm text-ink-2">{courseFacts({ ...course, lessonCount: course.lessons.length, minutes: course.lessons.reduce((s, l) => s + l.minutes, 0), moduleCount: course.modules.length })}</span>
        {course.status === 'PUBLISHED' ? (
          <Link to={`/training/manage?tab=assignments&course=${encodeURIComponent(course.id)}&assign=1`} className="inline-flex items-center text-sm font-semibold text-brand hover:underline [@media(pointer:coarse)]:!min-h-11">
            Assign this course
          </Link>
        ) : null}
      </div>
      {course.notice ? <CourseNoticeLine text={course.notice} className="mb-4" /> : null}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:order-last lg:sticky lg:top-4">
          <PublishPanel key={course.id} course={course} startPublishing={armed && arrival.publish && arrival.id === course.id} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CourseDetailsForm key={course.id} course={course} options={optionsQ.data} />
          <ModulesEditor course={course} />
          <LessonsEditor course={course} />
          <DownloadsSection course={course} />
        </div>
      </div>
    </div>
  );
}

export default CourseEditorPage;
