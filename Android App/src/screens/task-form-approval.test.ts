import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

// Stage 2 Task 5: "Needs approval" in New and Edit task (the website's TaskFormDialog).
it('the tick is disabled whenever it is locked', () => expect(src('screens/NewTaskScreen.tsx')).toMatch(/<CheckRow[^>]*label="Needs approval"[^>]*disabled=\{tick\.locked(?: \|\| frozen)?\}/));
it('the tick says the website’s hint and its note, and follows a project change as the website does', () => {
  const s = src('screens/NewTaskScreen.tsx');
  expect(s).toMatch(/approvalTickFor\(\{ isAdmin, project, editing, task: editTask \}\)/);
  expect(s).toMatch(/\{APPROVAL_HINT\}/); expect(s).toMatch(/tick\.note \?/);
  expect(s).toMatch(/approvalAfterProjectChange\(\{ on: draft\.needsApproval, touched: approvalTouched\.current, tick \}\)/);
  // After the Milestone row.
  expect(s.indexOf('label="Needs approval"')).toBeGreaterThan(s.indexOf('label="Milestone"'));
  expect(s).toMatch(/checkNewTask\(draft, \{ noProjects, boardDate: params\.boardDate, project \}\)/);
});
it('an Edit save that changes the tick goes now, as the person who saved it, in the task’s lane against the newest version (final review A1)', () => {
  const s = src('core/new-task.ts');
  expect(s).toMatch(/updateLive: async \(patch\) => \{[^]*liveTaskWrite\(taskWrites, taskId, editBaseVersion\(openedVersion, [^]*w\.resources\.tasks\.update\(taskId, withExpectedVersion\(patch, version\)\)[^]*afterTaskSaved\(qc, taskId, done, patch\)/);
});
