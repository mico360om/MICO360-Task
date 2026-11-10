import type { MouseEvent, ReactNode } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { useOpenTask } from '../../lib/useOpenTask';
import { COPIES_SHOWN } from '../../lib/task-duplicate';
import { TOUCH_TALL } from '../../lib/touch';

/**
 * Duplicate Task in the task panel: "Duplicated from MSSP-34" on a copy and "Copies: MSSP-40, MSSP-41" on
 * an original. Each number is a link that opens that task in the panel (?task=…, as search and notices
 * do). The server names only tasks the reader may open, so a hidden one never shows here.
 */

const CHIP = 'inline-block max-w-full rounded-2xl bg-ground px-2 py-0.5 text-xs font-medium leading-6 text-ink-2 [@media(pointer:coarse)]:py-0';
const LINK = `inline-flex min-h-6 items-center rounded px-0.5 align-middle font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${TOUCH_TALL}`;

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="me-1 inline-block align-[-2px]">
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M4 16V5a1 1 0 0 1 1-1h11" />
  </svg>
);

/** A link opening a task in the app's task panel; outside the app's pages, a plain address. */
function TaskLink({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return useInRouterContext() ? (
    <RoutedTaskLink id={id} label={label}>
      {children}
    </RoutedTaskLink>
  ) : (
    <a href={`?task=${encodeURIComponent(id)}`} aria-label={label} className={LINK}>
      {children}
    </a>
  );
}

function RoutedTaskLink({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const openTask = useOpenTask();
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('task', id);
  params.delete('item');
  const open = (e: MouseEvent) => {
    // A new tab or window (Ctrl/⌘-click, middle click) gets the address; a plain click opens it here.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openTask(id);
  };
  return (
    <a href={`${pathname}?${params.toString()}`} onClick={open} aria-label={label} className={LINK}>
      {children}
    </a>
  );
}

/** The chips under a task's title: where it was copied from, and its copies (each only when there is one). */
export function DuplicateLinks({ from, copies }: { from?: { id: string; key: string } | null; copies?: { id: string; key: string }[] }) {
  const list = copies ?? [];
  if (!from && list.length === 0) return null;
  const shown = list.slice(0, COPIES_SHOWN);
  const more = list.length - shown.length;
  return (
    <>
      {from ? (
        <span className={CHIP}>
          <CopyIcon />
          Duplicated from{' '}
          <TaskLink id={from.id} label={`Open ${from.key}, the task this was duplicated from`}>
            {from.key}
          </TaskLink>
        </span>
      ) : null}
      {shown.length ? (
        <span role="group" aria-label="Copies" className={CHIP}>
          <CopyIcon />
          Copies:{' '}
          {shown.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? ', ' : null}
              <TaskLink id={c.id} label={`Open ${c.key}, a copy of this task`}>
                {c.key}
              </TaskLink>
            </span>
          ))}
          {more > 0 ? ` and ${more} more` : null}
        </span>
      ) : null}
    </>
  );
}
