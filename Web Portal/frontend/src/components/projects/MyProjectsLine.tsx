import { Link } from 'react-router-dom';

/**
 * "Showing only your projects · Change": said where an administrator's "Show my projects only"
 * (Settings) narrows a list, so a missing project is never a mystery. Change opens Settings.
 */
export function MyProjectsLine({ className = '' }: { className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 text-sm text-ink-2 ${className}`}>
      <span>Showing only your projects</span>
      <span aria-hidden="true">·</span>
      <Link to="/settings" aria-label="Change “Show my projects only” in Settings" className="inline-flex items-center font-semibold text-brand hover:underline [@media(pointer:coarse)]:min-h-11">
        Change
      </Link>
    </p>
  );
}
