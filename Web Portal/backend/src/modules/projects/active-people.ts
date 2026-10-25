import { ValidationError } from '../../lib/http-errors';
import type { PeopleLookup } from './project-repository';

/**
 * Refuse a list of people for a team when any of them isn't an active user (deactivated, suspended,
 * deleted or unknown), in plain words — `where` says which list (" for the team" on a new project).
 * Without a lookup nobody is checked.
 */
export async function requireActiveTeam(people: PeopleLookup | undefined, userIds: string[], where = ''): Promise<void> {
  if (!people || userIds.length === 0) return;
  const wanted = [...new Set(userIds)];
  const active = new Set(await people.activeIds(wanted));
  const off = wanted.filter((id) => !active.has(id));
  if (off.length === 1) throw new ValidationError(`One of the people picked${where} isn’t an active user. Take them off and try again.`, { field: 'memberIds', userIds: off });
  if (off.length > 1) throw new ValidationError(`${off.length} of the people picked${where} aren’t active users. Take them off and try again.`, { field: 'memberIds', userIds: off });
}
