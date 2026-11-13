import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * `?new=1` on arrival opens the page's New form — e.g. the first steps' "Create a project"
 * (/projects?new=1) and "Add your team" (/admin/users?new=1) — and is then dropped from the address,
 * so going Back or reloading doesn't open the form again.
 *
 * `value`: what `new` must say — '1' for a page's own New form; 'task' for the header's New Task (the
 * installed app's "New task" shortcut, /my-tasks?new=task), so the two never open together. `enabled`
 * false: this one doesn't look at all.
 */
export function useNewFromAddress(open: () => void, value = '1', enabled = true): void {
  const [params, setParams] = useSearchParams();
  const asked = enabled && params.get('new') === value;
  useEffect(() => {
    if (!asked) return;
    open();
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [asked]);
}
