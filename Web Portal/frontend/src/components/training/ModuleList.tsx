import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CourseDetail, LessonOutline, ModuleOutline, ModuleStatus } from '../../api/training';
import { STATUS_CLASS } from '../../lib/colour-classes';
import { lessonPath, useLearner } from './learner';
import { LessonKindIcon, LockIcon, NewForRoleChip, TickIcon } from './training-ui';
import { LESSON_KIND_WORDS, minutesText, moduleStatusWords } from './training-words';

/**
 * One lesson in a course's outline (a plain course's list, or a module's): its number or a tick, title, kind and
 * minutes, and Review / Done / Locked; a link to the lesson unless it is locked (then said why, not a link).
 */
export function LessonRow({ courseId, lesson: l, number }: { courseId: string; lesson: LessonOutline; number: number }) {
  const side = useLearner();
  const inner = (
    <>
      <span className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-semibold ${l.done ? 'bg-success-soft text-success' : 'bg-ground text-ink-2'}`}>
        {l.done ? <TickIcon size={13} /> : number}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block break-words text-sm font-semibold ${l.locked ? 'text-ink-2' : 'text-ink'}`}>
          <bdi>{l.title}</bdi>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-2">
          <LessonKindIcon kind={l.kind} size={13} />
          <span>{LESSON_KIND_WORDS[l.kind]}</span>
          {minutesText(l.minutes) ? <span>· {minutesText(l.minutes)}</span> : null}
        </span>
      </span>
      <span className="flex flex-none flex-wrap items-center justify-end gap-1.5">
        {l.review ? <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning">Review</span> : null}
        {l.done ? <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS.DONE.chip}`}>Done</span> : null}
        {l.locked ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-2">
            <LockIcon size={13} />
            Locked
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <li>
      {l.locked ? (
        <div className="flex items-start gap-2.5 py-2.5" title="Finish the lessons before it first">
          {inner}
          <span className="sr-only">Finish the lessons before it first.</span>
        </div>
      ) : (
        <Link to={lessonPath(side.base, courseId, l.id)} className="-mx-2 flex min-h-11 items-start gap-2.5 rounded-lg px-2 py-2.5 outline-none transition-colors hover:bg-ground focus-visible:ring-2 focus-visible:ring-brand/40">
          {inner}
        </Link>
      )}
    </li>
  );
}

const STATUS_TONE: Record<ModuleStatus, string> = {
  DONE: 'font-semibold text-success',
  IN_PROGRESS: 'font-semibold text-ink',
  NOT_STARTED: 'text-ink-2',
};

/**
 * The course's modules (1.23.30 §3.3), in order — only those the person sees: each with its state in words ("Not
 * started", "In progress · 2 of 5 lessons", "Done · 3 Nov 2026"), its minutes and "New for your role" (D3). A module
 * opens to list its lessons with ticks (any visible module may be opened: D4). `openId` (the address's `?moduleId=`,
 * an old short course's link or Learn this feature) opens that module and brings it into view.
 */
export function ModuleList({ course: c, openId }: { course: CourseDetail; openId: string | null }) {
  const id = useId();
  // What the person opened or closed; otherwise only the module the address names is open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const byId = new Map(c.lessons.map((l) => [l.id, l]));
  const isOpen = (m: ModuleOutline) => toggled[m.id] ?? m.id === openId;

  useEffect(() => {
    if (openId) document.getElementById(`module-${openId}`)?.scrollIntoView?.({ block: 'start' });
  }, [openId]);

  return (
    <section aria-labelledby={`${id}-title`} className="card card-pad">
      <h2 id={`${id}-title`} className="mb-2 font-display text-base font-bold text-ink">
        Modules
      </h2>
      <ol className="flex flex-col divide-y divide-line">
        {c.modules.map((m, i) => {
          const open = isOpen(m);
          const panel = `${id}-${m.id}`;
          const lessons = m.lessonIds.map((lid) => byId.get(lid)).filter((l): l is LessonOutline => !!l);
          return (
            <li key={m.id} id={`module-${m.id}`} data-module={m.id} className="scroll-mt-20">
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? panel : undefined}
                  onClick={() => setToggled((t) => ({ ...t, [m.id]: !open }))}
                  className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-2.5 text-start outline-none transition-colors hover:bg-ground focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <span aria-hidden="true" className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-semibold ${m.status === 'DONE' ? 'bg-success-soft text-success' : 'bg-ground text-ink-2'}`}>
                    {m.status === 'DONE' ? <TickIcon size={13} /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span data-module-title className="block break-words text-sm font-semibold text-ink">
                      <bdi>{m.title}</bdi>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2">
                      <span className={STATUS_TONE[m.status]}>{moduleStatusWords(m)}</span>
                      {minutesText(m.minutes) ? <span>· {minutesText(m.minutes)}</span> : null}
                      {m.newForRole ? <NewForRoleChip /> : null}
                    </span>
                  </span>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`mt-1 flex-none text-ink-2 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </h3>
              {open ? (
                <ol id={panel} className="mb-2 flex flex-col divide-y divide-line ps-8">
                  {lessons.map((l, j) => (
                    <LessonRow key={l.id} courseId={c.id} lesson={l} number={j + 1} />
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
