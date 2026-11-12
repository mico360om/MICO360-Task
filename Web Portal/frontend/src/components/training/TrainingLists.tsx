import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DIFFICULTIES, MODULE_LABELS, type CatalogueFilters, type CertificateRef, type CourseCard, type Difficulty, type MyTraining, type TrainingModule } from '../../api/training';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { Button, buttonClass } from '../ui/Button';
import { ProgressBar } from '../portal/portal-ui';
import { coursePath, lessonPath, useLearner } from './learner';
import { courseChanged } from './training-queries';
import { AwardIcon, BookIcon, CardChipView, CourseCardView, CourseLength, DownloadIcon, MandatoryChip, TOUCH_MIN, trainingProblem } from './training-ui';
import { ACTION_WORDS, CERTIFICATE_WORDS, DIFFICULTY_WORDS, courseAction, instantDay, learningGroups } from './training-words';

/**
 * My learning's pieces and All courses' cards and filters, shared by the staff page and the Client portal's Learning
 * Hub (12 Nov design §2, §3, §8): one "Up next" course, then "To do" and "Done" (each course once), older
 * certificates behind one link, and the slim course cards.
 */

const fieldClass = `h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 ${TOUCH_MIN}`;

/** A grid of slim course cards (each opening its page; `module` keeps All courses' filter for the way back). */
export function CourseGrid({ courses, module, showState = true, extra }: { courses: CourseCard[]; module?: string | null; showState?: boolean; extra?: (c: CourseCard) => ReactNode }) {
  const { base } = useLearner();
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {courses.map((c) => (
        <li key={c.id} className="min-w-0">
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

/**
 * My learning: "Up next" (the most urgent course, with Start / Continue), "To do" and "Done" (a Done card carries its
 * certificate), and "Older certificates" only when some certificate has no Done card (R6). Nothing to do: one line
 * and `onBrowse` ("Browse all courses").
 */
export function MyLearningSections({ data, onBrowse }: { data: Pick<MyTraining, 'assigned' | 'inProgress' | 'completed' | 'certificates'>; onBrowse?: () => void }) {
  const g = learningGroups(data);
  const cert = useCertificateDownload();
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
      {g.upNext ? (
        <UpNextCard course={g.upNext} />
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
      {g.todo.length ? (
        <Group title="To do" count={g.todo.length}>
          <CourseGrid courses={g.todo} />
        </Group>
      ) : null}
      {g.done.length ? (
        <Group title="Done" count={g.done.length}>
          <CourseGrid courses={g.done} extra={certificateButton} />
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

/** The one course to do next: its title, due day or how far along, and a big Start / Continue. */
function UpNextCard({ course: c }: { course: CourseCard }) {
  const side = useLearner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const m = c.mine;
  const action = courseAction(m);
  const started = m.status === 'IN_PROGRESS' || m.status === 'REVIEW' || m.status === 'RETAKE';
  const to = m.nextLessonId ? lessonPath(side.base, c.id, m.nextLessonId) : coursePath(side.base, c.id);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await side.api.start(c.id);
      courseChanged(qc, side, c.id, d);
      const first = d.resumeLessonId ?? d.lessons[0]?.id ?? null;
      navigate(first ? lessonPath(side.base, c.id, first) : coursePath(side.base, c.id));
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t start the course.'));
      setBusy(false);
    }
  };
  // Started without a due day: the bar says how far along; anything else (overdue, due, review, retake): its chip.
  const chip = m.overdue || m.dueDay || m.status === 'REVIEW' || m.status === 'RETAKE';
  return (
    <section aria-labelledby={id} data-up-next={c.id} className="card card-pad flex flex-col gap-3 border-s-4 border-brand">
      <h2 id={id} className="text-xs font-semibold uppercase tracking-wide text-brand">
        Up next
      </h2>
      <div className="min-w-0">
        <h3 className="break-words font-display text-xl font-bold text-ink">
          <Link to={coursePath(side.base, c.id)} className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40">
            {c.title}
          </Link>
        </h3>
        {c.summary ? <p className="mt-1 text-sm text-ink-2">{c.summary}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CourseLength course={c} />
        {m.mandatory ? <MandatoryChip /> : null}
        {chip ? <CardChipView mine={m} /> : null}
      </div>
      {started ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ProgressBar percent={m.progressPct} label={`${c.title}: ${m.progressPct}% done`} />
          </div>
          <span className="flex-none text-sm font-semibold text-ink">{`${m.progressPct}% done`}</span>
        </div>
      ) : null}
      <div>
        {m.enrolled ? (
          <Link to={to} className={buttonClass('primary', 'lg', '!min-h-[44px] w-full justify-center sm:w-auto')}>
            {ACTION_WORDS[action]}
          </Link>
        ) : (
          <Button size="lg" className="!min-h-[44px] w-full sm:w-auto" loading={busy} onClick={() => void start()}>
            {ACTION_WORDS.start}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
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
        aria-controls={id}
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
