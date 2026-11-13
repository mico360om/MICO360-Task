import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DIFFICULTIES, MODULE_LABELS, type CatalogueFilters, type CertificateRef, type CourseCard, type CourseDetail, type Difficulty, type MyTraining, type TrainingModule } from '../../api/training';
import { OVERDUE_CLASS, STATUS_CLASS } from '../../lib/colour-classes';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { Button, buttonClass } from '../ui/Button';
import { CertificatePanel } from './CertificatePanel';
import { ModuleIcon } from './ModuleIcon';
import { LessonTile, ModuleTile } from './ModuleTile';
import { ProgressRing } from './ProgressRing';
import { courseIconKey, dashboardFocus, lessonsLeft, mainAction, MAIN_ACTION_WORDS, minutesLeftText, moduleKeyOf, upNextModule } from './dashboard-rules';
import { coursePath, lessonPath, useLearner } from './learner';
import { useCourse } from './training-queries';
import { AwardIcon, BookIcon, CardChipView, CourseCardView, DownloadIcon, MandatoryChip, NewForRoleChip, TickIcon, TOUCH_MIN, trainingProblem, useCourseGo } from './training-ui';
import { CERTIFICATE_WORDS, DIFFICULTY_WORDS, LESSON_KIND_WORDS, cardChip, dueText, instantDay, learningGroups, lessonsText, minutesText, modulesText, progressWords } from './training-words';

/**
 * My learning's pieces and All courses' cards and filters, shared by the staff page and the Client portal's Learning
 * Hub (12 Nov design §2, §3, §8; 13 Nov new look): the learning dashboard (Up next, progress, the tiles, the
 * certificate, other courses), then "Done" (each course once), older certificates behind one link, and the slim
 * course cards.
 */

const fieldClass = `h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 ${TOUCH_MIN}`;

/**
 * A grid of course cards (each opening its page; `module` keeps All courses' filter for the way back). Each cell is a
 * flex box the card fills, so the cards of a row are as tall as each other and their buttons line up.
 */
export function CourseGrid({ courses, module, showState = true, extra, id }: { courses: CourseCard[]; module?: string | null; showState?: boolean; extra?: (c: CourseCard) => ReactNode; id?: string }) {
  const { base } = useLearner();
  return (
    <ul id={id} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {courses.map((c) => (
        <li key={c.id} className="flex min-w-0">
          <CourseCardView course={c} to={coursePath(base, c.id, module)} showState={showState} extra={extra?.(c)} />
        </li>
      ))}
    </ul>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-display text-base font-bold text-ink">
        {title} <span className="font-normal text-ink-2">({count})</span>
      </h2>
      {children}
    </section>
  );
}

/** Downloads a certificate's PDF (its own name when the server gives one). */
function useCertificateDownload() {
  const { api } = useLearner();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = async (cert: Pick<CertificateRef, 'id' | 'code'>) => {
    setBusy(cert.id);
    setError(null);
    try {
      const blob = await api.certificatePdf(cert.id);
      downloadBlob(fileNameOf(blob) ?? `certificate-${cert.code}.pdf`, blob);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t download the certificate.'));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, download };
}

/** The Done list shows this many cards, then "Show all N" (ruling: folds above 6). */
const DONE_FOLD = 6;

/**
 * My learning as a learning dashboard (13 Nov new look, staff and the Client portal): the course that fills it (Up
 * next by today's rule) — Up next, its progress ring, every module of theirs as a tile, its certificate — and the other
 * open courses beside it; then "Done" (a Done card carries its certificate; more than 6 fold behind "Show all N") and
 * "Older certificates" only when some certificate has no Done card (R6). Everything done: "All done, well done". Nothing
 * at all: one line and `onBrowse` ("Browse all courses").
 */
export function MyLearningSections({ data, onBrowse }: { data: Pick<MyTraining, 'assigned' | 'inProgress' | 'completed' | 'certificates'>; onBrowse?: () => void }) {
  const g = learningGroups(data);
  const focus = dashboardFocus(g);
  const cert = useCertificateDownload();
  const [allDone, setAllDone] = useState(false);
  const doneId = useId();
  const certificateButton = (c: CourseCard) =>
    c.mine.certificate && c.mine.certificate.status !== 'REVOKED' ? (
      <button
        type="button"
        onClick={() => void cert.download(c.mine.certificate!)}
        disabled={cert.busy === c.mine.certificate.id}
        aria-label={`Certificate (PDF): ${c.title}`}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-60 ${TOUCH_MIN}`}
      >
        <DownloadIcon />
        Certificate (PDF)
      </button>
    ) : null;
  return (
    <div className="flex flex-col gap-6">
      {focus ? (
        <LearningDashboard course={focus.course} allDone={focus.allDone} others={g.todo} onBrowse={onBrowse} />
      ) : (
        <div className="card card-pad flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 font-semibold text-ink">
            <span className="text-brand">
              <BookIcon size={20} />
            </span>
            Nothing to do right now
          </p>
          {onBrowse ? (
            <Button variant="secondary" className={TOUCH_MIN} onClick={onBrowse}>
              Browse all courses
            </Button>
          ) : null}
        </div>
      )}
      {g.done.length ? (
        <Group title="Done" count={g.done.length}>
          <CourseGrid id={doneId} courses={allDone ? g.done : g.done.slice(0, DONE_FOLD)} extra={certificateButton} />
          {g.done.length > DONE_FOLD ? (
            <button
              type="button"
              aria-expanded={allDone}
              aria-controls={doneId}
              onClick={() => setAllDone((v) => !v)}
              className={`self-start text-sm font-semibold text-brand underline-offset-2 hover:underline ${TOUCH_MIN}`}
            >
              {allDone ? 'Show fewer' : `Show all ${g.done.length}`}
            </button>
          ) : null}
        </Group>
      ) : null}
      {cert.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {cert.error}
        </p>
      ) : null}
      {g.olderCertificates.length ? <OlderCertificates certificates={g.olderCertificates} /> : null}
    </div>
  );
}

/**
 * The dashboard of one course. From 1024 px two columns — main (about 2/3): Up next, then the tiles; side (about 1/3):
 * progress, the certificate, other courses. On a phone one column in the order Up next, progress, tiles, certificate,
 * other courses (the columns' wrappers step aside — `contents` — and `order` places each card). The course is read
 * once with `useCourse` (the course page's own cached read); until it comes (or if it can't), Up next and the ring
 * work from the list's card.
 */
function LearningDashboard({ course: c, allDone, others, onBrowse }: { course: CourseCard; allDone: boolean; others: CourseCard[]; onBrowse?: () => void }) {
  const q = useCourse(c.id);
  const d = q.data ?? null;
  const next = d && !allDone ? upNextModule(d) : null;
  return (
    <div data-learning-dashboard={c.id} className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] lg:items-start lg:gap-5">
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
        <div className="order-1 min-w-0">{allDone ? <AllDoneCard course={c} onBrowse={onBrowse} /> : <UpNextCard course={c} detail={d} next={next} />}</div>
        {d ? (
          <div className="order-3 min-w-0 empty:hidden">
            <UnitGrid course={d} next={next} resumeLessonId={allDone ? null : (c.mine.next?.lessonId ?? d.resumeLessonId)} />
          </div>
        ) : q.isPending ? (
          <p role="status" className="order-3 text-sm text-ink-2">
            <span className="animate-pulse motion-reduce:animate-none">Loading the course…</span>
          </p>
        ) : null}
      </div>
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        <div className="order-2 min-w-0">
          <ProgressCard course={c} detail={d} finished={allDone} />
        </div>
        {d ? (
          <div className="order-4 min-w-0 empty:hidden">
            <CertificatePanel course={d} />
          </div>
        ) : null}
        {others.length ? (
          <div className="order-5 min-w-0">
            <OtherCourses courses={others} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** "Next: Work on a task · Step-by-step guide · 8 min" (the kind and minutes once the course is read). */
function NextLine({ course: c, detail: d }: { course: CourseCard; detail: CourseDetail | null }) {
  const m = c.mine;
  const lessonId = m.next?.lessonId ?? m.nextLessonId ?? d?.resumeLessonId ?? null;
  const lesson = d && lessonId ? (d.lessons.find((l) => l.id === lessonId) ?? null) : null;
  const title = m.next?.lessonTitle ?? lesson?.title;
  if (!title) return null;
  const more = lesson ? [LESSON_KIND_WORDS[lesson.kind], minutesText(lesson.minutes)].filter(Boolean) : [];
  return (
    <p className="break-words text-sm text-ink-2">
      Next: <bdi className="font-semibold text-ink">{title}</bdi>
      {more.length ? ` · ${more.join(' · ')}` : null}
    </p>
  );
}

/** A text link 44 px tall on a touch screen. */
const COARSE_LINK = '[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:items-center';
const TEXT_LINK = `rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40 ${COARSE_LINK}`;
const BIG_BUTTON = '!min-h-[44px] w-full justify-center sm:w-auto';

/**
 * The one course to do next: "UP NEXT · Module 2 of 8", the module's icon and name with the course it is in (a plain
 * course: its own title as the link), the next lesson, Mandatory and the due day (overdue in red), New for your role,
 * and one main button — Start, Continue or Review — opening where 1.23.32 resumes (`useCourseGo`).
 */
function UpNextCard({ course: c, detail: d, next }: { course: CourseCard; detail: CourseDetail | null; next: ReturnType<typeof upNextModule> }) {
  const side = useLearner();
  const go = useCourseGo(c);
  const id = useId();
  const m = c.mine;
  const moduleTitle = next?.module.title ?? m.next?.moduleTitle ?? null;
  const iconKey = next ? moduleKeyOf(next.module) : moduleTitle ? moduleKeyOf({ id: '', title: moduleTitle }) : courseIconKey(c);
  const words = MAIN_ACTION_WORDS[mainAction(m)];
  const open = m.status !== 'COMPLETED';
  const chips = (open && (m.mandatory || !!cardChip(m))) || m.newForRole > 0;
  return (
    <section aria-labelledby={id} data-up-next={c.id} className="card card-pad flex flex-col gap-3 border-s-4 border-brand">
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
        <h2 id={id}>Up next</h2>
        {next ? <span>{`· Module ${next.index + 1} of ${next.total}`}</span> : null}
      </div>
      <div className="flex min-w-0 items-start gap-3">
        <span data-up-next-icon aria-hidden="true" className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-brand/10 text-brand">
          <ModuleIcon moduleKey={iconKey} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          {moduleTitle ? (
            <>
              <h3 className="break-words font-display text-xl font-bold text-ink">
                <bdi>{moduleTitle}</bdi>
              </h3>
              <p className="break-words text-sm text-ink-2">
                <Link to={coursePath(side.base, c.id)} className={TEXT_LINK}>
                  <bdi>{c.title}</bdi>
                </Link>
              </p>
            </>
          ) : (
            <>
              <h3 className="break-words font-display text-xl font-bold text-ink">
                <Link to={coursePath(side.base, c.id)} className={TEXT_LINK}>
                  <bdi>{c.title}</bdi>
                </Link>
              </h3>
              {c.summary ? <p className="mt-1 text-sm text-ink-2">{c.summary}</p> : null}
            </>
          )}
        </div>
      </div>
      <NextLine course={c} detail={d} />
      {chips ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {open && m.mandatory ? <MandatoryChip /> : null}
          {open ? <CardChipView mine={m} /> : null}
          {m.newForRole > 0 ? <NewForRoleChip count={m.newForRole} /> : null}
        </div>
      ) : null}
      <div>
        {go.needsStart ? (
          <Button size="lg" className={BIG_BUTTON} loading={go.busy} onClick={() => void go.start()}>
            {words}
          </Button>
        ) : (
          <Link to={go.to} className={buttonClass('primary', 'lg', BIG_BUTTON)}>
            {words}
          </Link>
        )}
      </div>
      {go.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {go.error}
        </p>
      ) : null}
    </section>
  );
}

/** Everything done: "All done, well done", Review (opening where it resumes) and Browse all courses. */
function AllDoneCard({ course: c, onBrowse }: { course: CourseCard; onBrowse?: () => void }) {
  const go = useCourseGo(c);
  const id = useId();
  return (
    <section aria-labelledby={id} data-all-done={c.id} className={`card card-pad flex flex-col gap-3 border-s-4 ${STATUS_CLASS.DONE.edge}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className={`grid h-12 w-12 flex-none place-items-center rounded-2xl ${STATUS_CLASS.DONE.chip}`}>
          <TickIcon size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={id} className="font-display text-xl font-bold text-ink">
            All done, well done
          </h2>
          <p className="mt-1 break-words text-sm text-ink-2">
            You finished <bdi className="font-semibold text-ink">{c.title}</bdi>.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {go.needsStart ? null : (
          <Link to={go.to} className={buttonClass('primary', 'lg', BIG_BUTTON)}>
            {MAIN_ACTION_WORDS.review}
          </Link>
        )}
        {onBrowse ? (
          <Button variant="secondary" size="lg" className={BIG_BUTTON} onClick={onBrowse}>
            Browse all courses
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * How far along, beside Up next (from the same list card, so the two always agree): the ring ("1 / 8", "modules
 * done"; a plain course in lessons), about how long is left (the person's unfinished lessons, once the course is read)
 * and the due day (overdue in red). On a phone the ring sits
 * on the left of its words; in the side column above them.
 */
function ProgressCard({ course: c, detail: d, finished }: { course: CourseCard; detail: CourseDetail | null; finished: boolean }) {
  const id = useId();
  const m = c.mine;
  const byModule = !!m.modules;
  const done = m.modules ? m.modules.done : m.lessonsDone;
  const total = m.modules ? m.modules.total : c.lessonCount;
  const label = `${done} of ${byModule ? modulesText(total) : lessonsText(total)} done`;
  const under = `${byModule ? (total === 1 ? 'module' : 'modules') : total === 1 ? 'lesson' : 'lessons'} done`;
  const allFinished = finished || (m.status === 'COMPLETED' && m.newForRole === 0);
  const left = d && !allFinished ? minutesLeftText(lessonsLeft(d)) : null;
  const late = m.status !== 'COMPLETED' && m.overdue && !!m.dueDay;
  const due = m.status === 'COMPLETED' ? null : late ? (cardChip(m)?.text ?? null) : dueText(m);
  return (
    <section aria-labelledby={id} data-progress={c.id} className="card card-pad flex items-center gap-4 lg:flex-col lg:text-center">
      <h2 id={id} className="sr-only">
        Your progress
      </h2>
      <ProgressRing done={done} total={total} label={label} size={88} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-semibold text-ink">{under}</p>
        {left ? <p className="text-sm text-ink-2">{left}</p> : null}
        {due ? <p className={`text-sm ${late ? `font-semibold ${OVERDUE_CLASS.text}` : 'text-ink-2'}`}>{due}</p> : null}
      </div>
    </section>
  );
}

/**
 * Every module of the person's as a tile (4 a row from 1280 px, 3 from 1024, 2 from 768, a list on a phone), the current
 * one marked; a plain course's lessons the same way. A course with nothing to show: no grid (never an empty one).
 */
function UnitGrid({ course: d, next, resumeLessonId }: { course: CourseDetail; next: ReturnType<typeof upNextModule>; resumeLessonId: string | null }) {
  const side = useLearner();
  const id = useId();
  const byModule = d.modules.length > 0;
  if (!byModule && !d.lessons.length) return null;
  const current = resumeLessonId && !byModule ? (d.lessons.find((l) => l.id === resumeLessonId && !l.done)?.id ?? null) : null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-display text-base font-bold text-ink">
        {byModule ? 'Your modules' : 'Your lessons'}
      </h2>
      <ol className="grid gap-2 md:grid-cols-2 md:gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {byModule
          ? d.modules.map((m, i) => (
              <li key={m.id} className="min-w-0">
                <ModuleTile module={m} index={i} moduleKey={moduleKeyOf(m)} to={coursePath(side.base, d.id, null, m.id)} current={next?.module.id === m.id} />
              </li>
            ))
          : d.lessons.map((l, i) => (
              <li key={l.id} className="min-w-0">
                <LessonTile lesson={l} index={i} to={lessonPath(side.base, d.id, l.id)} current={l.id === current} />
              </li>
            ))}
      </ol>
    </section>
  );
}

/** The other open courses (an induction, a team course…) beside the dashboard: compact rows, each with its own button. */
function OtherCourses({ courses }: { courses: CourseCard[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="card card-pad flex flex-col gap-1">
      <h2 id={id} className="eyebrow">
        Other courses <span className="font-normal">({courses.length})</span>
      </h2>
      <ul className="flex flex-col divide-y divide-line">
        {courses.map((c) => (
          <OtherCourseRow key={c.id} course={c} />
        ))}
      </ul>
    </section>
  );
}

function OtherCourseRow({ course: c }: { course: CourseCard }) {
  const side = useLearner();
  const go = useCourseGo(c);
  const words = MAIN_ACTION_WORDS[mainAction(c.mine)];
  const name = `${words}: ${c.title}`;
  return (
    <li data-other-course={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <div className="min-w-0 flex-1 basis-40">
        <h3 className="break-words text-sm font-semibold text-ink">
          <Link to={coursePath(side.base, c.id)} className={TEXT_LINK}>
            <bdi>{c.title}</bdi>
          </Link>
        </h3>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2">
          <span>{progressWords(c)}</span>
          <CardChipView mine={c.mine} />
        </p>
      </div>
      {go.needsStart ? (
        <Button variant="secondary" size="sm" aria-label={name} className={`!rounded-lg ${TOUCH_MIN}`} loading={go.busy} onClick={() => void go.start()}>
          {words}
        </Button>
      ) : (
        <Link to={go.to} aria-label={name} className={buttonClass('secondary', 'sm', `!rounded-lg ${TOUCH_MIN}`)}>
          {words}
        </Link>
      )}
      {go.error ? (
        <p role="alert" className="basis-full rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {go.error}
        </p>
      ) : null}
    </li>
  );
}

/** R6: certificates without a Done card (expired, replaced, revoked, an archived course, one to retake), behind one link. */
function OlderCertificates({ certificates }: { certificates: CertificateRef[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`self-start text-sm font-semibold text-brand underline-offset-2 hover:underline ${TOUCH_MIN}`}
      >
        Older certificates
      </button>
      {open ? (
        <div id={id}>
          <CertificateList certificates={certificates} />
        </div>
      ) : null}
    </div>
  );
}

function CertificateList({ certificates }: { certificates: CertificateRef[] }) {
  const cert = useCertificateDownload();
  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-line">
        {certificates.map((c) => {
          const tone = c.status === 'VALID' ? 'bg-success-soft text-success' : c.status === 'EXPIRED' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger';
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand/10 text-brand">
                <AwardIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold text-ink">{c.courseTitle}</p>
                <p className="text-xs text-ink-2">
                  <span className="font-mono">{c.code}</span> · Issued {instantDay(c.issuedAt)}
                  {c.expiresAt ? ` · Expires ${instantDay(c.expiresAt)}` : ''}
                </p>
              </div>
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${tone}`}>{CERTIFICATE_WORDS[c.status]}</span>
              <button
                type="button"
                onClick={() => void cert.download(c)}
                disabled={cert.busy === c.id}
                aria-label={`Download the certificate for ${c.courseTitle} (PDF)`}
                className={`inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-60 ${TOUCH_MIN}`}
              >
                <DownloadIcon />
                PDF
              </button>
            </li>
          );
        })}
      </ul>
      {cert.error ? (
        <p role="alert" className="border-t border-line px-4 py-2 text-sm text-danger">
          {cert.error}
        </p>
      ) : null}
    </div>
  );
}

const FILTER_COLUMNS = ['', 'sm:grid-cols-[minmax(0,1fr)_12rem]', 'sm:grid-cols-[minmax(0,1fr)_12rem_12rem]'] as const;

/**
 * Search, and the Module and Difficulty filters only when they help (12 Nov §3: Module above 8 courses, Difficulty
 * when the courses differ). R7: a module set without its filter (a Learn link) shows as a chip that clears it.
 */
export function CatalogueFilterBar({
  value,
  onChange,
  modules,
  showModule = true,
  showDifficulty = true,
}: {
  value: Required<CatalogueFilters>;
  onChange: (v: Required<CatalogueFilters>) => void;
  modules: readonly TrainingModule[];
  showModule?: boolean;
  showDifficulty?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div role="search" aria-label="Find a course" className={`grid gap-2 ${FILTER_COLUMNS[Number(showModule) + Number(showDifficulty)]}`}>
        <label htmlFor={`${id}-q`} className="sr-only">
          Search courses
        </label>
        <input id={`${id}-q`} type="search" value={value.q} onChange={(e) => onChange({ ...value, q: e.target.value })} placeholder="Search courses" maxLength={100} className={fieldClass} />
        {showModule ? (
          <>
            <label htmlFor={`${id}-module`} className="sr-only">
              Module
            </label>
            <select id={`${id}-module`} value={value.module} onChange={(e) => onChange({ ...value, module: e.target.value as TrainingModule | '' })} className={fieldClass}>
              <option value="">All modules</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABELS[m]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {showDifficulty ? (
          <>
            <label htmlFor={`${id}-difficulty`} className="sr-only">
              Difficulty
            </label>
            <select id={`${id}-difficulty`} value={value.difficulty} onChange={(e) => onChange({ ...value, difficulty: e.target.value as Difficulty | '' })} className={fieldClass}>
              <option value="">Any difficulty</option>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_WORDS[d]}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      {!showModule && value.module ? (
        <div>
          <button
            type="button"
            onClick={() => onChange({ ...value, module: '' })}
            aria-label={`Show every module (now: ${MODULE_LABELS[value.module]})`}
            className={`inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/5 px-3 py-1 text-sm font-semibold text-brand transition-colors hover:bg-brand/10 ${TOUCH_MIN}`}
          >
            {MODULE_LABELS[value.module]}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** All courses filtered here in the page (the portal's: its courses come with its Learning Hub). */
export function filterCourses(courses: CourseCard[], f: Required<CatalogueFilters>): CourseCard[] {
  const q = f.q.trim().toLowerCase();
  return courses.filter(
    (c) => (!f.module || c.moduleKey === f.module) && (!f.difficulty || c.difficulty === f.difficulty) && (!q || c.title.toLowerCase().includes(q) || (c.summary ?? '').toLowerCase().includes(q)),
  );
}
