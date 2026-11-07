import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useTaskSteps } from './task-steps';

/**
 * Opens a task in the app's one task panel (the app shell's) by putting ?task=<id> in the address,
 * as search, notifications and the Management page do: a reload keeps it open, Back closes it, and
 * the link can be shared. The page's other address settings are kept.
 *
 * `list` (1.22): the tasks it was opened among, in the order shown, so the panel's Previous / Next
 * step through them; without one the panel shows no steps. `at.item` (1.23.3): open it at one of its
 * checklist items.
 */
export function useOpenTask(): (taskId: string, list?: string[], at?: { item?: string }) => void {
  const [, setParams] = useSearchParams();
  const { pathname } = useLocation();
  return useCallback(
    (taskId: string, list?: string[], at?: { item?: string }) => {
      useTaskSteps.getState().open(list ?? null, pathname);
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('task', taskId);
        // 1.23.3: at one of its checklist items (the panel opens its parents and marks it).
        if (at?.item) next.set('item', at.item);
        else next.delete('item');
        return next;
      });
    },
    [setParams, pathname],
  );
}
