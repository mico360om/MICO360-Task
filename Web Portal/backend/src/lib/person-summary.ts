/**
 * A person as the website's faces show them: their id, display name and profile photo (avatar hotfix,
 * owner 10 Nov — cards showed only initials). One select shape for every staff payload that draws a
 * face, nested in the query the payload already makes, so the photo never costs a query of its own.
 *
 * Not for the Client portal or the public client page: clients are never sent the team's photos.
 */
export const PERSON_SUMMARY_SELECT = { id: true, username: true, firstName: true, lastName: true, avatarUrl: true } as const;

export interface PersonSummary {
  id: string;
  name: string;
  /** Their profile photo (a server path like /uploads/…), or null: the face shows their initials. */
  avatarUrl: string | null;
}

interface NameParts {
  username: string;
  firstName: string | null;
  lastName: string | null;
}

/** First and last name, else the username. */
export const personName = (u: NameParts): string => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;

/** A photo path, or null for none (blank counts as none). */
export const photoOf = (avatarUrl: string | null | undefined): string | null => (avatarUrl && avatarUrl.trim() ? avatarUrl : null);

export function personSummary(u: NameParts & { id: string; avatarUrl?: string | null }): PersonSummary {
  return { id: u.id, name: personName(u), avatarUrl: photoOf(u.avatarUrl) };
}
