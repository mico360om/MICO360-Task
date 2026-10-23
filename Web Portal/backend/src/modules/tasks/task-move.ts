import type { MoveColumn, MovePerson } from './task-move-repository';

/** "A", "A and B", "A, B and C". */
export function namesText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The column a task moved to another project goes to unless another is chosen: the new project's
 * first column (in board order) of the same kind as the one it is in now, else its first column.
 * Columns switched off in Manage columns aren't on the board, so they are used only when the project
 * has no other.
 */
export function matchingColumn(columns: MoveColumn[], category: string | null): MoveColumn | null {
  const ordered = [...columns].sort((a, b) => a.position - b.position);
  const shown = ordered.filter((c) => c.enabled);
  const pool = shown.length > 0 ? shown : ordered;
  return pool.find((c) => c.category === category) ?? pool[0] ?? null;
}

/** Why a move needs a choice: who is assigned but not on the new project's team. */
export function notOnTeamMessage(people: MovePerson[], projectName: string): string {
  const verb = people.length === 1 ? 'isn’t' : 'aren’t';
  return `${namesText(people.map((p) => p.name))} ${verb} on the ${projectName} team. Choose whether to add them to the team or unassign them.`;
}
