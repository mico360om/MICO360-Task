import { ValidationError } from '../../lib/http-errors';
import type { PeopleLookup } from './project-repository';

/**
 * Refuse a list of people for a team when any of them isn't an active user (deactivated, suspended,
 * deleted or unknown), in plain words — `where` says which list (" for the team" on a new project).
 * companies: with `companyIds` (the project's companies), a non-admin who belongs to none of them is
 * refused too (MC1 Ruling 8); null or absent: no company rule (a project from before companies).
 * Without a lookup nobody is checked.
 */
export async function requireActiveTeam(people: PeopleLookup | undefined, userIds: string[], where = '', companyIds?: readonly string[] | null): Promise<void> {
  if (!people || userIds.length === 0) return;
  const wanted = [...new Set(userIds)];
  const active = new Set(await people.activeIds(wanted));
  const off = wanted.filter((id) => !active.has(id));
  if (off.length === 1) throw new ValidationError(`One of the people picked${where} isn’t an active user. Take them off and try again.`, { field: 'memberIds', userIds: off });
  if (off.length > 1) throw new ValidationError(`${off.length} of the people picked${where} aren’t active users. Take them off and try again.`, { field: 'memberIds', userIds: off });
  await requireInCompanies(people, wanted, companyIds, 'memberIds');
}

/**
 * companies: refuse people for a project (its owner, manager or team) who aren't administrators and
 * belong to none of its active companies: "Bob Betaonly isn’t in any of this project’s companies."
 * People already on a project are never checked again (nobody is taken off by this rule).
 */
export async function requireInCompanies(people: PeopleLookup | undefined, userIds: string[], companyIds: readonly string[] | null | undefined, field: string): Promise<void> {
  if (!people?.outsideCompanies || companyIds == null || userIds.length === 0) return;
  const outside = await people.outsideCompanies([...new Set(userIds)], [...companyIds]);
  if (outside.length) throw new ValidationError(`${outside[0]!.name} isn’t in any of this project’s companies.`, { field, userIds: outside.map((o) => o.id) });
}
