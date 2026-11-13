import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CertificateRef } from '../../api/training';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { Button } from '../ui/Button';
import { QrCode } from './QrCode';
import { useLearner } from './learner';
import { AwardIcon, DownloadIcon, TOUCH_MIN, trainingProblem } from './training-ui';
import { CERTIFICATE_WORDS, instantDay } from './training-words';

const TONE: Record<CertificateRef['status'], string> = {
  VALID: 'bg-success-soft text-success',
  EXPIRED: 'bg-warning-soft text-warning',
  REVOKED: 'bg-danger-soft text-danger',
};

/** The same day where the person is (the device's zone). */
const sameDay = (a: string, b: string) => instantDay(a) === instantDay(b);

/**
 * A certificate on its course's page (1.23.30, staff and the Client portal): who earned it, the course, the day they
 * finished it, its code, Valid / Expired / Revoked, and a QR code of its public check (`verifyUrl`, the link the PDF
 * prints), with Download certificate (PDF). Staff also get "Check it online" (/verify/<code>); the portal has no
 * link out of it. "Issued" is said only when it differs from the day finished (a certificate issued at the change).
 */
export function CertificateView({ certificate: cert }: { certificate: CertificateRef }) {
  const side = useLearner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  // An older server's answer without the day finished: the day it was issued (the certificate's date line then).
  const completedAt = cert.completedAt || cert.issuedAt;
  const download = async () => {
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
  return (
    <section aria-labelledby={`${id}-title`} data-certificate={cert.code} className="card card-pad flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="inline-flex items-center gap-2 font-display text-base font-bold text-ink">
          <AwardIcon />
          Certificate
        </h2>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${TONE[cert.status]}`}>{CERTIFICATE_WORDS[cert.status]}</span>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="break-words font-display text-xl font-bold text-ink">
              <bdi>{cert.learnerName}</bdi>
            </p>
            <p className="break-words text-sm font-semibold text-ink">
              <bdi>{cert.courseTitle}</bdi>
            </p>
            <p className="text-sm text-ink-2">{`Completed ${instantDay(completedAt)}`}</p>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-2">Code</dt>
            <dd className="break-all font-mono font-semibold text-ink">{cert.code}</dd>
            {sameDay(cert.issuedAt, completedAt) ? null : (
              <>
                <dt className="text-ink-2">Issued</dt>
                <dd className="text-ink">{instantDay(cert.issuedAt)}</dd>
              </>
            )}
            <dt className="text-ink-2">Expires</dt>
            <dd className="text-ink">{cert.expiresAt ? instantDay(cert.expiresAt) : 'Never'}</dd>
          </dl>
        </div>
        {/* White in both themes: a QR code on a dark page doesn't scan. */}
        <div className="flex-none self-center rounded-lg bg-white p-1.5 text-black ring-1 ring-line sm:self-start">
          <QrCode value={cert.verifyUrl} size={116} label={`QR code: check certificate ${cert.code} online`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="secondary" className={TOUCH_MIN} loading={busy} onClick={() => void download()}>
          <DownloadIcon />
          Download certificate (PDF)
        </Button>
        {side.portal ? null : (
          <Link to={`/verify/${encodeURIComponent(cert.code)}`} className={`inline-flex items-center text-sm font-semibold text-brand underline-offset-2 hover:underline ${TOUCH_MIN}`}>
            Check it online
          </Link>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
