import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ASSIGN_TARGET_KINDS, LIMITS, MODULE_STATUSES, REPORT_DATES, TRAINING_MODULES } from './training';

// The server owns the Training Center's words, limits and answer shapes; the website keeps an exact copy
// between the `<training-types>` markers of api/training.ts. This fails when the copy drifts (skipped where
// the server's code isn't checked out): copy the server's file (after its header comment) between the markers.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/modules/training/training-types.ts');
const copy = resolve(here, 'training.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared Training Center types', () => {
  it.skipIf(!existsSync(server))('the copy between the markers matches the server’s training-types.ts', () => {
    const s = read(server);
    const serverShared = s.slice(s.indexOf('export const TRAINING_MODULES'));
    const c = read(copy);
    const start = c.indexOf('// <training-types>\n') + '// <training-types>\n'.length;
    const end = c.indexOf('// </training-types>');
    expect(start).toBeGreaterThan(20);
    expect(c.slice(start, end)).toBe(serverShared);
  });

  it('keeps the module list and the 25 MB document limit', () => {
    expect(TRAINING_MODULES).toContain('portal');
    expect(LIMITS.documentBytes).toBe(25 * 1024 * 1024);
  });
});

describe('Learning Hub as one course: shared lists and limits', () => {
  it('has the module statuses, assignment kinds, report dates and new limits', () => {
    expect([...MODULE_STATUSES]).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'DONE']);
    expect([...ASSIGN_TARGET_KINDS]).toEqual(['USER', 'GROUP', 'DEPARTMENT', 'COMPANY', 'PROJECT', 'PEOPLE']);
    expect([...REPORT_DATES]).toEqual(['got', 'finished']);
    expect(LIMITS.moduleTitle).toBe(160);
    expect(LIMITS.modulesPerCourse).toBe(30);
    expect(LIMITS.peoplePerAssignment).toBe(200);
  });
});
