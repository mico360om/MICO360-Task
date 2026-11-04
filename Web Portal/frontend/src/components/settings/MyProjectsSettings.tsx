import { useMyProjectsOnly, useSetMyProjectsOnly } from '../../lib/useMyProjectsOnly';
import { useAuthStore } from '../../stores/auth-store';
import { Toggle } from '../ui/Toggle';

/** The switch's words (the Projects page and the board say "Showing only your projects"). */
export const MY_PROJECTS_WORDS = {
  heading: 'Projects',
  label: 'Show my projects only',
  hint: 'Lists everywhere show only the projects you own, manage or are on the team of. You can still open any project by its link.',
  /** The same, about another administrator (User Management → Manage account, 1.22.3). */
  hintTheirs: 'Lists everywhere show only the projects they own, manage or are on the team of. They can still open any project by its link.',
  failed: 'Couldn’t save that change. Please try again.',
} as const;

/**
 * Settings → Projects (administrators only): "Show my projects only". Saved on the server for every
 * device and session; changing it reads every list again.
 */
export function MyProjectsSettings() {
  const admin = useAuthStore((s) => s.isAdmin());
  const on = useMyProjectsOnly();
  const save = useSetMyProjectsOnly();
  if (!admin) return null;
  return (
    <section className="card p-5 lg:col-span-2" aria-labelledby="my-projects-heading">
      <h2 id="my-projects-heading" className="eyebrow mb-4">{MY_PROJECTS_WORDS.heading}</h2>
      {save.isError ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{MY_PROJECTS_WORDS.failed}</p> : null}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{MY_PROJECTS_WORDS.label}</div>
          <div id="my-projects-hint" className="text-xs text-ink-2">{MY_PROJECTS_WORDS.hint}</div>
        </div>
        <Toggle on={save.isPending ? save.variables === true : on} onChange={() => save.mutate(!on)} label={MY_PROJECTS_WORDS.label} describedBy="my-projects-hint" disabled={save.isPending} />
      </div>
    </section>
  );
}
