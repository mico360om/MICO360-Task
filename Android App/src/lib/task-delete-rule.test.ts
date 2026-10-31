import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { appPath, hasWeb, webPath } from '../testing/web-source';
import { DELETE_NOT_ALLOWED, mayDeleteSeries, mayDeleteTask } from './task-delete-rule';

// The server owns who may delete a task (its creator, or the one person it's assigned to); the app
// keeps an identical copy so Delete is greyed out with the reason the server refuses with. This
// fails when the copy drifts (skipped where the server's code isn't checked out beside the app):
// copy the server's file over this one.
const SERVER = 'backend/src/modules/tasks/task-delete-rule.ts';
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('the delete rule (drift)', () => {
  it.skipIf(!hasWeb(SERVER))('src/lib/task-delete-rule.ts matches the server’s', () => {
    expect(existsSync(appPath('src/lib/task-delete-rule.ts'))).toBe(true);
    expect(read(appPath('src/lib/task-delete-rule.ts'))).toBe(read(webPath(SERVER)));
  });
});

describe('the delete rule', () => {
  const f = { viewerId: 'me', mayManage: true, createdById: 'them' };
  it('its creator, or the one person it’s assigned to — among those who may delete tasks at all', () => {
    expect(mayDeleteTask({ ...f, createdById: 'me', assigneeIds: ['a', 'b'] })).toBe(true);
    expect(mayDeleteTask({ ...f, assigneeIds: ['me'] })).toBe(true);
    expect(mayDeleteTask({ ...f, assigneeIds: ['me', 'a'] })).toBe(false);
    expect(mayDeleteTask({ ...f, assigneeIds: [] })).toBe(false);
    expect(mayDeleteTask({ ...f, mayManage: false, createdById: 'me', assigneeIds: ['me'] })).toBe(false);
    expect(mayDeleteSeries({ viewerId: 'me', mayManage: true, seriesCreatorId: 'them' })).toBe(false);
    expect(DELETE_NOT_ALLOWED).toBe('Only the person who created this task, or the one person it’s assigned to, can delete it.');
  });
});
