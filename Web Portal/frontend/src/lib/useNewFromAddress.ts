import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * `?new=1` on arrival opens the page's New form — e.g. the first steps' "Create a project"
 * (/projects?new=1) and "Add your team" (/admin/users?new=1) — and is then dropped from the address,
 * so going Back or reloading doesn't open the form again.
 */
export function useNewFromAddress(open: () => void): void {
  const [params, setParams] = useSearchParams();
  const asked = params.get('new') === '1';
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
