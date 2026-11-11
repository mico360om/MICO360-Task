import { useId, useState, type ReactNode } from 'react';
import { DIFFICULTIES, MODULE_LABELS, type CatalogueFilters, type CertificateRef, type CourseCard, type Difficulty, type MyTraining, type TrainingModule } from '../../api/training';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { StatTile } from '../StatTile';
import { EmptyState } from '../ui/EmptyState';
import { coursePath, useLearner } from './learner';
import { AwardIcon, BookIcon, ClockIcon, CourseCardView, DownloadIcon, TOUCH_MIN, TickIcon, trainingProblem } from './training-ui';
import { CERTIFICATE_WORDS, DIFFICULTY_WORDS, instantDay } from './training-words';

/** My training's lists and the catalogue's cards and filters, shared by the staff page and the portal's Help & training. */

const fieldClass = `h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 ${TOUCH_MIN}`;

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5h.01" />
  </svg>
);

/** A grid of course cards (each opening its page; `module` keeps the catalogue's filter for the way back). */
export function CourseGrid({ courses, module, showState = true }: { courses: CourseCard[]; module?: string | null; showState?: boolean }) {
  const { base } = useLearner();
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {courses.map((c) => (
        <li key={c.id} className="min-w-0">
          <CourseCardView course={c} to={coursePath(base, c.id, module)} showState={showState} />
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

/**
 * My training: the counts, then assigned (mandatory first, due days, red Overdue), in progress (with %), completed,
 * and certificates (PDF). `onCatalogue`: the empty state's way to the catalogue.
 */
export function MyTrainingSections({ data, onCatalogue }: { data: MyTraining; onCatalogue?: () => void }) {
  const c = data.counts;
  const nothing = !data.assigned.length && !data.inProgress.length && !data.completed.length && !data.certificates.length;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Assigned" value={c.assigned} tone="brand" icon={<BookIcon size={18} />} />
        <StatTile label="In progress" value={c.inProgress} tone="info" icon={<ClockIcon />} />
        <StatTile label="Completed" value={c.completed} tone="done" icon={<TickIcon size={18} />} />
        <StatTile label="Overdue" value={c.overdue} tone={c.overdue ? 'overdue' : 'done'} icon={<AlertIcon />} />
      </div>
      {nothing ? (
        <EmptyState
          titleAs="h2"
          icon={<BookIcon size={24} />}
          title="Nothing assigned to you yet."
          description="When a course is assigned to you it appears here. You can start any course from the catalogue."
          action={
            onCatalogue ? (
              <button type="button" onClick={onCatalogue} className={`text-sm font-semibold text-brand underline-offset-2 hover:underline ${TOUCH_MIN}`}>
                Browse the catalogue
              </button>
            ) : undefined
          }
        />
      ) : null}
      {data.assigned.length ? (
        <Group title="Assigned to you" count={data.assigned.length}>
          <CourseGrid courses={data.assigned} />
        </Group>
      ) : null}
      {data.inProgress.length ? (
        <Group title="In progress" count={data.inProgress.length}>
          <CourseGrid courses={data.inProgress} />
        </Group>
      ) : null}
      {data.completed.length ? (
        <Group title="Completed" count={data.completed.length}>
          <CourseGrid courses={data.completed} />
        </Group>
      ) : null}
      {data.certificates.length ? (
        <Group title="Certificates" count={data.certificates.length}>
          <CertificateList certificates={data.certificates} />
        </Group>
      ) : null}
    </div>
  );
}

function CertificateList({ certificates }: { certificates: CertificateRef[] }) {
  const { api } = useLearner();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = async (cert: CertificateRef) => {
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
  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-line">
        {certificates.map((cert) => {
          const tone = cert.status === 'VALID' ? 'bg-success-soft text-success' : cert.status === 'EXPIRED' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger';
          return (
            <li key={cert.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand/10 text-brand">
                <AwardIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold text-ink">{cert.courseTitle}</p>
                <p className="text-xs text-ink-2">
                  <span className="font-mono">{cert.code}</span> · Issued {instantDay(cert.issuedAt)}
                  {cert.expiresAt ? ` · Expires ${instantDay(cert.expiresAt)}` : ''}
                </p>
              </div>
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${tone}`}>{CERTIFICATE_WORDS[cert.status]}</span>
              <button
                type="button"
                onClick={() => void download(cert)}
                disabled={busy === cert.id}
                aria-label={`Download the certificate for ${cert.courseTitle} (PDF)`}
                className={`inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-60 ${TOUCH_MIN}`}
              >
                <DownloadIcon />
                PDF
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="border-t border-line px-4 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Search, module and difficulty (the catalogue's filters; a cleared box is ''). */
export function CatalogueFilterBar({ value, onChange, modules }: { value: Required<CatalogueFilters>; onChange: (v: Required<CatalogueFilters>) => void; modules: readonly TrainingModule[] }) {
  const id = useId();
  return (
    <div role="search" aria-label="Find a course" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_12rem]">
      <label htmlFor={`${id}-q`} className="sr-only">
        Search courses
      </label>
      <input id={`${id}-q`} type="search" value={value.q} onChange={(e) => onChange({ ...value, q: e.target.value })} placeholder="Search courses" maxLength={100} className={fieldClass} />
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
    </div>
  );
}

/** The catalogue filtered here in the page (the portal's: its courses come with Help & training). */
export function filterCourses(courses: CourseCard[], f: Required<CatalogueFilters>): CourseCard[] {
  const q = f.q.trim().toLowerCase();
  return courses.filter(
    (c) => (!f.module || c.moduleKey === f.module) && (!f.difficulty || c.difficulty === f.difficulty) && (!q || c.title.toLowerCase().includes(q) || (c.summary ?? '').toLowerCase().includes(q)),
  );
}
