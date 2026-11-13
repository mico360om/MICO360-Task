import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CourseDetail } from '../../api/training';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { buttonClass } from '../ui/Button';
import { coursePath, useLearner } from './learner';
import { certificateState, certificateWords } from './dashboard-rules';
import { AwardIcon, DownloadIcon, TOUCH_MIN, trainingProblem } from './training-ui';

/**
 * The certificate card (13 Nov new look: My learning's side, the course page's panel). Before finishing: "Finish 7 more
 * modules to get it" over a faint certificate outline. Finished: "Certificate ready", its code, View (the course page,
 * where the certificate is shown) and Download PDF. Modules new for the person's role:
 * "Finish the new modules for an updated certificate" (the current one still there). Nothing for a course without a
 * certificate. No "Check it online" here: the certificate itself has it (staff only).
 */
export function CertificatePanel({ course }: { course: CourseDetail }) {
  const side = useLearner();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = certificateState(course);
  if (s.kind === 'none') return null;
  const cert = s.kind === 'ready' || s.kind === 'updated' ? s.certificate : null;
  const download = async () => {
    if (!cert) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await side.api.certificatePdf(cert.id);
      downloadBlob(fileNameOf(blob) ?? `certificate-${cert.code}.pdf`, blob);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t download the certificate.'));
    } finally {
      setBusy(false);
    }
  };
  const small = `!rounded-lg ${TOUCH_MIN}`;
  return (
    <section aria-labelledby={id} data-certificate-panel={s.kind} className="card card-pad relative flex min-h-[6.5rem] flex-col gap-3 overflow-hidden">
      <h2 id={id} className="eyebrow inline-flex items-center gap-1.5">
        <AwardIcon size={14} />
        Certificate
      </h2>
      {s.kind === 'before' ? (
        <>
          {/* A faint certificate: a framed sheet with a seal (decorative). */}
          <svg data-certificate-outline aria-hidden="true" focusable="false" viewBox="0 0 120 80" className="pointer-events-none absolute bottom-3 end-3 h-14 w-20 text-ink-3 opacity-30 rtl:-scale-x-100">
            <rect x="4" y="4" width="112" height="72" rx="6" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <rect x="12" y="12" width="96" height="56" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 3" />
            <path d="M28 30h46M28 40h34M28 50h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="90" cy="48" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
          </svg>
          <p className="relative pe-20 font-semibold text-ink">{certificateWords(s)}</p>
        </>
      ) : (
        <>
          <p className={`font-display font-bold text-ink ${s.kind === 'ready' ? 'text-lg' : 'text-base'}`}>{certificateWords(s)}</p>
          {cert ? (
            <>
              <p className="text-xs text-ink-2">
                Code <span className="break-all font-mono font-semibold text-ink">{cert.code}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Link to={coursePath(side.base, course.id)} aria-label="View the certificate" className={buttonClass('secondary', 'sm', small)}>
                  View
                </Link>
                <button type="button" onClick={() => void download()} disabled={busy} aria-label="Download PDF of the certificate" className={buttonClass('secondary', 'sm', `${small} gap-1.5`)}>
                  <DownloadIcon />
                  Download PDF
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
