import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { inspectionsApi, type ClientInspection } from '../../api/inspections';
import { highlightNames } from '../../lib/name-highlight';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import { ClientEyeIcon } from '../TaskCard';
import { calendarDayText, problemText } from './inspection-ui';

function Marked({ text, names }: { text: string; names: string[] }) {
  return (
    <>
      {highlightNames(text, names).map((p, i) =>
        p.name ? (
          <mark key={i} className="rounded bg-warning-soft px-0.5 font-semibold text-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** The client's copy as their page shows it (the preview here, and the client page itself). */
export function ClientInspectionBody({ inspection: x, names = [] }: { inspection: ClientInspection; names?: string[] }) {
  const failed = x.sections.flatMap((s) => s.items.filter((i) => i.result === 'Fail').map((i) => ({ ...i, section: s.title })));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink">
        <span className={`font-semibold ${x.counts.failed ? 'text-danger' : 'text-success'}`}>{x.result}</span>
        <span className="text-ink-2"> · {x.counts.passed} passed · {x.counts.failed} failed · {x.counts.na} N/A</span>
      </p>
      {failed.length ? (
        <div>
          <h4 className="text-sm font-semibold text-ink">Failed items</h4>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink">
            {failed.map((i, k) => (
              <li key={k} dir="auto">
                {i.label}
                {i.reading ? ` — ${i.reading}${i.limits ? ` (allowed ${i.limits})` : ''}` : ''}
                {i.note ? (
                  <>
                    {' — '}
                    <Marked text={i.note} names={names} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {x.sections.map((s, si) => (
        <div key={si}>
          <h4 dir="auto" className="text-sm font-semibold text-ink">{s.title}</h4>
          <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
            {s.items.map((i, ii) => (
              <li key={ii} className="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
                <span className="min-w-0">
                  <span dir="auto" className="block break-words text-ink">{i.label}</span>
                  {i.reading || i.limits ? <span className="block text-xs text-ink-2">{[i.reading, i.limits ? `allowed ${i.limits}` : null].filter(Boolean).join(' · ')}</span> : null}
                  {i.note ? (
                    <span dir="auto" className="block whitespace-pre-line text-xs text-ink-2">
                      <Marked text={i.note} names={names} />
                    </span>
                  ) : null}
                </span>
                <span className={`flex-none text-xs font-bold uppercase ${i.result === 'Fail' ? 'text-danger' : i.result === 'Pass' ? 'text-success' : 'text-ink-2'}`}>
                  {i.result === 'Fail' ? '✕ Fail' : i.result === 'Pass' ? '✓ Pass' : i.result ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <h4 className="text-sm font-semibold text-ink">Signatures</h4>
        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
          {x.signatures.map((s, k) => (
            <li key={k} className="rounded-lg border border-line p-2">
              <div className="grid h-16 place-items-center rounded-md bg-white">
                {s.image ? <img src={s.image} alt={`${s.role} signature of ${s.name}`} className="max-h-14 max-w-full object-contain" /> : <span className="font-serif text-lg italic text-[#1C1A17]" dir="auto">{s.name}</span>}
              </div>
              <p className="mt-1 text-xs text-ink">
                <span className="font-semibold">{s.role}:</span> <span dir="auto">{s.name}</span>
              </p>
              <p className="text-xs text-ink-2">Signed {when(s.signedAt)}{s.typed ? ' · typed name' : ''}</p>
            </li>
          ))}
          {x.unsigned.map((role) => (
            <li key={role} className="rounded-lg border border-dashed border-line p-2 text-xs text-ink-2">
              <span className="font-semibold">{role}:</span> Not signed
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Before a finished report goes on the client page: exactly what the client will see (and its PDF). */
function PreviewDialog({ inspectionId, busy, error, onConfirm, onClose }: { inspectionId: string; busy: boolean; error: string | null; onConfirm: () => void; onClose: () => void }) {
  const ids = { title: useId(), intro: useId() };
  const dialogRef = useDialog(busy ? () => {} : onClose);
  const q = useQuery({ queryKey: ['inspection', inspectionId, 'client-preview'], queryFn: () => inspectionsApi(apiClient).clientPreview(inspectionId), staleTime: 0 });
  const p = q.data;
  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ids.title}
          aria-describedby={ids.intro}
          className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height,100vh)-2rem)] w-full max-w-xl animate-scale-in flex-col overflow-hidden"
        >
          <div className="border-b border-line px-5 pb-3 pt-4">
            <h2 id={ids.title} className="font-display text-lg font-semibold text-ink">
              Show this report to the client?
            </h2>
            <p id={ids.intro} className="mt-1 text-sm leading-relaxed text-ink-2">
              This is exactly what the client will see on their page, and in the PDF they can download: the results, the notes and the signatures with the signers’ names. No other staff names, tasks or internal notes.
            </p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            {q.isLoading ? <p className="text-sm text-ink-2">Loading…</p> : null}
            {q.isError ? <p role="alert" className="text-sm text-danger">{problemText(q.error, 'Couldn’t load the report. Close this and try again.')}</p> : null}
            {p ? (
              <>
                {p.names.length ? (
                  <p className="rounded-lg bg-ground px-3 py-2 text-xs leading-relaxed text-ink-2">
                    <span className="rounded bg-warning-soft px-0.5 font-semibold text-ink">Highlighted</span>: names of people on the project, in the notes. If the client shouldn’t see them, cancel, reopen the inspection and change the notes.
                  </p>
                ) : null}
                <div className="rounded-xl border border-line p-4">
                  <p dir="auto" className="font-display text-base font-semibold text-ink">{p.inspection.title}</p>
                  <p className="mb-3 text-xs text-ink-2">
                    {calendarDayText(p.inspection.date)}
                    {p.inspection.place ? <> · <span dir="auto">{p.inspection.place}</span></> : null}
                  </p>
                  <ClientInspectionBody inspection={p.inspection} names={p.names} />
                </div>
              </>
            ) : null}
            {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onConfirm} loading={busy} disabled={!p}>
              Show to client
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * "Show to client" on a finished inspection: whoever runs the project may put its report on the
 * project's client page (with a PDF), after a preview of exactly what the client will see. Others
 * see only that it is visible. Reopening it takes it off (the server clears it).
 */
export function InspectionClientSwitch({ inspectionId, clientVisible, canChange, onChanged }: { inspectionId: string; clientVisible: boolean; canChange: boolean; onChanged: () => void }) {
  const hint = useId();
  const [previewing, setPreviewing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const setM = useMutation({
    mutationFn: (visible: boolean) => inspectionsApi(apiClient).setClientVisible(inspectionId, visible),
    onMutate: () => setProblem(null),
    onSuccess: () => {
      setPreviewing(false);
      onChanged();
    },
    onError: (e) => setProblem(problemText(e, 'Couldn’t change it. Please try again.')),
  });
  if (!canChange) {
    return clientVisible ? (
      <p className="inline-flex items-center gap-1.5 self-start rounded-md bg-info-soft px-2 py-0.5 text-xs font-semibold text-info">
        <ClientEyeIcon size={12} />
        Visible to client
      </p>
    ) : null;
  }
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">Show to client</p>
        <Toggle on={clientVisible} onChange={() => (clientVisible ? setM.mutate(false) : setPreviewing(true))} label="Show to client" describedBy={hint} disabled={setM.isPending} />
      </div>
      <p id={hint} className="mt-1 text-xs leading-relaxed text-ink-2">
        {clientVisible
          ? 'Shown on the project’s client page, with its PDF. Reopening the inspection takes it off.'
          : 'Puts this report on the project’s client page, with a PDF of it. You see exactly what the client will see first.'}
      </p>
      {problem && !previewing ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{problem}</p> : null}
      {previewing ? <PreviewDialog inspectionId={inspectionId} busy={setM.isPending} error={problem} onConfirm={() => setM.mutate(true)} onClose={() => setPreviewing(false)} /> : null}
    </div>
  );
}
