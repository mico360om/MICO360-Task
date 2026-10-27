/**
 * What each role gets when a project is saved as a template — the server's rule (template-service
 * saveProjectAsTemplate), worked out as the saver types: a task names the role of the first of its
 * people, in the order they were assigned, who was given one; the same name for two people is one
 * role (its first spelling); a task none of whose people has a role is left unassigned.
 */
export interface RoleCounts {
  /** Each role (in the order the people are listed) and how many tasks name it. */
  roles: { name: string; tasks: number }[];
  /** Per person: how many tasks name their role because of them (0 when they have none). */
  fromPerson: Map<string, number>;
  /** Tasks that name no role (they go to the new project's owner). */
  unassigned: number;
}

const keyOf = (name: string) => name.trim().toLocaleLowerCase();

export function roleCounts(assignments: string[][], people: string[], roleOf: Record<string, string>): RoleCounts {
  const spelling = new Map<string, string>();
  for (const id of people) {
    const name = (roleOf[id] ?? '').trim();
    if (name && !spelling.has(keyOf(name))) spelling.set(keyOf(name), name);
  }
  const tasks = new Map<string, number>();
  const fromPerson = new Map<string, number>();
  let unassigned = 0;
  for (const onTask of assignments) {
    const who = onTask.find((id) => (roleOf[id] ?? '').trim());
    if (!who) {
      unassigned++;
      continue;
    }
    const key = keyOf(roleOf[who]!);
    tasks.set(key, (tasks.get(key) ?? 0) + 1);
    fromPerson.set(who, (fromPerson.get(who) ?? 0) + 1);
  }
  return { roles: [...spelling].map(([key, name]) => ({ name, tasks: tasks.get(key) ?? 0 })), fromPerson, unassigned };
}
