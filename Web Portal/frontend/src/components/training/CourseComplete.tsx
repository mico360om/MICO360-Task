import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CourseCard, CourseDetail } from '../../api/training';
import { instantDayText } from '../../lib/day-words';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { STATUS_CLASS } from '../../lib/colour-classes';
import { Button, buttonClass } from '../ui/Button';
import { CertificateFullSize } from './CertificateFullSize';
import { CertificatePaper } from './CertificatePaper';
import { MAIN_ACTION_WORDS } from './dashboard-rules';
import { coursePath, lessonPath, useLearner } from './learner';
import { DownloadIcon, TickIcon, TOUCH_MIN, trainingProblem, useCourseGo } from './training-ui';
import { instantDay, lessonsText, modulesText } from './training-words';

/** "14 November 2026" (the person's own day). */
const longDay = (at: string) => instantDayText(at, undefined, { month: 'long' });
const ACTION = `${TOUCH_MIN} !min-h-[44px]`;

/**
 * s137 (1.23.37): My learning when the person has finished their course — a wide "Course complete" banner: the course,
 * the day they finished and the quiz score, the certificate's code, the certificate itself small (it opens full size),
 * View certificate, Download PDF and (staff) Copy check link. Without a certificate: Review. Expired: says so and keeps
 * the certificate (View, Download, the link that shows it expired). Revoked: says so and offers Review only. On a phone
 * the certificate goes under the words.
 */
export function CourseCompleteBanner({ course: c }: { course: CourseCard }) {
  const side = useLearner();
  const go = useCourseGo(c);
  const id = useId();
  const m = c.mine;
  const cert = m.certificate;
  const showCert = cert && cert.status !== 'REVOKED' ? cert : null;
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const thumb = useRef<HTMLButtonElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const finishedAt = m.completedAt ?? cert?.completedAt ?? null;
  const score = cert?.scorePct ?? null;
  const line = [finishedAt ? `Finished ${longDay(finishedAt)}` : null, score !== null ? `Score ${score}%` : null].filter(Boolean).join(' · ');

  const download = async () => {
    if (!showCert) return;
    setBusy(true);
    setProblem(null);
    try {
      const blob = await side.api.certificatePdf(showCert.id);
      downloadBlob(fileNameOf(blob) ?? `certificate-${showCert.code}.pdf`, blob);
    } catch (err) {
      setProblem(trainingProblem(err, 'Couldn’t download the certificate.'));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!showCert) return;
    setProblem(null);
    try {
      await navigator.clipboard.writeText(showCert.verifyUrl);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setProblem(`Couldn’t copy the link. It is ${showCert.verifyUrl}`);
    }
  };
  const closeFull = () => {
    setFull(false);
    requestAnimationFrame(() => thumb.current?.focus());
  };
  const review = go.needsStart ? null : (
    <Link to={go.to} className={buttonClass(showCert ? 'secondary' : 'primary', 'md', ACTION)}>
      {MAIN_ACTION_WORDS.review}
    </Link>
  );

  return (
    <section aria-labelledby={id} data-course-complete={c.id} className={`card card-pad flex flex-col gap-5 border-s-4 ${STATUS_CLASS.DONE.edge} sm:flex-row sm:items-center`}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 id={id} className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${STATUS_CLASS.DONE.text}`}>
          <TickIcon size={14} />
          Course complete
        </h2>
        <h3 className="break-words font-display text-2xl font-bold text-ink">
          <bdi>{c.title}</bdi>
        </h3>
        {line ? <p className="text-sm text-ink-2">{line}</p> : null}
        {cert ? (
          <p className="text-xs text-ink-2">
            Code <span className="break-all font-mono font-semibold text-ink">{cert.code}</span>
          </p>
        ) : null}
        {cert?.status === 'EXPIRED' ? (
          <p className="text-sm font-semibold text-warning">{cert.expiresAt ? `This certificate expired on ${longDay(cert.expiresAt)}.` : 'This certificate has expired.'}</p>
        ) : null}
        {cert?.status === 'REVOKED' ? <p className="text-sm font-semibold text-danger">This certificate was revoked.</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {showCert ? (
            <>
              <Button className={ACTION} aria-haspopup="dialog" onClick={() => setFull(true)}>
                View certificate
              </Button>
              <Button variant="secondary" className={`${ACTION} gap-1.5`} loading={busy} onClick={() => void download()}>
                <DownloadIcon />
                Download PDF
              </Button>
              {side.portal ? null : (
                <Button variant="secondary" className={ACTION} onClick={() => void copy()}>
                  Copy check link
                </Button>
              )}
            </>
          ) : (
            review
          )}
          <span role="status" className="text-sm font-semibold text-success">
            {copied ? 'Copied' : ''}
          </span>
        </div>
        {problem ? (
          <p role="alert" className="break-words rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {problem}
          </p>
        ) : null}
      </div>
      {showCert ? (
        <div data-certificate-thumb className="relative w-full max-w-[18rem] flex-none self-center sm:w-64">
          {/* The small certificate repeats the words above: the button below names it. */}
          <div aria-hidden="true">
            <CertificatePaper certificate={showCert} />
          </div>
          <button
            ref={thumb}
            type="button"
            aria-label="View the certificate full size"
            aria-haspopup="dialog"
            onClick={() => setFull(true)}
            className="absolute inset-0 cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          />
        </div>
      ) : null}
      {full && showCert ? <CertificateFullSize certificate={showCert} onClose={closeFull} /> : null}
    </section>
  );
}

/**
 * s137: the finished course's modules (a plain course: its lessons) as ONE folded line — "10 of 10 modules done · Review
 * any" — that opens to small rows: a tick, the name (a link to it) and the day it was done.
 */
export function FinishedUnits({ course: d }: { course: CourseDetail }) {
  const side = useLearner();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const byModule = d.modules.length > 0;
  if (!byModule && !d.lessons.length) return null;
  const total = byModule ? d.modules.length : d.lessons.length;
  const done = byModule ? d.modules.filter((m) => m.status === 'DONE').length : d.lessons.filter((l) => l.done).length;
  const label = `${done} of ${byModule ? modulesText(total) : lessonsText(total)} done · Review any`;
  const rows = byModule
    ? d.modules.map((m) => ({ id: m.id, title: m.title, done: m.status === 'DONE', at: m.doneAt, to: coursePath(side.base, d.id, null, m.id) }))
    : d.lessons.map((l) => ({ id: l.id, title: l.title, done: l.done, at: null as string | null, to: lessonPath(side.base, d.id, l.id) }));
  return (
    <section data-finished-units className="card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-start text-sm font-semibold text-ink transition-colors hover:bg-ground ${TOUCH_MIN}`}
      >
        <span>{label}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`flex-none text-ink-2 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <ul id={listId} hidden={!open} className="divide-y divide-line border-t border-line">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-1.5">
            <span aria-hidden="true" className={`grid h-6 w-6 flex-none place-items-center rounded-full ${r.done ? STATUS_CLASS.DONE.chip : 'bg-ground text-ink-3'}`}>
              {r.done ? <TickIcon size={13} /> : null}
            </span>
            <Link to={r.to} className={`min-w-0 flex-1 break-words rounded text-sm font-medium text-ink outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand/40 inline-flex min-h-8 items-center max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11`}>
              <bdi>{r.title}</bdi>
            </Link>
            {r.done && r.at ? <span className="flex-none text-xs text-ink-2">Done {instantDay(r.at)}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
