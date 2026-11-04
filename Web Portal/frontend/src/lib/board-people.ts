/**
 * Who can open a project's board (1.22): its owner, its named manager and its team — each with a
 * face, a name and a role. Someone who can no longer open it is left out: a team member in none of
 * the project's companies any more (multi-company "No access") and a deactivated person.
 * Administrators can open every board and aren't listed for it.
 */
import type { ApiMember } from '../api/members';
import type { DirectoryUser } from '../api/users';

export type BoardRole = 'OWNER' | 'MANAGER' | 'MEMBER';

export interface BoardPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: BoardRole;
}

export const BOARD_ROLE_LABEL: Record<BoardRole, string> = { OWNER: 'Owner', MANAGER: 'Manager', MEMBER: 'Member' };

const nameOf = (u: { firstName?: string | null; lastName?: string | null; username?: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '';
const RANK: Record<BoardRole, number> = { OWNER: 0, MANAGER: 1, MEMBER: 2 };

/** Owner first, then managers (the named one first), then the rest of the team, each group A–Z. */
export function boardPeople(project: { ownerId: string | null; managerId?: string | null }, members: ApiMember[], directory: DirectoryUser[]): BoardPerson[] {
  // Only well-formed rows (an id each): one odd answer must not take the board down with it.
  const known = new Map(directory.filter((u) => typeof u?.id === 'string').map((u) => [u.id, u]));
  const team = new Map(members.filter((m) => typeof m?.id === 'string').map((m) => [m.id, m]));
  const ids = [project.ownerId, project.managerId, ...team.keys()].filter((id): id is string => Boolean(id));
  const people: BoardPerson[] = [];
  for (const id of new Set(ids)) {
    const m = team.get(id);
    const u = known.get(id);
    if (m?.hasAccess === false || u?.active === false) continue;
    // Someone named on the project but known neither from its team nor from the people list: no face to show.
    if (!m && !u) continue;
    const name = (u && nameOf(u)) || (m && nameOf(m));
    if (!name) continue;
    const role: BoardRole = id === project.ownerId ? 'OWNER' : id === project.managerId || m?.role === 'MANAGER' ? 'MANAGER' : 'MEMBER';
    people.push({ id, name, avatarUrl: u?.avatarUrl ?? null, role });
  }
  const named = (p: BoardPerson) => (p.id === project.managerId ? 0 : 1);
  return people.sort((a, b) => RANK[a.role] - RANK[b.role] || named(a) - named(b) || a.name.localeCompare(b.name, 'en'));
}

/** The first `limit` faces, and how many more there are ("+N"). */
export function facesOf<T>(people: T[], limit: number): { shown: T[]; more: number } {
  return { shown: people.slice(0, limit), more: Math.max(0, people.length - limit) };
}
