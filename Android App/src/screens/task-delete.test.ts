import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/**
 * Deleting a task on the task screen follows the owner's rule (task-delete-rule): Delete task stays
 * for whoever may delete tasks at all, greyed out with the reason for someone else's task that isn't
 * theirs alone; on a repeating copy whose series they didn't create, only "This occurrence" is offered,
 * saying why. Checked by source text (the screen needs a device).
 */
const screen = src('screens/TaskDetailScreen.tsx');

it('works out the choice from the task, its assignees and who runs the project', () => {
  expect(screen).toMatch(/const del = deleteChoice\(session\?\.user \?\? null, projectQ\.data, members, task, \(assigneesQ\.data \?\? \[\]\)\.map\(\(a\) => a\.id\)\);/);
});

it('Delete task stays, greyed out with the reason said under it and to TalkBack', () => {
  expect(screen).toMatch(/\{del\.offered \? \(/);
  expect(screen).toMatch(/<Button title="Delete task"[^>]*disabled=\{!!del\.blocked\}[^>]*accessibilityHint=\{del\.blocked \?\? undefined\}/);
  expect(screen).toMatch(/\{del\.blocked \? <Text style=\{styles\.dangerNote\}>\{del\.blocked\}<\/Text> : null\}/);
  expect(screen).not.toMatch(/canDeleteTask\(session\?\.user \?\? null, projectQ\.data, members\) \? \(/);
});

it('a repeating copy whose series they didn’t create: only this occurrence, saying why', () => {
  expect(screen).toMatch(/if \(series && del\.seriesBlocked\) \{\s*Alert\.alert\('Delete this occurrence\?', `\$\{del\.seriesBlocked\} This occurrence can be deleted\.`, \[/);
  expect(screen).toMatch(/\{ text: 'This occurrence', style: 'destructive', onPress: \(\) => void run\(\) \},\s*\]\);\s*\} else if \(series\)/);
});
