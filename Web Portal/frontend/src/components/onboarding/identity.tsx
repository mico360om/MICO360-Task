import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { usersApi, type IdentityAnswer, type IdentityMatch, type IdentityQuery } from '../../api/users';
import { emailProblem, usernameProblem } from '../../lib/account-rules';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

/**
 * Onboarding: the New and Manage account forms ask, while the administrator types (after a pause),
 * whether the email, username or name already belongs to someone — the server still refuses a real
 * duplicate on save. Only well-formed values are asked about; nothing is asked when the form is empty.
 */
export function useIdentityCheck(q: IdentityQuery, enabled = true): IdentityAnswer | null {
  const email = q.email?.trim() ?? '';
  const username = q.username?.trim() ?? '';
  const query: IdentityQuery = {
    ...(email && !emailProblem(email) ? { email } : {}),
    ...(username && !usernameProblem(username) ? { username } : {}),
    ...(q.firstName?.trim() && q.lastName?.trim() ? { firstName: q.firstName.trim(), lastName: q.lastName.trim() } : {}),
    ...(q.client ? { client: true, organisation: q.organisation?.trim() || null } : {}),
    ...(q.excludeId ? { excludeId: q.excludeId } : {}),
  };
  const key = useDebouncedValue(JSON.stringify(query), 400);
  const asked = JSON.parse(key) as IdentityQuery;
  const any = !!(asked.email || asked.username || asked.firstName);
  const res = useQuery({
    queryKey: ['identity-check', key],
    queryFn: () => usersApi(apiClient).identityCheck(asked),
    enabled: enabled && any,
    staleTime: 10_000,
    retry: false,
  });
  if (!enabled || !any || !res.data) return null;
  // An answer for what is no longer typed says nothing.
  return {
    email: res.data.email && asked.email?.toLowerCase() === email.toLowerCase() ? res.data.email : null,
    username: res.data.username && asked.username?.toLowerCase() === username.toLowerCase() ? res.data.username : null,
    sameName: res.data.sameName ?? [],
  };
}

const whoText = (m: IdentityMatch) => (m.kind === 'client' ? `${m.name} (client)` : m.name);

function OpenButton({ match, onOpen }: { match: IdentityMatch; onOpen?: (id: string) => void }) {
  if (!onOpen) return null;
  return (
    <>
      {' — '}
      <button type="button" onClick={() => onOpen(match.id)} className="tap font-semibold underline hover:no-underline">
        Open account
      </button>
    </>
  );
}

/** "This email is already used by Ahmed Al Harthy (client) — Open account" (it would be refused on save). */
export function EmailTaken({ id, match, onOpen }: { id: string; match: IdentityMatch | null; onOpen?: (id: string) => void }) {
  if (!match) return null;
  return (
    <p id={id} role="status" className="text-xs text-danger">
      This email is already used by <bdi>{whoText(match)}</bdi>
      <OpenButton match={match} onOpen={onOpen} />
    </p>
  );
}

/** "Username taken" (by whom), refused on save. */
export function UsernameTaken({ id, match, onOpen }: { id: string; match: IdentityMatch | null; onOpen?: (id: string) => void }) {
  if (!match) return null;
  return (
    <p id={id} role="status" className="text-xs text-danger">
      Username taken by <bdi>{whoText(match)}</bdi>
      <OpenButton match={match} onOpen={onOpen} />
    </p>
  );
}

/** A gentle warning, never a refusal: "A client named Saif Al Said at Acme already exists". */
export function SameNameWarning({ matches, onOpen }: { matches: IdentityMatch[]; onOpen?: (id: string) => void }) {
  const m = matches[0];
  if (!m) return null;
  return (
    <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
      {m.kind === 'client' ? (
        <>
          A client named <bdi>{m.name}</bdi>
          {m.organisation ? (
            <>
              {' '}at <bdi>{m.organisation}</bdi>
            </>
          ) : null}{' '}
          already exists
        </>
      ) : (
        <>
          A user named <bdi>{m.name}</bdi> already exists
        </>
      )}
      {matches.length > 1 ? ` (and ${matches.length - 1} more)` : ''}. You can still save if this is someone else.
      <OpenButton match={m} onOpen={onOpen} />
    </p>
  );
}
