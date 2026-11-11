import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { BIN_KEY, binApi } from '../../api/recycle-bin';
import { clearBinNotice, useBinNotice } from '../../lib/bin-notice';
import { restoreText } from '../../lib/recycle-bin';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { showTaskNotice } from '../../lib/task-notice';
import { ApiError } from '../../lib/api-client';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';

/** How long Undo is offered (it can be dismissed sooner). */
export const UNDO_MS = 10_000;

/**
 * Recycle Bin: "RIG-12 moved to the Recycle Bin · Undo · ✕" for a few seconds after a delete. Undo
 * restores what that delete took (a whole series when it went as one) and says so ("Task RIG-12
 * restored · Open"); a restore that fails says why, and stays until dismissed.
 */
export function BinUndoToast() {
  const notice = useBinNotice((s) => s.notice);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Pointed at or focused, it waits (a keyboard user can reach Undo); a failure stays until dismissed.
  const [held, setHeld] = useState(false);
  useEffect(() => setProblem(null), [notice]);
  useEffect(() => {
    if (!notice || problem || held || busy) return;
    const t = setTimeout(clearBinNotice, UNDO_MS);
    return () => clearTimeout(t);
  }, [notice, problem, held, busy]);
  if (!notice) return null;

  async function undo() {
    if (!notice || busy) return;
    setBusy(true);
    try {
      const result = await binApi(apiClient).restore([notice.taskId], notice.wholeBatch);
      void invalidateTaskQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: BIN_KEY });
      if (result.restored.length) {
        clearBinNotice();
        const what = result.restored.length > 1 ? `Task ${notice.key} and its series (${result.restored.length} tasks)` : `Task ${notice.key}`;
        showTaskNotice({ text: `${what} restored`, taskId: notice.taskId, key: notice.key });
      } else {
        setProblem(restoreText(result));
      }
    } catch (e) {
      setProblem(e instanceof ApiError && e.message ? e.message : 'Couldn’t restore it. Check your connection, then restore it from the Recycle Bin.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <p
        role="status"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface py-2 pe-2 ps-4 text-sm font-medium text-ink shadow-lift"
      >
        <span>{problem ?? notice.text}</span>
        {problem ? null : (
          <button type="button" onClick={() => void undo()} disabled={busy} aria-label={`Undo: restore ${notice.key}`} className={`rounded-full px-2 font-semibold text-brand hover:underline disabled:opacity-60 ${TOUCH_TALL}`}>
            {busy ? 'Restoring…' : 'Undo'}
          </button>
        )}
        <button type="button" onClick={clearBinNotice} aria-label="Dismiss" className={`text-ink-2 hover:text-ink ${TOUCH_SQUARE}`}>
          ✕
        </button>
      </p>
    </div>
  );
}
