import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { COURSE_STATUSES, MODULE_LABELS, TRAINING_MODULES, type CourseStatus, type ManageCourseRow, type TrainingModule } from '../../../api/training';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { LoadError } from '../../ui/LoadError';
import { fieldClass } from '../../ui/Field';
import { AUDIENCE_LABELS, COURSE_STATUS_LABELS, CourseStatusChip, DIFFICULTY_LABELS, FilterField, Glyph, StarterChip, count, minutesText } from './manage-ui';
import { useManageCourses } from './manage-queries';
import { NewCourseDialog } from './NewCourseDialog';

/** One course's facts, as the list and the editor say them: "Tasks · Staff · Beginner · 3 lessons · 25 min". */
export function courseFacts(c: Pick<ManageCourseRow, 'moduleKey' | 'audience' | 'difficulty' | 'lessonCount' | 'minutes'>): string {
  return [MODULE_LABELS[c.moduleKey], AUDIENCE_LABELS[c.audience], DIFFICULTY_LABELS[c.difficulty], count(c.lessonCount, 'lesson'), minutesText(c.minutes)].join(' · ');
}

/** The Courses tab: every course (drafts too), filtered by status and module and searched by title; New course. */
export function CoursesTab() {
  const ids = { status: useId(), module: useId(), search: useId() };
  const [status, setStatus] = useState<CourseStatus | ''>('');
  const [moduleKey, setModule] = useState<TrainingModule | ''>('');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 250);
  const [creating, setCreating] = useState(false);
  const coursesQ = useManageCourses({ status, module: moduleKey, q });
  const courses = coursesQ.data?.courses ?? [];
  const filtered = !!(status || moduleKey || q);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label="Search courses" htmlFor={ids.search} className="min-w-[12rem] flex-[2_1_14rem]">
          <input id={ids.search} type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder="Course title" className={fieldClass(false, 'w-full')} />
        </FilterField>
        <FilterField label="Status" htmlFor={ids.status} className="min-w-[9rem] flex-1">
          <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as CourseStatus | '')} className={fieldClass(false, 'w-full')}>
            <option value="">All</option>
            {COURSE_STATUSES.map((s) => <option key={s} value={s}>{COURSE_STATUS_LABELS[s]}</option>)}
          </select>
        </FilterField>
        <FilterField label="Module" htmlFor={ids.module} className="min-w-[10rem] flex-1">
          <select id={ids.module} value={moduleKey} onChange={(e) => setModule(e.target.value as TrainingModule | '')} className={fieldClass(false, 'w-full')}>
            <option value="">All modules</option>
            {TRAINING_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
          </select>
        </FilterField>
        {!(coursesQ.isSuccess && courses.length === 0 && !filtered) ? (
          <Button onClick={() => setCreating(true)} className="!min-h-[44px]">
            {Glyph.plus}
            New course
          </Button>
        ) : null}
      </div>

      {coursesQ.isError ? (
        <LoadError what="the courses" onRetry={() => void coursesQ.refetch()} />
      ) : coursesQ.isLoading ? (
        <div className="skeleton h-48 rounded-2xl" role="status" aria-label="Loading courses" />
      ) : courses.length === 0 ? (
        filtered ? (
          <EmptyState title="No courses match" description="Try another status, module or search." />
        ) : (
          <EmptyState
            title="No courses yet"
            description="Make the first one: give it a title, add lessons, then publish it."
            action={<Button onClick={() => setCreating(true)} className="!min-h-[44px]">New course</Button>}
          />
        )
      ) : (
        <ul aria-label="Courses" className="card divide-y divide-line overflow-hidden">
          {courses.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
              <div className="min-w-0 flex-[1_1_18rem]">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/training/manage/courses/${encodeURIComponent(c.id)}`} dir="auto" className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere] hover:text-brand hover:underline">
                    {c.title}
                  </Link>
                  <CourseStatusChip status={c.status} />
                  {c.starter ? <StarterChip /> : null}
                  {c.unpublishedChanges ? <Badge tone="info">Changes not published</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-ink-2">{courseFacts(c)}</p>
              </div>
              <p className="flex-none text-sm text-ink-2">{`${c.enrolled.toLocaleString('en-US')} enrolled · ${c.completed.toLocaleString('en-US')} completed`}</p>
            </li>
          ))}
        </ul>
      )}
      {creating ? <NewCourseDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
