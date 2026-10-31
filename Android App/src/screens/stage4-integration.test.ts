import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appPath, appSource as src, appSources } from '../testing/web-source';
import { itemTarget } from '../lib/management';
import { WEBSITE_LINK_PATHS, websitePageUrl } from '../lib/website';

/** Stage 4 put together (Task 21): inspections (lane I), templates and client sharing (lane S). */
it('every place an inspection opens from reaches the Inspection screen', () => {
  for (const f of ['components/inspections/InspectionRow.tsx', 'components/inspections/DueChecksSection.tsx', 'components/inspections/TaskInspectionsCard.tsx']) {
    expect(src(f), f).toMatch(/navigate\('Inspection', \{ inspectionId/);
  }
});

it('Management’s inspection rows open the inspection itself now, as the website’s (lead amendment 3)', () => {
  expect(itemTarget({ kind: 'inspection', id: 'ins1', title: 'Rig check', taskId: 't9' })).toEqual({ type: 'stack', screen: 'Inspection', params: { inspectionId: 'ins1', title: 'Rig check' } });
  // The website opens row.inspectionId ?? row.id.
  expect(itemTarget({ kind: 'inspection', id: 'row1', inspectionId: 'ins2', title: 'x' })).toMatchObject({ screen: 'Inspection', params: { inspectionId: 'ins2' } });
  expect(itemTarget({ kind: 'inspection', id: '../x', title: 'x' })).toBeNull();
  expect(src('navigation/apply-action.ts')).toMatch(/case 'Inspection':\s*navigationRef\.navigate\('Inspection', action\.params\);/);
});

it('nothing in an inspection is sent except through the outbox, apart from Start and the actions', () => {
  for (const [f, t] of appSources().filter(([f]) => !f.startsWith('lib/') && !f.startsWith('testing/'))) expect(t, f).not.toMatch(/inspections\.(answer|finish|makeFollowUps)\(/);
});

it('editing forms and templates stays on the website', () => {
  for (const [f, t] of appSources()) expect(t, f).not.toMatch(/\b(createForm|updateForm|deleteForm|createProjectTemplate|updateProjectTemplate|removeProjectTemplate|createTaskTemplate|updateTaskTemplate|removeTaskTemplate)\b/);
  // So the Templates page stays a website page (lead amendment 3): Open Templates, Inspection forms.
  expect(WEBSITE_LINK_PATHS).toContain('/templates');
  expect(websitePageUrl('https://task.mico360.com/api/v1', '/templates')).toBe('https://task.mico360.com/templates');
});

it('the release notes have Stage 4’s 13 lines, each under its lane’s marker', () => {
  const notes = readFileSync(resolve(appPath(''), '../docs/android-1-19-release-notes.md'), 'utf8').replace(/\r\n/g, '\n');
  const section = notes.slice(notes.indexOf('## Inspections, templates and client sharing'));
  const [lanes, rest] = section.split('<!-- inspections lines above this line -->');
  expect(lanes!.match(/^- In the Android app, /gm)).toHaveLength(7); // Tasks 5, 7, 8, 9, 10, 11, 12
  // Tasks 14, 16–20: Task 15's New task from a task template is Stage 2's line ("Daily work").
  expect(rest!.split('<!-- templates-client lines above this line -->')[0]!.match(/^- In the Android app, /gm)).toHaveLength(6);
  expect(notes).toContain('New task can start from a task template');
});
