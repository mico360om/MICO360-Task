import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  ROLES,
  NO_MODULE_ROW,
  accessWords,
  grantsChanged,
  grantsOf,
  isTicked,
  newRow,
  noModuleText,
  previewBlocked,
  roleAbout,
  rowsFromAccount,
  rowsWithoutModule,
  tickOpen,
  withRole,
  withRoleForAll,
  withTick,
  type AccessRow,
  type PermissionKey,
} from './client-access';
import { FIN, MICO, RIG, access } from './test-server';

const ticked = (row: AccessRow) => PERMISSIONS.filter((p) => isTicked(row, p.key)).map((p) => p.key);
const VIEWER: PermissionKey[] = ['progress', 'meetings', 'download', 'notify'];
const CONTRIBUTOR: PermissionKey[] = [...VIEWER, 'comment', 'upload', 'respond'];
const ALL: PermissionKey[] = [...CONTRIBUTOR, 'signOff'];

describe('client-access: the eight permissions and the roles (1.23.7)', () => {
  it('lists the eight permissions in the matrix’s order, with the server’s labels', () => {
    expect(PERMISSIONS.map((p) => [p.key, p.label])).toEqual([
      ['progress', 'View tasks'],
      ['meetings', 'View meetings & minutes'],
      ['download', 'Download reports'],
      ['notify', 'Receive notifications'],
      ['comment', 'Comment'],
      ['upload', 'Upload documents'],
      ['respond', 'Reply to invites'],
      ['signOff', 'Sign off'],
    ]);
    expect(ROLES.map((r) => [r.value, r.label])).toEqual([
      ['VIEWER', 'Viewer'],
      ['CONTRIBUTOR', 'Contributor'],
      ['APPROVER', 'Approver'],
      ['CUSTOM', 'Custom'],
    ]);
  });

  it('says what each role includes, as a ladder', () => {
    expect(roleAbout('VIEWER')).toBe('View tasks, View meetings & minutes, Download reports, Receive notifications');
    expect(roleAbout('CONTRIBUTOR')).toBe('Viewer, plus Comment, Upload documents, Reply to invites');
    expect(roleAbout('APPROVER')).toBe('Contributor, plus Sign off');
    expect(roleAbout('CUSTOM')).toBe('Only the boxes you tick');
  });

  it('a project just added starts as Viewer (its four ticks, nothing that writes)', () => {
    const row = newRow(MICO);
    expect(row).toMatchObject({ projectId: 'p-mico', name: 'MICO Tower', code: 'MICO', company: 'Prolens Projects LLC', archived: false, role: 'VIEWER' });
    expect(ticked(row)).toEqual(VIEWER);
  });

  it('picking a role ticks exactly its set; Custom keeps the ticks as they are', () => {
    const viewer = newRow(MICO);
    const contributor = withRole(viewer, 'CONTRIBUTOR');
    expect(contributor.role).toBe('CONTRIBUTOR');
    expect(ticked(contributor)).toEqual(CONTRIBUTOR);
    const approver = withRole(contributor, 'APPROVER');
    expect(ticked(approver)).toEqual(ALL);
    // Back down the ladder: the extra ticks go.
    expect(ticked(withRole(approver, 'VIEWER'))).toEqual(VIEWER);
    const custom = withRole(contributor, 'CUSTOM');
    expect(custom.role).toBe('CUSTOM');
    expect(ticked(custom)).toEqual(CONTRIBUTOR);
  });

  it('changing any tick makes the row Custom — and it stays Custom even when the ticks match a role again', () => {
    const row = withTick(newRow(MICO), 'comment', true);
    expect(row.role).toBe('CUSTOM');
    expect(ticked(row)).toEqual([...VIEWER, 'comment']);
    const back = withTick(row, 'comment', false);
    expect(back.role).toBe('CUSTOM');
    expect(ticked(back)).toEqual(VIEWER);
  });

  it('dependencies as the server: Comment, Upload and Sign off need View tasks; Reply needs View meetings; Download and Notify need either', () => {
    const approver = withRole(newRow(MICO), 'APPROVER');
    const noTasks = withTick(approver, 'progress', false);
    expect(ticked(noTasks)).toEqual(['meetings', 'download', 'notify', 'respond']);
    for (const k of ['comment', 'upload', 'signOff'] as const) expect(tickOpen(noTasks, k)).toBe(false);
    expect(tickOpen(noTasks, 'respond')).toBe(true);
    // A closed tick can't be ticked.
    expect(withTick(noTasks, 'comment', true)).toBe(noTasks);

    const noMeetings = withTick(approver, 'meetings', false);
    expect(ticked(noMeetings)).toEqual(['progress', 'download', 'notify', 'comment', 'upload', 'signOff']);
    expect(tickOpen(noMeetings, 'respond')).toBe(false);

    const none = withTick(noTasks, 'meetings', false);
    expect(ticked(none)).toEqual([]);
    for (const k of ['download', 'notify'] as const) expect(tickOpen(none, k)).toBe(false);
    // Turning a view back on never brings back an old tick.
    expect(ticked(withTick(none, 'progress', true))).toEqual(['progress']);
    // The views are always open.
    expect(tickOpen(none, 'progress')).toBe(true);
    expect(tickOpen(none, 'meetings')).toBe(true);
  });

  it('“Same for all projects” gives every row that role', () => {
    const rows = [withTick(newRow(MICO), 'progress', false), newRow(RIG)];
    const all = withRoleForAll(rows, 'CONTRIBUTOR');
    expect(all.map((r) => r.role)).toEqual(['CONTRIBUTOR', 'CONTRIBUTOR']);
    for (const r of all) expect(ticked(r)).toEqual(CONTRIBUTOR);
  });
});

describe('client-access: from and to the server', () => {
  it('rows from the server keep their role; a row with no role (an older server) reads as Custom', () => {
    const [mico, rig] = rowsFromAccount([
      access(MICO, { role: 'CONTRIBUTOR', modules: { progress: true, meetings: true }, actions: { download: true, notify: true, comment: true, upload: true, respond: true } }),
      { ...access(RIG, { modules: { progress: true }, actions: { comment: true } }), role: undefined },
    ]);
    expect(mico!.role).toBe('CONTRIBUTOR');
    expect(ticked(mico!)).toEqual(CONTRIBUTOR);
    expect(rig!.role).toBe('CUSTOM');
    expect(ticked(rig!)).toEqual(['progress', 'comment']);
  });

  it('grantsOf sends the role and every tick (an action without its view off)', () => {
    const custom = withTick(withRole(newRow(MICO), 'APPROVER'), 'progress', false);
    expect(grantsOf([custom, newRow(RIG)])).toEqual([
      { projectId: 'p-mico', role: 'CUSTOM', modules: { progress: false, meetings: true }, actions: { comment: false, signOff: false, respond: true, download: true, upload: false, notify: true } },
      { projectId: 'p-rig', role: 'VIEWER', modules: { progress: true, meetings: true }, actions: { comment: false, signOff: false, respond: false, download: true, upload: false, notify: true } },
    ]);
  });

  it('grantsChanged notices a role change, a tick, a project added or removed — not the order', () => {
    const before = [newRow(MICO), withRole(newRow(RIG), 'CONTRIBUTOR')];
    expect(grantsChanged(before, [before[1]!, before[0]!])).toBe(false);
    // Same ticks, another role word: still a change (Custom vs Viewer is saved).
    expect(grantsChanged(before, [withRole(before[0]!, 'CUSTOM'), before[1]!])).toBe(true);
    expect(grantsChanged(before, [withRole(before[0]!, 'APPROVER'), before[1]!])).toBe(true);
    expect(grantsChanged(before, [withTick(before[0]!, 'notify', false), before[1]!])).toBe(true);
    expect(grantsChanged(before, [before[0]!])).toBe(true);
    expect(grantsChanged(before, [...before, newRow(FIN)])).toBe(true);
  });

  it('accessWords: the role word first, then the permission labels', () => {
    expect(accessWords(newRow(MICO))).toEqual(['Viewer', 'View tasks', 'View meetings & minutes', 'Download reports', 'Receive notifications']);
    expect(accessWords(withTick(newRow(MICO), 'meetings', false))).toEqual(['Custom', 'View tasks', 'Download reports', 'Receive notifications']);
  });

  it('a Custom row with neither view can’t be saved: named, in the server’s words', () => {
    const rows = [withTick(withTick(newRow(MICO), 'progress', false), 'meetings', false), newRow(RIG), withTick(withTick(newRow(FIN), 'meetings', false), 'progress', false)];
    expect(rowsWithoutModule(rows).map((r) => r.name)).toEqual(['MICO Tower', 'Finance Office']);
    expect(noModuleText(rowsWithoutModule(rows))).toBe('Tick at least one of View tasks or View meetings & minutes for MICO Tower and Finance Office.');
    expect(noModuleText([])).toBe('Tick at least one of View tasks or View meetings & minutes for each project.');
    expect(NO_MODULE_ROW).toBe('Tick at least one of View tasks or View meetings & minutes.');
  });

  it('Preview needs a project, and a view on each', () => {
    expect(previewBlocked([])).toBe('Add a project to preview what they would see.');
    expect(previewBlocked([withTick(withTick(newRow(MICO), 'progress', false), 'meetings', false)])).toBe('Tick a view on each project to preview.');
    expect(previewBlocked([newRow(MICO)])).toBeNull();
  });
});
