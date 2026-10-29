import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Opens a task in the app's one task panel (the app shell's) by putting ?task=<id> in the address,
 * as search, notifications and the Management page do: a reload keeps it open, Back closes it, and
 * the link can be shared. The page's other address settings are kept.
 */
export function useOpenTask(): (taskId: string) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (taskId: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('task', taskId);
        return next;
      }),
    [setParams],
  );
}
