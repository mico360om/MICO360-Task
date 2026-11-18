import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { trainingApi, type CertificateStatus } from '../../api/training';
import { ApiError } from '../../lib/api-client';
import { BrandLogo } from '../../components/ui/BrandLogo';
import { Button } from '../../components/ui/Button';
import { PageTitle } from '../../components/ui/PageHeader';
import { AwardIcon } from '../../components/training/training-ui';
import { CERTIFICATE_WORDS, instantDay } from '../../components/training/training-words';
import { useAuthStore } from '../../stores/auth-store';

const api = trainingApi(apiClient);

/** A code as printed (TC-XXXX-XXXX-XXXX), tidied for the address: capitals, no spaces. */
export const tidyCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');

const TONE: Record<CertificateStatus, string> = {
  VALID: 'bg-success-soft text-success',
  EXPIRED: 'bg-warning-soft text-warning',
  REVOKED: 'bg-danger-soft text-danger',
};

/**
 * Check a certificate (public: anyone with its code — the PDF's link and its QR code open /verify/<code>). Outside
 * the site's sign-in and shell: only the course, the name, the dates (the day the course was finished first, 1.23.30)
 * and Valid / Expired / Revoked are shown (design call 5).
 */
export function VerifyPage() {
  const { code: raw = '' } = useParams();
  // Review M12: the router has decoded the address already (decoding again broke on /verify/%25).
  const code = tidyCode(raw);
  const navigate = useNavigate();
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const [typed, setTyped] = useState(code);
  const id = useId();
  useEffect(() => setTyped(code), [code]);

  const q = useQuery({ queryKey: ['verify', code], queryFn: () => api.verify(code), enabled: Boolean(code), retry: false, staleTime: 60_000 });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = tidyCode(typed);
    if (next) navigate(`/verify/${encodeURIComponent(next)}`);
  };

  const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
  const tooMany = q.error instanceof ApiError && q.error.status === 429;

  return (
    <main className="min-h-screen bg-ground px-3 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex">
            <BrandLogo className="h-10" />
          </span>
          <Link to={signedIn ? '/training' : '/login'} className="tap inline-flex items-center text-sm font-semibold text-brand hover:underline [@media(pointer:coarse)]:!min-h-11">
            {signedIn ? 'Learning Hub' : 'Sign in'}
          </Link>
        </div>
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-8">
          <PageTitle title="Check a certificate" />
          <p className="mt-1 text-sm text-ink-2">Enter the code printed on a MICO360 Tasks training certificate to see whether it is valid.</p>
          {/* A column on a phone (the box keeps its 44 px: flex-1 there squeezed it to the 32 px touch floor), a row from sm. */}
          <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor={`${id}-code`} className="sr-only">
              Certificate code
            </label>
            <input
              id={`${id}-code`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="TC-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              className="h-11 w-full min-w-0 rounded-xl border sm:w-auto sm:flex-1 border-line bg-surface px-3 font-mono text-sm uppercase text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <Button type="submit" className="!min-h-11">
              Check
            </Button>
          </form>
        </section>

        {code ? (
          <section aria-live="polite" aria-label="Result" className="rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-8">
            {q.isPending ? (
              <p role="status" className="text-sm text-ink-2">
                Checking {code}…
              </p>
            ) : q.isError ? (
              <div role="alert">
                <p className="font-semibold text-ink">{notFound ? 'No certificate has this code.' : tooMany ? 'Too many checks from here just now.' : 'Couldn’t check this code.'}</p>
                <p className="mt-1 text-sm text-ink-2">
                  {notFound ? 'Check the code on the certificate and try again.' : tooMany ? 'Wait a minute and try again.' : 'Check your connection and try again.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 font-mono text-sm font-semibold text-ink-2">
                    <AwardIcon />
                    {code}
                  </span>
                  <span data-verify-status={q.data.status} className={`rounded-lg px-3 py-1 text-sm font-bold ${TONE[q.data.status]}`}>
                    {CERTIFICATE_WORDS[q.data.status]}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-ink-2">Course</dt>
                  <dd className="break-words font-semibold text-ink">{q.data.courseTitle}</dd>
                  <dt className="text-ink-2">Name</dt>
                  <dd className="break-words font-semibold text-ink">{q.data.learnerName}</dd>
                  <dt className="text-ink-2">Completed</dt>
                  <dd className="text-ink">{instantDay(q.data.completedAt || q.data.issuedAt)}</dd>
                  <dt className="text-ink-2">Issued</dt>
                  <dd className="text-ink">{instantDay(q.data.issuedAt)}</dd>
                  <dt className="text-ink-2">Expires</dt>
                  <dd className="text-ink">{q.data.expiresAt ? instantDay(q.data.expiresAt) : 'Never'}</dd>
                </dl>
                {q.data.status === 'REVOKED' ? <p className="text-sm text-ink-2">This certificate was withdrawn and no longer counts.</p> : null}
                {q.data.status === 'EXPIRED' ? <p className="text-sm text-ink-2">This certificate has passed its expiry date.</p> : null}
              </div>
            )}
          </section>
        ) : null}
        <p className="text-center text-xs text-ink-3">Issued through MICO360 Tasks · Learning Hub</p>
      </div>
    </main>
  );
}
