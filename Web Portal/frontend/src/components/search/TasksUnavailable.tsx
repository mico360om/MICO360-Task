/**
 * 1.23.1: the server couldn't search the tasks this time (a database error; it recorded it) and sent the
 * other results anyway (`tasksUnavailable`). One quiet line says why no tasks are listed, with "try again".
 * The button never takes the focus from the top-bar search box (its list stays open).
 */
export function TasksUnavailable({ onRetry, className = '' }: { onRetry: () => void; className?: string }) {
  return (
    <p role="status" data-tasks-unavailable className={`text-sm text-ink-2 ${className}`.trim()}>
      Tasks couldn’t be searched just now —{' '}
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onRetry} className="font-semibold text-ink underline [@media(pointer:coarse)]:!min-h-11">
        try again
      </button>
    </p>
  );
}
