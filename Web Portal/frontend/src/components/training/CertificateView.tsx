import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CertificateRef } from '../../api/training';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { Button } from '../ui/Button';
import { CertificatePaper } from './CertificatePaper';
import { useLearner } from './learner';
import { AwardIcon, DownloadIcon, TOUCH_MIN, trainingProblem } from './training-ui';
import { CERTIFICATE_WORDS } from './training-words';

const TONE: Record<CertificateRef['status'], string> = {
  VALID: 'bg-success-soft text-success',
  EXPIRED: 'bg-warning-soft text-warning',
  REVOKED: 'bg-danger-soft text-danger',
};

/**
 * A certificate on its course's page (1.23.30, staff and the Client portal). 1.23.35: the certificate itself is the PDF's
 * new design on screen (CertificatePaper: landscape, the name in script, the QR code in a laurel wreath), scaled to the
 * width. Above it Valid / Expired / Revoked; below it Download certificate (PDF), and for staff "Check it online"
 * (/verify/<code>); the portal has no link out.
 */
export function CertificateView({ certificate: cert }: { certificate: CertificateRef }) {
  const side = useLearner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
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
      <CertificatePaper certificate={cert} />
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
