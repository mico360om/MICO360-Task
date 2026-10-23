import type { BulkMoveResult, MovePerson, MovePreview, MoveResult, MoveTargets, TaskMovePreview } from '../api/tasks';

/**
 * Moving tasks to another project, in words: who may (the menus disable the action and say why),
 * what a move will change (the dialog's "What will change"), and what happened after it.
 * The rule is the server's: administrators, or someone who manages both projects, may move a task
 * into an open project.
 */

export interface MoveAvailability {
  canMove: boolean;
  /** Why not, in words (null when it can). */
  reason: string | null;
}

/**
 * May the signed-in person move a task of `projectId`? `targets` is undefined while it loads and
 * null when it couldn't be loaded.
 */
export function moveAvailability(projectId: string, targets: MoveTargets | null | undefined, projectName: string | undefined): MoveAvailability {
  if (targets === undefined) return { canMove: false, reason: 'Checking where it can go…' };
  if (targets === null) return { canMove: false, reason: 'Couldn’t check where it can go. Try again later.' };
  if (!targets.managesAll && !targets.managedProjectIds.includes(projectId)) {
    return { canMove: false, reason: `To move it, you need to manage both ${projectName ?? 'its project'} and the project it goes to.` };
  }
  if (!targets.projects.some((p) => p.id !== projectId)) {
    return { canMove: false, reason: targets.managesAll ? 'There’s no other open project to move it to.' : 'There’s no other open project you manage to move it to.' };
  }
  return { canMove: true, reason: null };
}

/** May the signed-in person move several tasks (each is checked in the dialog)? */
export function bulkMoveAvailability(targets: MoveTargets | null | undefined): MoveAvailability {
  if (targets === undefined) return { canMove: false, reason: 'Checking where they can go…' };
  if (targets === null) return { canMove: false, reason: 'Couldn’t check where they can go. Try again later.' };
  if (targets.projects.length === 0) {
    return { canMove: false, reason: targets.managesAll ? 'There’s no open project to move tasks to.' : 'You don’t manage an open project to move tasks to.' };
  }
  return { canMove: true, reason: null };
}

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
function names(people: MovePerson[], shown = 3): string {
  const all = people.map((p) => p.name);
  if (all.length <= 1) return all[0] ?? '';
  if (all.length > shown + 1) return `${all.slice(0, shown).join(', ')} and ${all.length - shown} more`;
  return `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
}

/** "Tue 27 Oct" (with the year when it isn't this year's). */
function dayWords(day: string, today: string): string {
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(',', '');
}

/** "One of them …" / "2 of them …". */
const count = (n: number) => (n === 1 ? 'One' : String(n));

/**
 * The dialog's "What will change", for the tasks that can move: their new numbers (the old ones still
 * find them), whether they will be completed or reopened (a Done column completes a task, an open one
 * reopens a completed task), milestones cleared, due dates given by the new project's setting,
 * repeats, and what goes along. `today` is the company's day ('YYYY-MM-DD'); `columnId` is the column
 * chosen in the dialog (else each task's suggested one).
 */
export function moveChanges(preview: MovePreview, today: string, columnId?: string): string[] {
  const movable = preview.tasks.filter((t) => t.canMove);
  const project = preview.project.name;
  if (movable.length === 0) return [];
  const intoDone = (t: TaskMovePreview) => preview.columns.find((c) => c.id === (columnId || t.columnId))?.category === 'DONE';
  const completes = movable.filter((t) => !t.completed && intoDone(t)).length;
  const reopens = movable.filter((t) => t.completed && !intoDone(t)).length;
  if (movable.length === 1) {
    const t = movable[0]!;
    const lines = [`Becomes ${t.newKey}. Searching for ${t.key} still finds it.`];
    if (completes) lines.push('It will be marked complete.');
    if (reopens) lines.push('It will be reopened.');
    if (t.milestoneCleared) lines.push('It stops being a milestone: milestones belong to their project.');
    if (t.dueDate) {
      lines.push(
        t.dueDate === today
          ? `It gets today as its due date, as new tasks in ${project} do.`
          : `It gets ${dayWords(t.dueDate, today)}, the day it’s on the board for, as its due date, as new tasks in ${project} do.`,
      );
    }
    if (t.repeat === 'SERIES') lines.push(`It repeats: its next copies will be made in ${project}.`);
    if (t.repeat === 'COPY') lines.push('It’s an earlier copy of a repeating task: only this copy moves.');
    lines.push('Its comments, files, checklist, history, watchers and blockers go with it.');
    return lines;
  }
  const first = movable[0]!.newKey;
  const last = movable[movable.length - 1]!.newKey;
  const lines = [`They get the next ${preview.project.code} numbers, ${first} to ${last}. Searching for their old numbers still finds them.`];
  if (completes) lines.push(`${completes === 1 ? 'One of them' : `${completes} of them`} will be marked complete.`);
  if (reopens) lines.push(`${reopens === 1 ? 'One of them' : `${reopens} of them`} will be reopened.`);
  const milestones = movable.filter((t) => t.milestoneCleared).length;
  if (milestones === 1) lines.push('One of them stops being a milestone: milestones belong to their project.');
  else if (milestones > 1) lines.push(`${milestones} of them stop being milestones: milestones belong to their project.`);
  const dated = movable.filter((t) => t.dueDate).length;
  if (dated > 0) lines.push(`${count(dated)} without a due date ${dated === 1 ? 'gets' : 'get'} one, as new tasks in ${project} do.`);
  const series = movable.filter((t) => t.repeat === 'SERIES').length;
  if (series === 1) lines.push(`One repeats: its next copies will be made in ${project}.`);
  else if (series > 1) lines.push(`${series} repeat: their next copies will be made in ${project}.`);
  const copies = movable.filter((t) => t.repeat === 'COPY').length;
  if (copies === 1) lines.push('One is an earlier copy of a repeating task: only that copy moves.');
  else if (copies > 1) lines.push(`${copies} are earlier copies of repeating tasks: only those copies move.`);
  lines.push('Their comments, files, checklists, history, watchers and blockers go with them.');
  return lines;
}

/** "Sara Al Balushi isn’t on the Operations team." / "A and B aren’t on the Operations team." */
export function notOnTeamText(people: MovePerson[], projectName: string): string {
  return `${names(people)} ${people.length === 1 ? 'isn’t' : 'aren’t'} on the ${projectName} team.`;
}

/** The two answers to "not on the team", by name when it is one person. */
export function assigneeChoiceLabels(people: MovePerson[]): { add: string; unassign: string } {
  if (people.length === 1) return { add: `Add ${people[0]!.name} to the team`, unassign: `Unassign ${people[0]!.name}` };
  return { add: 'Add them to the team', unassign: 'Unassign them' };
}

/** "Moved to Operations as OPS-17". */
export function movedText(result: Pick<MoveResult, 'to'>): string {
  return `Moved to ${result.to.name} as ${result.to.key}`;
}

/** "Moved 3 tasks to Operations." / "Moved 2 of 3 tasks to Operations. 1 couldn’t be moved." */
export function bulkMovedText(result: Pick<BulkMoveResult, 'moved' | 'failed'>, projectName: string): string {
  const total = result.moved + result.failed;
  if (result.moved === 0) return `None of the ${total} tasks could be moved to ${projectName}.`;
  if (result.failed === 0) return `Moved ${result.moved} task${result.moved === 1 ? '' : 's'} to ${projectName}.`;
  return `Moved ${result.moved} of ${total} tasks to ${projectName}. ${result.failed} couldn’t be moved.`;
}
