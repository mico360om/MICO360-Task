import { describe, it, expect } from 'vitest';
import { hasWeb, loadWebTsx, readWeb } from '../testing/web-source';
import { websiteSays } from '../testing/phone-words';
import { ACTION_WORDS, REPORT_CLIENT_WORDS, clientResultLine, clientRow, inspectionMenu, notesNameSomeone, revisionLine } from './inspection-client';
import type { ClientInspection, InspectionPermissions } from './inspection-types';

/** A finished inspection's report, its actions and showing it to the client (Stage 4 Task 11). */

const NONE: InspectionPermissions = { canAnswer: false, canFinish: false, canReopen: false, canTakeOver: false, canDelete: false, canShowToClient: false, canMakeFollowUps: false };
const REPORT: ClientInspection = {
  id: 'i1',
  title: 'Rig check',
  date: '2026-10-30',
  place: 'Rig 3',
  counts: { total: 3, passed: 2, failed: 1, na: 0 },
  result: '1 failed',
  revisionNumber: 1,
  reopenedOn: null,
  sections: [
    {
      title: 'Safety',
      items: [
        { label: 'Guard rails fitted', kind: 'CHECK', result: 'Pass', reading: null, limits: null, note: 'Checked with Ann Lee on site' },
        { label: 'Pressure', kind: 'READING', result: 'Fail', reading: '162.5 psi', limits: '0–150 psi', note: null },
        { label: 'Hoses', kind: 'CHECK', result: null, reading: null, limits: null, note: 'annlee was away' },
      ],
    },
  ],
  signatures: [{ role: 'Inspector', name: 'Ann Lee', signedAt: '2026-10-30T08:00:00.000Z', signedOn: '30 Oct 2026, 12:00', image: null, typed: true }],
  unsigned: ['Client'],
};

it('the menu follows the server’s permissions', () => {
  expect(inspectionMenu({ ...NONE, canTakeOver: true, canDelete: true }, false)).toEqual(['takeOver', 'delete']);
  expect(inspectionMenu({ ...NONE, canReopen: true }, true)).toEqual(['report', 'reopen']);
  expect(inspectionMenu({ ...NONE, canTakeOver: true, canReopen: true, canDelete: true }, true)).toEqual(['report', 'takeOver', 'reopen', 'delete']);
  expect(inspectionMenu(NONE, false)).toEqual([]);
});

it('the client sees the website’s result line', () => {
  expect(clientResultLine({ ...REPORT, result: '2 failed', counts: { total: 3, passed: 1, failed: 2, na: 0 } })).toBe('2 failed · 3 items: 1 passed, 0 N/A');
  expect(clientResultLine({ ...REPORT, result: 'Passed', counts: { total: 1, passed: 1, failed: 0, na: 0 } })).toBe('Passed · 1 item: 1 passed, 0 failed, 0 N/A');
});

it('a row: its reading and limits, its result in words', () => {
  const [a, p, h] = REPORT.sections[0]!.items;
  expect(clientRow(a!)).toEqual({ reading: null, result: 'Pass' });
  expect(clientRow(p!)).toEqual({ reading: '162.5 psi · allowed 0–150 psi', result: 'Fail' });
  expect(clientRow(h!)).toEqual({ reading: null, result: '—' });
  expect(clientRow({ ...a!, result: 'N/A' })).toEqual({ reading: null, result: 'N/A' });
  expect(revisionLine({ revisionNumber: 2, reopenedOn: '2026-10-27' })).toBe('Revision 2 · reopened on 27 Oct 2026');
  expect(revisionLine({ revisionNumber: 1, reopenedOn: null })).toBeNull();
});

describe.skipIf(!hasWeb('frontend/src/components/inspections/ClientInspectionBody.tsx', 'frontend/src/components/inspections/InspectionClientSwitch.tsx', 'frontend/src/pages/InspectionPage.tsx', 'frontend/src/lib/name-highlight.ts', 'frontend/src/components/ui/ConfirmDialog.tsx'))('the website’s', () => {
  it('names check and words', () => {
    const body = loadWebTsx('frontend/src/components/inspections/ClientInspectionBody.tsx', { imports: { '../../lib/name-highlight': 'frontend/src/lib/name-highlight.ts' } }) as {
      notesNameSomeone: typeof notesNameSomeone;
      revisionLine: typeof revisionLine;
    };
    for (const names of [['Ann Lee'], ['annlee'], ['Omar'], []]) expect(notesNameSomeone(REPORT, names), names.join()).toBe(body.notesNameSomeone(REPORT, names));
    expect(notesNameSomeone(REPORT, ['Ann Lee'])).toBe(true);
    for (const r of [{ revisionNumber: 3, reopenedOn: '2026-01-05' }, { revisionNumber: 2, reopenedOn: null }, { revisionNumber: 1, reopenedOn: '2026-01-05' }]) expect(revisionLine(r)).toBe(body.revisionLine(r));
    const web = ['components/inspections/InspectionClientSwitch.tsx', 'pages/InspectionPage.tsx', 'components/ui/ConfirmDialog.tsx', 'components/inspections/ClientInspectionBody.tsx'].map((f) => readWeb(`frontend/src/${f}`));
    for (const [k, v] of Object.entries({ ...ACTION_WORDS, ...REPORT_CLIENT_WORDS })) expect(websiteSays(web, v), k).toBe(true);
  });
});
