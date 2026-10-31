/**
 * A project's team on the phone (5b), with the server's rules: who may run the project — change it,
 * its status, owner, team and columns, and delete its tasks (its owner, its named managers and
 * MANAGER members, and administrators: the server's canManage, backend modules/projects/
 * project-authz.ts) — who may create one (anyone signed in, since 1.15), and what adding, removing
 * and changing a role say. Pure TypeScript.
 */
import { ApiError, isNetworkError } from './api-client';
import { displayName, type ApiMember } from './types';

type User = { id: string; roles: string[] } | null | undefined;

/** The server's words when someone else tries to change a project (project-routes CHANGE_REFUSED). */
export const PROJECT_CHANGE_REFUSED = 'Only this project’s owner, its managers or an administrator can change it.';

/**
 * May this person run the project — change it, its status, owner, team and columns, delete its
 * tasks? An administrator always; else the server's `canManage` on the project (its owner, named
 * managers and MANAGER members); an older server that doesn't send it: a MANAGER member of `members`.
 */
export function canManageProject(user: User, project: { canManage?: boolean } | null | undefined, members: readonly Pick<ApiMember, 'id' | 'role'>[] = []): boolean {
  if (!user) return false;
  if (user.roles.includes('ADMIN')) return true;
  if (typeof project?.canManage === 'boolean') return project.canManage;
  return members.some((m) => m.id === user.id && m.role === 'MANAGER');
}

/** May this person create a project? Anyone signed in (the website since 1.15; the server allows it). */
export function canCreateProject(user: User): boolean {
  return !!user;
}

/** Managers first, then everyone by name. */
export function membersInOrder(members: ApiMember[]): ApiMember[] {
  return [...members].sort((a, b) => (a.role === b.role ? displayName(a).localeCompare(displayName(b), 'en') : a.role === 'MANAGER' ? -1 : 1));
}

/** The Overview's "Project manager": its managers' names, or the owner when none is named. */
export function teamManagers(members: ApiMember[], ownerName: string): { names: string[]; text: string } {
  const names = membersInOrder(members)
    .filter((m) => m.role === 'MANAGER')
    .map((m) => displayName(m));
  return { names, text: names.length ? names.join(', ') : `No manager named — owner · ${ownerName}` };
}

/** What TalkBack says for a person on the team. */
export function memberLabel(m: ApiMember, myId: string | null | undefined): string {
  return [displayName(m), `@${m.username}`, m.role === 'MANAGER' ? 'project manager' : 'member', m.id === myId ? 'you' : null].filter(Boolean).join(', ');
}

/** The people who can be added: active, not on the team yet, by name. */
export function addableUsers(
  people: { id: string; username: string; firstName?: string | null; lastName?: string | null; active?: boolean }[],
  members: Pick<ApiMember, 'id'>[],
): { value: string; label: string; hint: string }[] {
  const on = new Set(members.map((m) => m.id));
  return people
    .filter((p) => !on.has(p.id) && p.active !== false)
    .map((p) => ({ value: p.id, label: displayName({ firstName: p.firstName ?? '', lastName: p.lastName ?? '', username: p.username }), hint: `@${p.username}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/** The other role for a member, as the website offers it. */
export function roleAction(m: ApiMember): { role: 'MEMBER' | 'MANAGER'; label: string; a11y: string } {
  const name = displayName(m);
  return m.role === 'MANAGER'
    ? { role: 'MEMBER', label: 'Make member', a11y: `Make ${name} a member` }
    : { role: 'MANAGER', label: 'Make manager', a11y: `Make ${name} a manager` };
}

/** Removing takes the person off at once, so it asks first. */
export function removeQuestion(m: ApiMember, myId: string | null | undefined): { title: string; message: string } {
  if (m.id === myId) return { title: 'Remove yourself?', message: 'You are taken off this project and its tasks at once, and may no longer see it.' };
  const name = displayName(m);
  return { title: `Remove ${name}?`, message: `${name} is taken off this project and its tasks at once.` };
}

const FALLBACK = { add: 'Couldn’t add the member. Please try again.', remove: 'Couldn’t remove the member. Please try again.', role: 'Couldn’t change the role. Please try again.' };

/** Why a team change didn't happen: offline, no answer in time, the server's own reason, or a plain fallback. */
export function memberProblem(error: unknown, action: 'add' | 'remove' | 'role'): string {
  if (isNetworkError(error)) {
    return (error as { timedOut?: unknown }).timedOut === true
      ? 'The server didn’t answer in time. Pull down to see whether the change was made.'
      : 'You’re offline — the team can be changed when you’re connected.';
  }
  if (error instanceof ApiError && error.status < 500 && error.message && !/^Request failed/.test(error.message)) return error.message;
  return FALLBACK[action];
}
