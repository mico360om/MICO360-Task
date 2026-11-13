import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CertificateRef } from '../../api/training';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { BrandLogo } from '../ui/BrandLogo';
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

/** One fact under the certificate's rule: its words, then its value ("Issued 5 Nov 2026"). */
function Fact({ term, children, mono = false }: { term: string; children: string; mono?: boolean }) {
  return (
    <p>
      <span className="text-ink-2">{term}</span> <span className={`font-semibold text-ink ${mono ? 'break-all font-mono' : ''}`}>{children}</span>
    </p>
  );
}

/**
 * A certificate on its course's page (1.23.30, staff and the Client portal), framed like the PDF (13 Nov new look; the
 * PDF itself is unchanged): a brand border (plain once expired or revoked), the logo, "Certificate of completion", "This
 * certifies that" the learner (large) "has completed" the course "on" the day they finished it; under a rule its facts —
 * "Completed 3 Nov 2026", Issued (only when it differs from the day finished: a certificate issued at the change), "Valid
 * until …" / "Expired on …" / "Never expires", the code — and a QR code of its public check (`verifyUrl`, the link the
 * PDF prints). Above the frame Valid / Expired / Revoked; below it Download certificate (PDF), and for staff "Check it
 * online" (/verify/<code>); the portal has no link out.
 */
export function CertificateView({ certificate: cert }: { certificate: CertificateRef }) {
  const side = useLearner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  // An older server's answer without the day finished: the day it was issued (the certificate's date line then).
  const completedAt = cert.completedAt || cert.issuedAt;
  const valid = cert.status === 'VALID';
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
      <div data-certificate-frame className={`rounded-2xl border-2 bg-surface p-1.5 ${valid ? 'border-brand' : 'border-line'}`}>
        <div className={`flex min-w-0 flex-col items-center rounded-xl border px-4 py-6 text-center sm:px-8 ${valid ? 'border-brand/30' : 'border-line'}`}>
          <BrandLogo className="h-8" alt="MICO360 Tasks" />
          <p data-certificate-line className="eyebrow mt-4">
            Certificate of completion
          </p>
          <p data-certificate-line className="mt-4 text-sm text-ink-2">
            This certifies that
          </p>
          <p data-certificate-line className="mt-1 max-w-full break-words font-display text-2xl font-bold text-ink sm:text-3xl">
            <bdi>{cert.learnerName}</bdi>
          </p>
          <p data-certificate-line className="mt-2 text-sm text-ink-2">
            has completed
          </p>
          <p data-certificate-line className="mt-1 max-w-full break-words font-display text-lg font-bold text-ink">
            <bdi>{cert.courseTitle}</bdi>
          </p>
          <p data-certificate-line className="mt-1 text-sm text-ink">{`on ${instantDay(completedAt)}`}</p>
          <div className="mt-5 flex w-full flex-col items-center gap-4 border-t border-line pt-4 sm:flex-row sm:justify-between">
            <div data-certificate-facts className="flex min-w-0 flex-col gap-1 text-sm sm:text-start">
              <p className="font-semibold text-ink">{`Completed ${instantDay(completedAt)}`}</p>
              {sameDay(cert.issuedAt, completedAt) ? null : <Fact term="Issued">{instantDay(cert.issuedAt)}</Fact>}
              {/* When it stops being valid, in the PDF's words. */}
              {cert.expiresAt ? <Fact term={cert.status === 'EXPIRED' ? 'Expired on' : 'Valid until'}>{instantDay(cert.expiresAt)}</Fact> : <p className="text-ink-2">Never expires</p>}
              <Fact term="Code" mono>
                {cert.code}
              </Fact>
            </div>
            {/* White in both themes: a QR code on a dark page doesn't scan. */}
            <div className="flex-none rounded-lg bg-white p-1.5 text-black ring-1 ring-line">
              <QrCode value={cert.verifyUrl} size={116} label={`QR code: check certificate ${cert.code} online`} />
            </div>
          </div>
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
