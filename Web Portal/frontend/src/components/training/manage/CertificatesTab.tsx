import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITS, type ManageCertificateRow } from '../../../api/training';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { downloadBlob, fileNameOf } from '../../../lib/download';
import { useCompanyTimeZone } from '../../../lib/useCompanyTimeZone';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { LoadError } from '../../ui/LoadError';
import { fieldClass } from '../../ui/Field';
import { FormRow, ManageDialog } from './ManageDialog';
import { CertificateStatusChip, FilterField, Notice, instantWords, problemText } from './manage-ui';
import { MANAGE_KEY, manageKeys, tc, useManageCourses } from './manage-queries';

/**
 * Certificates: every certificate issued (a Training manager's: her companies' people), searched by learner,
 * code or course; its PDF; Revoke with a reason (the public check then says "Revoked").
 */
export function CertificatesTab() {
  const timeZone = useCompanyTimeZone();
  const ids = { search: useId(), course: useId() };
  const [courseId, setCourseId] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 250);
  const [revoking, setRevoking] = useState<ManageCertificateRow | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const coursesQ = useManageCourses();
  const filter = { courseId, q };
  const listQ = useQuery({ queryKey: manageKeys.certificates(filter), queryFn: () => tc().certificates(filter) });
  const rows = listQ.data?.certificates ?? [];

  async function pdf(c: ManageCertificateRow) {
    setDownloading(c.id);
    setProblem(null);
    try {
      const blob = await tc().certificatePdf(c.id);
      downloadBlob(fileNameOf(blob) ?? `certificate-${c.code}.pdf`, blob);
    } catch (err) {
      setProblem(`Couldn’t download the certificate. ${problemText(err)}`);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label="Search certificates" htmlFor={ids.search} className="min-w-[12rem] flex-[2_1_14rem]">
          <input id={ids.search} type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={LIMITS.search} placeholder="Name, code or course" className={fieldClass(false, 'w-full')} />
        </FilterField>
        <FilterField label="Course" htmlFor={ids.course} className="min-w-[12rem] flex-1">
          <select id={ids.course} value={courseId} onChange={(e) => setCourseId(e.target.value)} className={fieldClass(false, 'w-full')}>
            <option value="">All courses</option>
            {(coursesQ.data?.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </FilterField>
      </div>
      {problem ? <Notice>{problem}</Notice> : null}
      {listQ.isError ? (
        <LoadError what="the certificates" onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="skeleton h-48 rounded-2xl" role="status" aria-label="Loading certificates" />
      ) : rows.length === 0 ? (
        <EmptyState title={courseId || q ? 'No certificates match' : 'No certificates yet'} description="A certificate is issued when someone completes a course that gives one." />
      ) : (
        <ul aria-label="Certificates" className="card divide-y divide-line overflow-hidden">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
              <div className="min-w-0 flex-[1_1_18rem]">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="auto" className="font-semibold text-ink [overflow-wrap:anywhere]">{c.learnerName}</span>
                  <CertificateStatusChip status={c.status} />
                </div>
                <p dir="auto" className="mt-0.5 text-sm text-ink [overflow-wrap:anywhere]">{c.courseTitle}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-2">
                  <span className="font-mono">{c.code}</span>
                  <span>{`Completed ${instantWords(c.completedAt, timeZone)}`}</span>
                  <span>{`Issued ${instantWords(c.issuedAt, timeZone)}`}</span>
                  <span>{c.expiresAt ? `Expires ${instantWords(c.expiresAt, timeZone)}` : 'Never expires'}</span>
                </p>
              </div>
              <div className="flex flex-none items-center gap-2">
                <Button variant="secondary" size="sm" loading={downloading === c.id} onClick={() => void pdf(c)} className="[@media(pointer:coarse)]:!min-h-11">PDF</Button>
                {c.status !== 'REVOKED' ? (
                  <Button variant="ghost" size="sm" onClick={() => setRevoking(c)} className="[@media(pointer:coarse)]:!min-h-11">Revoke</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {revoking ? <RevokeDialog certificate={revoking} onClose={() => setRevoking(null)} /> : null}
    </div>
  );
}

function RevokeDialog({ certificate, onClose }: { certificate: ManageCertificateRow; onClose: () => void }) {
  const qc = useQueryClient();
  const ids = { reason: useId(), err: useId(), hint: useId() };
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function revoke() {
    const r = reason.trim();
    if (!r) return setFieldError('Say why it is revoked.');
    setBusy(true);
    setError(null);
    try {
      await tc().revoke(certificate.id, r);
      void qc.invalidateQueries({ queryKey: MANAGE_KEY });
      onClose();
    } catch (err) {
      setError(`Couldn’t revoke it. ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ManageDialog title="Revoke the certificate?" size="small" tone="danger" onClose={onClose} onSubmit={() => void revoke()} submitLabel="Revoke certificate" busy={busy}>
      {error ? <Notice>{error}</Notice> : null}
      <p className="text-sm text-ink-2">
        <bdi className="font-semibold text-ink">{certificate.learnerName}</bdi>’s certificate for <bdi className="font-semibold text-ink">{certificate.courseTitle}</bdi> (
        <span className="font-mono">{certificate.code}</span>) stops being valid: the public check says “Revoked”. This can’t be undone.
      </p>
      <FormRow label="Reason" htmlFor={ids.reason} error={fieldError} errorId={ids.err} hint={`${reason.length}/${LIMITS.revokeReason} — kept with the certificate.`} hintId={ids.hint}>
        <textarea
          id={ids.reason}
          rows={3}
          dir="auto"
          value={reason}
          maxLength={LIMITS.revokeReason}
          onChange={(e) => {
            setReason(e.target.value);
            setFieldError(null);
          }}
          aria-required="true"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? ids.err : ids.hint}
          className={fieldClass(!!fieldError, 'w-full resize-y')}
        />
      </FormRow>
    </ManageDialog>
  );
}
