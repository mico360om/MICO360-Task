import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { AUDIENCES, COURSE_STATUSES, MODULE_LABELS, TRAINING_MODULES, type Audience, type CourseStatus, type ManageCourseRow, type TrainingModule } from '../../../api/training';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { LoadError } from '../../ui/LoadError';
import { fieldClass } from '../../ui/Field';
import { ModuleIcon } from '../ModuleIcon';
import { courseIconKey } from '../dashboard-rules';
import { AUDIENCE_LABELS, COURSE_STATUS_LABELS, CourseStatusChip, DIFFICULTY_LABELS, FilterField, Glyph, Notice, count, minutesText } from './manage-ui';
import { useManageCourses } from './manage-queries';
import { NewCourseDialog } from './NewCourseDialog';
import { CourseRowMenu, type RowNotice } from './CourseRowMenu';

type FactsOf = Pick<ManageCourseRow, 'moduleKey' | 'audience' | 'difficulty' | 'lessonCount' | 'minutes'> & Partial<Pick<ManageCourseRow, 'limitedTo' | 'moduleCount'>>;

/**
 * One course's facts, as the list and the editor say them: "Tasks · Staff · Beginner · 3 lessons · 25 min" — with who
 * it is limited to ("Admins only") after the audience, and its modules ("10 modules") before the lessons when it has some.
 */
export function courseFacts(c: FactsOf): string {
  return [
    MODULE_LABELS[c.moduleKey],
    AUDIENCE_LABELS[c.audience],
    c.limitedTo || null,
    DIFFICULTY_LABELS[c.difficulty],
    c.moduleCount ? count(c.moduleCount, 'module') : null,
    count(c.lessonCount, 'lesson'),
    minutesText(c.minutes),
  ]
    .filter((x): x is string => !!x)
    .join(' · ');
}

/**
 * A line about the course for its managers (a built-in course that was edited, so it was not merged: archive it when
 * ready), in the server's words — on its row in the list and at the top of its editor.
 */
export function CourseNoticeLine({ text, className = '' }: { text: string; className?: string }) {
  return <p className={`rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning ${className}`}>{text}</p>;
}

/**
 * The Courses tab: every course (drafts too), filtered by status, audience and module and searched by title; New
 * course; and a ⋯ menu on each course (Edit, Preview as learner, Assign, Publish…, Duplicate, Archive, Delete).
 * 1.23.33: Status "All" leaves archived courses out (as Projects' "All" does — on a site that had the 1.23.27 short
 * courses, ten of them are archived); "Show the N archived courses" (or Status → Archived) lists them.
 */
export function CoursesTab() {
  const ids = { status: useId(), audience: useId(), module: useId(), search: useId() };
  const [status, setStatus] = useState<CourseStatus | ''>('');
  const [audience, setAudience] = useState<Audience | ''>('');
  const [moduleKey, setModule] = useState<TrainingModule | ''>('');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 250);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<RowNotice | null>(null);
  const coursesQ = useManageCourses({ status, module: moduleKey, q, audience });
  const fetched = coursesQ.data?.courses ?? [];
  const courses = status ? fetched : fetched.filter((c) => c.status !== 'ARCHIVED');
  const archived = fetched.length - courses.length;
  const filtered = !!(status || audience || moduleKey || q);
  const showArchived = archived ? (
    <Button variant="secondary" onClick={() => setStatus('ARCHIVED')} className="!min-h-[44px] self-start">
      {archived === 1 ? 'Show the 1 archived course' : `Show the ${archived.toLocaleString('en-US')} archived courses`}
    </Button>
  ) : null;

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
        <FilterField label="Audience" htmlFor={ids.audience} className="min-w-[8rem] flex-1">
          <select id={ids.audience} value={audience} onChange={(e) => setAudience(e.target.value as Audience | '')} className={fieldClass(false, 'w-full')}>
            <option value="">All</option>
            {AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>)}
          </select>
        </FilterField>
        <FilterField label="Module" htmlFor={ids.module} className="min-w-[12rem] flex-1">
          {/* The chosen module's icon at the start of the field (13 Nov new look; General is no feature's: the book). */}
          <div className="relative">
            {moduleKey ? <ModuleIcon moduleKey={moduleKey === 'general' ? null : moduleKey} size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-2" /> : null}
            <select id={ids.module} value={moduleKey} onChange={(e) => setModule(e.target.value as TrainingModule | '')} className={fieldClass(false, `w-full ${moduleKey ? 'ps-9' : ''}`)}>
              <option value="">All modules</option>
              {TRAINING_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
            </select>
          </div>
        </FilterField>
        {!(coursesQ.isSuccess && fetched.length === 0 && !filtered) ? (
          <Button onClick={() => setCreating(true)} className="!min-h-[44px]">
            {Glyph.plus}
            New course
          </Button>
        ) : null}
      </div>

      {notice ? (
        <Notice tone={notice.tone}>
          {notice.text}
          {notice.editId ? (
            <>
              {' '}
              <Link to={`/training/manage/courses/${encodeURIComponent(notice.editId)}`} className="font-semibold underline">
                Edit the course
              </Link>
            </>
          ) : null}
        </Notice>
      ) : null}

      {coursesQ.isError ? (
        <LoadError what="the courses" onRetry={() => void coursesQ.refetch()} />
      ) : coursesQ.isLoading ? (
        <div className="skeleton h-48 rounded-2xl" role="status" aria-label="Loading courses" />
      ) : courses.length === 0 ? (
        archived && !filtered ? (
          <EmptyState title="Every course is archived" description="Archived courses aren’t listed here. Show them, or make a new course." action={showArchived} />
        ) : filtered ? (
          <EmptyState title="No courses match" description="Try another status, audience, module or search." />
        ) : (
          <EmptyState
            title="No courses yet"
            description="Make the first one: give it a title, add lessons, then publish it."
            action={<Button onClick={() => setCreating(true)} className="!min-h-[44px]">New course</Button>}
          />
        )
      ) : (
        // No overflow-hidden: a row's ⋯ menu opens below its button and must not be cut off by the list.
        <ul aria-label="Courses" className="card divide-y divide-line">
          {courses.map((c) => (
            <li key={c.id} className="flex items-start gap-2 py-2.5 pe-2 ps-4">
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="min-w-0 flex-[1_1_18rem]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/training/manage/courses/${encodeURIComponent(c.id)}`} dir="auto" className="inline-flex min-w-0 items-center font-semibold text-ink [overflow-wrap:anywhere] hover:text-brand hover:underline [@media(pointer:coarse)]:!min-h-11">
                      {c.title}
                    </Link>
                    <CourseStatusChip status={c.status} />
                    {c.unpublishedChanges ? <Badge tone="info">Changes not published</Badge> : null}
                  </div>
                  <p data-course-facts className="mt-0.5 flex items-start gap-1.5 text-xs text-ink-2">
                    <ModuleIcon moduleKey={courseIconKey(c)} size={14} className="mt-px" />
                    <span className="min-w-0">{courseFacts(c)}</span>
                  </p>
                  {c.notice ? <CourseNoticeLine text={c.notice} className="mt-1.5 !py-1.5 !text-xs" /> : null}
                </div>
                <p className="flex-none text-sm text-ink-2">{`${c.enrolled.toLocaleString('en-US')} taking it · ${c.completed.toLocaleString('en-US')} finished`}</p>
              </div>
              <CourseRowMenu course={c} onNotice={setNotice} />
            </li>
          ))}
        </ul>
      )}
      {courses.length ? showArchived : null}
      {creating ? <NewCourseDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
