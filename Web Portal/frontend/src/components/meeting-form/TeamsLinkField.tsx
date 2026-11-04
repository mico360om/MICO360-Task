import { Link } from 'react-router-dom';
import { MICROSOFT_TEAMS_ANCHOR, useMicrosoftTeams } from '../../lib/useMicrosoftTeams';

export interface TeamsLinkFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The meeting's organizer is the person filling in the form (a new meeting: always). */
  organizerIsMe: boolean;
  /** The meeting already has (or waits for) a Teams link. */
  hadTeams: boolean;
  /** It is waiting for its link (Microsoft couldn't be reached when it was saved). */
  pending?: boolean;
  /** A repeating meeting: one Teams link for all its meetings. */
  repeating?: boolean;
}

/**
 * 1.23: "Create a Teams link" under the meeting's Online link — the organizer's own Microsoft account
 * makes it when the meeting is saved. Not connected: a link to Settings. Hidden on a site without
 * Teams links. A meeting that has one can always take it away (any editor).
 */
export function TeamsLinkField({ checked, onChange, organizerIsMe, hadTeams, pending = false, repeating = false }: TeamsLinkFieldProps) {
  const { available, status, loading } = useMicrosoftTeams();
  if (!available || (loading && !hadTeams)) return null;
  const canMake = organizerIsMe && Boolean(status?.connected);
  if (!canMake && !hadTeams) {
    return (
      <p className="text-xs text-ink-2 sm:col-span-2">
        {organizerIsMe ? (
          <Link to={`/settings#${MICROSOFT_TEAMS_ANCHOR}`} className="tap font-semibold text-brand hover:underline">
            Connect Microsoft Teams in Settings
          </Link>
        ) : (
          'Only the organizer can make a Teams link, with their own Microsoft account.'
        )}
        {organizerIsMe ? ' to get a Teams link made for your meetings.' : null}
      </p>
    );
  }
  const hint = checked
    ? hadTeams && !pending
      ? 'Made by Microsoft Teams. Untick it to take the Teams link away.'
      : !organizerIsMe
        ? 'Waiting for the organizer to make the Teams link with their Microsoft account. Untick it to paste a link instead.'
        : `Made with your Microsoft account when you save${repeating ? ' — one link for all its meetings' : ''}.`
    : 'Or paste a link in Online link.';
  return (
    <div className="sm:col-span-2">
      <label className="inline-flex min-h-[2.25rem] cursor-pointer items-center gap-2 rounded-lg text-sm font-medium text-ink [@media(pointer:coarse)]:min-h-11">
        <input
          type="checkbox"
          checked={checked}
          disabled={!checked && !canMake}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby="mf-teams-hint"
          className="h-4 w-4 accent-[rgb(var(--c-brand))]"
        />
        Create a Teams link
      </label>
      <p id="mf-teams-hint" className="text-xs text-ink-2">{hint}</p>
    </div>
  );
}
