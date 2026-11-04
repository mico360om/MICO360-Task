import { useEffect } from 'react';
import { useOpenTask } from '../lib/useOpenTask';
import { clearTaskNotice, useTaskNotice } from '../lib/task-notice';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';

/** How long the notice stays (it can be dismissed sooner). */
const SHOWN_MS = 8000;

/**
 * 1.22.3: "Task MICO-143 created · Open · ✕" at the foot of the window, after a task is made with the
 * form (or one made offline syncs). Open shows it in the task panel. It goes away on its own.
 */
export function TaskNoticeToast() {
  const notice = useTaskNotice((s) => s.notice);
  const openTask = useOpenTask();
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearTaskNotice, SHOWN_MS);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <p role="status" className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface py-2 pe-2 ps-4 text-sm font-medium text-ink shadow-lift">
        <span>{notice.text}</span>
        {notice.taskId ? (
          <button
            type="button"
            onClick={() => {
              openTask(notice.taskId!);
              clearTaskNotice();
            }}
            aria-label={notice.key ? `Open ${notice.key}` : 'Open'}
            className={`rounded-full px-2 font-semibold text-brand hover:underline ${TOUCH_TALL}`}
          >
            Open
          </button>
        ) : null}
        <button type="button" onClick={clearTaskNotice} aria-label="Dismiss" className={`text-ink-2 hover:text-ink ${TOUCH_SQUARE}`}>
          ✕
        </button>
      </p>
    </div>
  );
}
