import { describe, it, expect } from 'vitest';
import { bulkMoveAvailability, bulkMovedText, moveAvailability, moveChanges, movedText } from './task-move';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import type { MovePreview, MoveTargets } from './types';

/** A file's text with Windows line ends (CRLF) as plain LF, so a copy compares equal on any checkout. */
const normalise = (text: string) => text.replace(/\r\n/g, '\n');

describe.skipIf(!hasWeb('frontend/src/lib/task-move.ts'))('a copy of the website’s task-move', () => {
  it('is the same text (types from ./types)', () => expect(normalise(src('lib/task-move.ts')).replace("from './types'", "from '../api/tasks'")).toBe(normalise(readWeb('frontend/src/lib/task-move.ts'))));
});

const targets = (o: Partial<MoveTargets> = {}): MoveTargets => ({ managesAll: false, managedProjectIds: ['p1', 'p2'], projects: [{ id: 'p1', code: 'RIG', name: 'Rig', status: 'ACTIVE', color: null, icon: null, imageUrl: null }, { id: 'p2', code: 'OPS', name: 'Operations', status: 'ACTIVE', color: null, icon: null, imageUrl: null }], ...o });
it('who may move a task, and why not, in words', () => {
  expect(moveAvailability('p1', undefined, 'Rig')).toEqual({ canMove: false, reason: 'Checking where it can go…' });
  expect(moveAvailability('p1', targets(), 'Rig')).toEqual({ canMove: true, reason: null });
  expect(moveAvailability('p3', targets(), 'Pumps').reason).toBe('To move it, you need to manage both Pumps and the project it goes to.');
  expect(bulkMoveAvailability(targets({ projects: [] })).reason).toBe('You don’t manage an open project to move tasks to.');
});
it('says what will change and what happened', () => {
  const preview: MovePreview = {
    project: { id: 'p2', code: 'OPS', name: 'Operations', status: 'ACTIVE', color: null, icon: null, imageUrl: null, defaultDueToday: false },
    columns: [{ id: 'c1', name: 'To do', category: 'TODO', position: 0, enabled: true }],
    tasks: [{ id: 't1', key: 'RIG-4', title: 'Check pumps', from: null, canMove: true, reason: null, newKey: 'OPS-17', currentCategory: 'TODO', completed: false, columnId: 'c1', milestoneCleared: false, dueDate: null, repeat: null, outsiders: [] }],
    outsiders: [],
  };
  expect(moveChanges(preview, '2026-10-30')[0]).toBe('Becomes OPS-17. Searching for RIG-4 still finds it.');
  expect(movedText({ to: { projectId: 'p2', name: 'Operations', key: 'OPS-17' } })).toBe('Moved to Operations as OPS-17');
  expect(bulkMovedText({ moved: 2, failed: 1 }, 'Operations')).toBe('Moved 2 of 3 tasks to Operations. 1 couldn’t be moved.');
});
