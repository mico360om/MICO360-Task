import type { DirectoryUser } from '../../api/users';
import { Avatar } from '../ui/Avatar';

/** A person's full name, else their username. */
export const personName = (u: Pick<DirectoryUser, 'firstName' | 'lastName' | 'username'>) => `${u.firstName} ${u.lastName}`.trim() || u.username;

/** People who may be picked for a project — owner or team: everyone still active. */
export const activePeople = (directory: DirectoryUser[]) => directory.filter((u) => u.active !== false);

/**
 * The choices for a project's owner: everyone active (deactivated and suspended people are never
 * offered — the server refuses them), plus the current owner even after they've left, so the
 * choice still says who it is. `allowNone` puts "No owner" first.
 */
export function ownerChoices(directory: DirectoryUser[], current: string | null | undefined, { allowNone }: { allowNone: boolean }) {
  const people = directory.filter((u) => u.active !== false || u.id === current);
  return [
    ...(allowNone ? [{ value: '', label: 'No owner' }] : []),
    ...people.map((u) => {
      const name = personName(u);
      return {
        value: u.id,
        label: name,
        hint: u.active === false ? `@${u.username} · no longer active` : `@${u.username}`,
        icon: <Avatar name={name} size="sm" src={u.avatarUrl} />,
      };
    }),
  ];
}
