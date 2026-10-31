import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ext from './task-delete-rule.js';

// The server owns who may delete a task (Web Portal/backend/src/modules/tasks/task-delete-rule.ts):
// its creator, or the one person it's assigned to. The extension keeps a plain-JavaScript copy so
// Delete is greyed out with the reason the server refuses with. The copies can't be compared as
// text, so both answer every case here and must agree (skipped where the server isn't checked out).
const SERVER = resolve(__dirname, '../..', 'Web Portal/backend/src/modules/tasks/task-delete-rule.ts');
const server = existsSync(SERVER) ? await import(pathToFileURL(SERVER).href) : null;

describe.skipIf(!server)('the delete rule: src/task-delete-rule.js matches the server', () => {
  it('the same words and code', () => {
    for (const name of ['DELETE_NOT_ALLOWED_CODE', 'DELETE_NOT_ALLOWED', 'DELETE_SERIES_NOT_ALLOWED']) expect(ext[name], name).toBe(server[name]);
  });

  it('the same answer for every viewer, creator and set of assignees', () => {
    const PEOPLE = ['me', 'a', 'b'];
    const SETS = [[], ['me'], ['a'], ['me', 'a'], ['a', 'b'], ['me', 'me'], ['me', 'a', 'b']];
    for (const mayManage of [true, false]) {
      for (const createdById of PEOPLE) {
        for (const assigneeIds of SETS) {
          const f = { viewerId: 'me', mayManage, createdById, assigneeIds };
          expect(ext.mayDeleteTask(f), JSON.stringify(f)).toBe(server.mayDeleteTask(f));
        }
        const s = { viewerId: 'me', mayManage, seriesCreatorId: createdById };
        expect(ext.mayDeleteSeries(s), JSON.stringify(s)).toBe(server.mayDeleteSeries(s));
      }
    }
  });
});

describe('the delete rule', () => {
  it('its creator, or the one person it’s assigned to — among those who may delete tasks at all', () => {
    const f = { viewerId: 'me', mayManage: true, createdById: 'them' };
    expect(ext.mayDeleteTask({ ...f, assigneeIds: ['me'] })).toBe(true);
    expect(ext.mayDeleteTask({ ...f, assigneeIds: ['me', 'a'] })).toBe(false);
    expect(ext.mayDeleteTask({ ...f, createdById: 'me', assigneeIds: ['a', 'b'] })).toBe(true);
    expect(ext.mayDeleteTask({ ...f, mayManage: false, createdById: 'me', assigneeIds: [] })).toBe(false);
  });
});
