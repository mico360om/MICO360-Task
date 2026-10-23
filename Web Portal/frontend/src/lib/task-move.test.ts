import { describe, it, expect } from 'vitest';
import { bulkMoveAvailability, bulkMovedText, moveAvailability, moveChanges, movedText, notOnTeamText, assigneeChoiceLabels } from './task-move';
import type { MovePreview, MoveTargets, TaskMovePreview } from '../api/tasks';

const P = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, status: 'ACTIVE', color: null, icon: null, imageUrl: null });
const targets = (over: Partial<MoveTargets> = {}): MoveTargets => ({ managesAll: false, managedProjectIds: ['rig', 'ops'], projects: [P('rig', 'Rig Inspection'), P('ops', 'Operations')], ...over });

describe('Who may move a task, as the menus say it', () => {
  it('someone who manages its project and another open one may', () => {
    expect(moveAvailability('rig', targets(), 'Rig Inspection')).toEqual({ canMove: true, reason: null });
    expect(moveAvailability('adm', targets({ managesAll: true, managedProjectIds: [] }), 'Admin')).toEqual({ canMove: true, reason: null });
  });

  it('someone who doesn’t manage its project may not, and is told what they’d need', () => {
    expect(moveAvailability('adm', targets(), 'Admin')).toEqual({ canMove: false, reason: 'To move it, you need to manage both Admin and the project it goes to.' });
    expect(moveAvailability('adm', targets(), undefined).reason).toBe('To move it, you need to manage both its project and the project it goes to.');
  });

  it('with nowhere else to go, it says so', () => {
    const onlyRig = targets({ projects: [P('rig', 'Rig Inspection')] });
    expect(moveAvailability('rig', onlyRig, 'Rig Inspection')).toEqual({ canMove: false, reason: 'There’s no other open project you manage to move it to.' });
    expect(moveAvailability('rig', { ...onlyRig, managesAll: true }, 'Rig Inspection').reason).toBe('There’s no other open project to move it to.');
  });

  it('while it is still checking, or when it couldn’t check', () => {
    expect(moveAvailability('rig', undefined, 'Rig Inspection')).toEqual({ canMove: false, reason: 'Checking where it can go…' });
    expect(moveAvailability('rig', null, 'Rig Inspection')).toEqual({ canMove: false, reason: 'Couldn’t check where it can go. Try again later.' });
  });

  it('several tasks: anyone with an open project to move them to', () => {
    expect(bulkMoveAvailability(targets())).toEqual({ canMove: true, reason: null });
    expect(bulkMoveAvailability(targets({ projects: [] }))).toEqual({ canMove: false, reason: 'You don’t manage an open project to move tasks to.' });
    expect(bulkMoveAvailability(targets({ projects: [], managesAll: true })).reason).toBe('There’s no open project to move tasks to.');
    expect(bulkMoveAvailability(undefined).canMove).toBe(false);
  });
});

function task(over: Partial<TaskMovePreview> = {}): TaskMovePreview {
  return {
    id: 't4', key: 'RIG-4', title: 'Inspect the rig', from: { id: 'rig', code: 'RIG', name: 'Rig Inspection' }, canMove: true, reason: null,
    newKey: 'OPS-17', currentCategory: 'IN_PROGRESS', completed: false, columnId: 'o-doing', milestoneCleared: false, dueDate: null, repeat: null, outsiders: [], ...over,
  };
}
const preview = (tasks: TaskMovePreview[]): MovePreview => ({
  project: { ...P('ops', 'Operations'), code: 'OPS', defaultDueToday: false },
  columns: [
    { id: 'o-doing', name: 'Doing', category: 'IN_PROGRESS', position: 0, enabled: true },
    { id: 'o-done', name: 'Finished', category: 'DONE', position: 1, enabled: true },
  ],
  tasks,
  outsiders: [],
});
const TODAY = '2026-10-24';

describe('What a move will change, in plain words', () => {
  it('one task: its new number (the old one still finds it) and what goes with it', () => {
    expect(moveChanges(preview([task()]), TODAY)).toEqual([
      'Becomes OPS-17. Searching for RIG-4 still finds it.',
      'Its comments, files, checklist, history, watchers and blockers go with it.',
    ]);
  });

  it('one task: its milestone, a due date it gets, and its repeat', () => {
    expect(moveChanges(preview([task({ milestoneCleared: true, dueDate: TODAY, repeat: 'SERIES' })]), TODAY)).toEqual([
      'Becomes OPS-17. Searching for RIG-4 still finds it.',
      'It stops being a milestone: milestones belong to their project.',
      'It gets today as its due date, as new tasks in Operations do.',
      'It repeats: its next copies will be made in Operations.',
      'Its comments, files, checklist, history, watchers and blockers go with it.',
    ]);
    expect(moveChanges(preview([task({ dueDate: '2026-10-27', repeat: 'COPY' })]), TODAY)).toEqual([
      'Becomes OPS-17. Searching for RIG-4 still finds it.',
      'It gets Tue 27 Oct, the day it’s on the board for, as its due date, as new tasks in Operations do.',
      'It’s an earlier copy of a repeating task: only this copy moves.',
      'Its comments, files, checklist, history, watchers and blockers go with it.',
    ]);
  });

  it('several tasks: the numbers they get, and how many each change applies to', () => {
    const many = [
      task({ id: 'a', newKey: 'OPS-17', milestoneCleared: true, dueDate: TODAY, repeat: 'SERIES' }),
      task({ id: 'b', newKey: 'OPS-18', milestoneCleared: true }),
      task({ id: 'c', newKey: 'OPS-19', dueDate: TODAY, repeat: 'COPY' }),
      task({ id: 'd', canMove: false, newKey: null, reason: 'Already in Operations.' }),
    ];
    expect(moveChanges(preview(many), TODAY)).toEqual([
      'They get the next OPS numbers, OPS-17 to OPS-19. Searching for their old numbers still finds them.',
      '2 of them stop being milestones: milestones belong to their project.',
      '2 without a due date get one, as new tasks in Operations do.',
      'One repeats: its next copies will be made in Operations.',
      'One is an earlier copy of a repeating task: only that copy moves.',
      'Their comments, files, checklists, history, watchers and blockers go with them.',
    ]);
  });

  it('into a Done column it will be marked complete; a completed task moved to an open one will be reopened', () => {
    expect(moveChanges(preview([task({ columnId: 'o-done' })]), TODAY)).toContain('It will be marked complete.');
    expect(moveChanges(preview([task({ completed: true, columnId: 'o-doing' })]), TODAY)).toContain('It will be reopened.');
    expect(moveChanges(preview([task({ completed: true, columnId: 'o-done' })]), TODAY).join(' ')).not.toMatch(/marked complete|reopened/);
    // The column chosen in the dialog counts, not the one suggested.
    expect(moveChanges(preview([task({ columnId: 'o-doing' })]), TODAY, 'o-done')).toEqual([
      'Becomes OPS-17. Searching for RIG-4 still finds it.',
      'It will be marked complete.',
      'Its comments, files, checklist, history, watchers and blockers go with it.',
    ]);
    const several = preview([
      task({ id: 'a', newKey: 'OPS-17', columnId: 'o-done' }),
      task({ id: 'b', newKey: 'OPS-18', columnId: 'o-done' }),
      task({ id: 'c', newKey: 'OPS-19', completed: true, columnId: 'o-doing' }),
    ]);
    expect(moveChanges(several, TODAY)).toEqual(expect.arrayContaining(['2 of them will be marked complete.', 'One of them will be reopened.']));
    expect(moveChanges(several, TODAY, 'o-done')).toEqual(expect.arrayContaining(['2 of them will be marked complete.']));
    expect(moveChanges(several, TODAY, 'o-done').join(' ')).not.toContain('reopened');
  });

  it('nothing to say when no task can move', () => {
    expect(moveChanges(preview([task({ canMove: false, newKey: null })]), TODAY)).toEqual([]);
  });
});

describe('People not on the new team', () => {
  const sara = { id: 's', name: 'Sara Al Balushi' };
  it('names them, and asks about them by name when there is one', () => {
    expect(notOnTeamText([sara], 'Operations')).toBe('Sara Al Balushi isn’t on the Operations team.');
    expect(assigneeChoiceLabels([sara])).toEqual({ add: 'Add Sara Al Balushi to the team', unassign: 'Unassign Sara Al Balushi' });
    const five = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ id: n, name: n }));
    expect(notOnTeamText(five.slice(0, 2), 'Ops')).toBe('A and B aren’t on the Ops team.');
    expect(notOnTeamText(five, 'Ops')).toBe('A, B, C and 2 more aren’t on the Ops team.');
    expect(assigneeChoiceLabels(five)).toEqual({ add: 'Add them to the team', unassign: 'Unassign them' });
  });
});

describe('After the move', () => {
  it('one task: where it went, and as what', () => {
    expect(movedText({ to: { projectId: 'ops', name: 'Operations', key: 'OPS-17' } })).toBe('Moved to Operations as OPS-17');
  });
  it('several: how many, and how many couldn’t be moved', () => {
    expect(bulkMovedText({ moved: 3, failed: 0 }, 'Operations')).toBe('Moved 3 tasks to Operations.');
    expect(bulkMovedText({ moved: 1, failed: 0 }, 'Operations')).toBe('Moved 1 task to Operations.');
    expect(bulkMovedText({ moved: 2, failed: 1 }, 'Operations')).toBe('Moved 2 of 3 tasks to Operations. 1 couldn’t be moved.');
    expect(bulkMovedText({ moved: 0, failed: 2 }, 'Operations')).toBe('None of the 2 tasks could be moved to Operations.');
  });
});
