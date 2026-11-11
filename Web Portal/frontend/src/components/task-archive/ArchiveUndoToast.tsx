import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { tasksApi } from '../../api/tasks';
import { clearArchiveNotice, useArchiveNotice } from '../../lib/task-archive';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { showTaskNotice } from '../../lib/task-notice';
import { ApiError } from '../../lib/api-client';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';

/** How long Undo is offered (it can be dismissed sooner). */
export const ARCHIVE_UNDO_MS = 10_000;

/**
 * Task archive: "RIG-12 archived · Undo · ✕" at the foot of the window for a few seconds after an archive
 * (the task panel has closed by then: the task left every board and list). Undo unarchives it and says
 * so ("Task RIG-12 unarchived · Open"); an Undo the server refuses says why, and stays until dismissed.
 */
export function ArchiveUndoToast() {
  const notice = useArchiveNotice((s) => s.notice);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Pointed at or focused, it waits (a keyboard user can reach Undo); a failure stays until dismissed.
  const [held, setHeld] = useState(false);
  useEffect(() => setProblem(null), [notice]);
  useEffect(() => {
    if (!notice || problem || held || busy) return;
    const t = setTimeout(clearArchiveNotice, ARCHIVE_UNDO_MS);
    return () => clearTimeout(t);
  }, [notice, problem, held, busy]);
  if (!notice) return null;

  async function undo() {
    if (!notice || busy) return;
    setBusy(true);
    try {
      await tasksApi(apiClient).unarchive(notice.taskId);
      void invalidateTaskQueries(queryClient);
      clearArchiveNotice();
      showTaskNotice({ text: `Task ${notice.key} unarchived`, taskId: notice.taskId, key: notice.key });
    } catch (e) {
      setProblem(e instanceof ApiError && e.message ? e.message : 'Couldn’t unarchive it. Check your connection, then unarchive it from the project’s Archived tasks.');
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
          <button type="button" onClick={() => void undo()} disabled={busy} aria-label={`Undo: unarchive ${notice.key}`} className={`rounded-full px-2 font-semibold text-brand hover:underline disabled:opacity-60 ${TOUCH_TALL}`}>
            {busy ? 'Unarchiving…' : 'Undo'}
          </button>
        )}
        <button type="button" onClick={clearArchiveNotice} aria-label="Dismiss" className={`text-ink-2 hover:text-ink ${TOUCH_SQUARE}`}>
          ✕
        </button>
      </p>
    </div>
  );
}
