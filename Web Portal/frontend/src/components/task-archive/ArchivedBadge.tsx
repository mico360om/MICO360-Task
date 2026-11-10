/** An archive box: the lid and the box with its slot. */
export const ArchiveIcon = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
  </svg>
);

/**
 * Task archive: "Archived" beside a task that is archived (search results, the task panel's header) — it
 * is out of every board and list, read-only until unarchived. `title` says when and by whom, if known.
 */
export function ArchivedBadge({ title, className = '' }: { title?: string; className?: string }) {
  return (
    <span
      data-archived-badge
      title={title ?? 'Archived: out of boards and lists, read-only until unarchived'}
      className={`inline-flex flex-none items-center gap-1 rounded-md bg-ground px-1.5 py-0.5 text-[11px] font-semibold text-ink-2 ring-1 ring-inset ring-line ${className}`}
    >
      <ArchiveIcon size={11} />
      Archived
    </span>
  );
}
