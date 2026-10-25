import { matchesNormalized, normalizeForSearch } from '../search/text-normalize';
import type { AiPersonRec, AiProjectRec } from './mico-ai-data';

/**
 * Names the person (or the model) used, turned into records — never a guess: one match is
 * `found`, several are `several` (the caller asks which one), none is `none`. Exact matches win
 * over partial ones, so "RIG" is the project with that code even when "Rig Maintenance" exists.
 * A quick reply MICO AI offered ("Omar Khan (omar.k)", "Rig Inspection Portal (RIG)") reads back
 * as the one it named.
 */
export type Match<T> = { found: T } | { several: T[] } | { none: true };

const NONE = { none: true } as const;
const one = <T,>(list: T[]): Match<T> => (list.length === 1 ? { found: list[0]! } : list.length > 1 ? { several: list } : NONE);
/** "Name (hint)": the hint in brackets, and the name before it. */
const bracketed = (said: string) => /^(.*?)\s*\(([^()]+)\)\s*$/.exec(said.trim());

export const fullName = (p: Pick<AiPersonRec, 'firstName' | 'lastName' | 'username'>) => `${p.firstName} ${p.lastName}`.trim() || p.username;
/** How a person is offered as a quick reply. */
export const personOption = (p: AiPersonRec) => `${fullName(p)} (${p.username})`;
/** How a project is offered as a quick reply. */
export const projectOption = (p: Pick<AiProjectRec, 'name' | 'code'>) => `${p.name} (${p.code})`;

export function matchProject(projects: AiProjectRec[], said: string): Match<AiProjectRec> {
  const hint = bracketed(said);
  if (hint) {
    const byCode = projects.filter((p) => [p.code, p.number].some((x) => x && normalizeForSearch(x) === normalizeForSearch(hint[2])));
    if (byCode.length === 1) return { found: byCode[0]! };
    if (hint[1]) return matchProject(projects, hint[1]);
  }
  const n = normalizeForSearch(said);
  if (!n) return NONE;
  const exact = projects.filter((p) => [p.code, p.number, p.name].some((x) => x && normalizeForSearch(x) === n));
  return one(exact.length ? exact : projects.filter((p) => matchesNormalized(n, p.name, p.code, p.number)));
}

const ME = /^(me|myself|my|i|mine)$/i;

export function matchPerson(people: AiPersonRec[], said: string, viewerId: string): Match<AiPersonRec> {
  if (ME.test(said.trim())) {
    const me = people.find((p) => p.id === viewerId);
    if (me) return { found: me };
  }
  const hint = bracketed(said);
  if (hint) {
    const byUsername = people.filter((p) => normalizeForSearch(p.username) === normalizeForSearch(hint[2]));
    if (byUsername.length === 1) return { found: byUsername[0]! };
    if (hint[1]) return matchPerson(people, hint[1], viewerId);
  }
  const n = normalizeForSearch(said);
  if (!n) return NONE;
  const exact = people.filter((p) => [p.username, p.firstName, p.lastName, `${p.firstName} ${p.lastName}`].some((x) => normalizeForSearch(x) === n));
  return one(exact.length ? exact : people.filter((p) => matchesNormalized(n, `${p.firstName} ${p.lastName}`, p.username)));
}
