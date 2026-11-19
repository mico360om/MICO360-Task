import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { downloadBlob, fileNameOf } from '../../lib/download';

/** Why a PDF couldn't be made, in plain words. */
function reasonOf(err: unknown): string {
  if (err instanceof ApiError && err.message && !/^Request failed/.test(err.message)) return err.message.replace(/\.$/, '') + '.';
  if (err instanceof TypeError) return 'the server couldn’t be reached. Please try again.';
  return 'please try again.';
}

/**
 * 1.24.3 "Download PDF" on a Workspace page (My performance, Workload, Timeline, Calendar, Projects,
 * Kanban Board, My Tasks): asks the server for a PDF of what the page shows (`make` sends the page's
 * current filters) and saves it under the name the server gives it. "Preparing…" while it is made; a
 * failure is a toast at the foot of the window. On a phone it is an icon button, 44 px, with its label
 * for screen readers.
 */
export function DownloadPdfButton({ make, fallbackName, disabled = false }: { make: () => Promise<Blob>; fallbackName: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!problem) return;
    const t = setTimeout(() => setProblem(null), 9000);
    return () => clearTimeout(t);
  }, [problem]);

  async function download() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const blob = await make();
      downloadBlob(fileNameOf(blob) ?? fallbackName, blob);
    } catch (err) {
      setProblem(`Couldn’t make the PDF: ${reasonOf(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const label = busy ? 'Preparing…' : 'Download PDF';
  return (
    <>
      <button
        type="button"
        onClick={() => void download()}
        // Busy: aria-disabled, not disabled, so keyboard focus stays on the button.
        disabled={disabled}
        aria-disabled={busy || undefined}
        aria-busy={busy}
        aria-label={busy ? undefined : 'Download PDF'}
        title="Download PDF"
        data-download-pdf
        className="inline-flex h-10 flex-none items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-ground disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-wait max-sm:h-11 max-sm:w-11 max-sm:px-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
      >
        {busy ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="animate-spin">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
        )}
        <span className="max-sm:sr-only">{label}</span>
      </button>
      {problem ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <p role="alert" className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-2xl border border-danger/30 bg-danger-soft py-2 pe-2 ps-4 text-sm font-medium text-danger shadow-lift">
            <span>{problem}</span>
            <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss" className="grid h-8 w-8 flex-none place-items-center rounded-full text-danger hover:bg-danger/10 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              ✕
            </button>
          </p>
        </div>
      ) : null}
    </>
  );
}
