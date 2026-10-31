import { describe, it, expect } from 'vitest';
import { hasWeb, readWeb } from '../testing/web-source';
import { GUARD_RAILS, PRESSURE } from '../testing/inspection-fixtures';
import { websiteSays } from '../testing/phone-words';
import { DRAFT_DELAY_MS, ITEM_WORDS, allowedText, followUpLine, outsideText, readOnlyReading, readingDraft, readingError, readingLabel } from './inspection-item';

/** One checklist item on the phone (Stage 4 Task 7, Review Focus 3). */

it('a typed reading outside its limits is a Fail on the phone at once', () => {
  expect(readingDraft(PRESSURE, '162.5')).toEqual({ reading: '162.5', result: 'FAIL', outside: true });
  expect(readingDraft(PRESSURE, '١٢٠')).toEqual({ reading: '120', result: 'PASS', outside: false });
  expect(readingDraft(PRESSURE, ' 12,5 ')).toEqual({ reading: '12.5', result: 'PASS', outside: false });
  expect(readingDraft(PRESSURE, '')).toEqual({ reading: null, result: null, outside: false });
  expect(readingDraft(PRESSURE, '12.5.1')).toEqual({ reading: null, result: null, outside: false });
  expect(outsideText(PRESSURE)).toBe('Outside the allowed 0–150 psi');
  expect(allowedText(PRESSURE)).toBe('Allowed 0–150 psi');
  expect(allowedText({ ...PRESSURE, min: null, max: null })).toBe('');
  expect(readingError('12.5.1')).toBe('Enter the reading as a number, like 12.5');
  expect(readingError('')).toBeNull();
  expect(readingError(' 7 ')).toBeNull();
});

it('a reading shown read-only', () => {
  expect(readOnlyReading(PRESSURE, { result: 'FAIL', reading: null })).toBe('Couldn’t be taken (failed)');
  expect(readOnlyReading(PRESSURE, { result: 'NA', reading: null })).toBe('Not taken (N/A)');
  expect(readOnlyReading(PRESSURE, { result: 'FAIL', reading: '162.5' })).toBe('162.5 psi');
  expect(readOnlyReading(PRESSURE, undefined)).toBe('—');
  expect(readingLabel(PRESSURE)).toBe('Pressure, reading in psi');
  expect(readingLabel({ ...PRESSURE, unit: null })).toBe('Pressure, reading');
});

it('the follow-up line under a failed item', () => {
  expect(followUpLine({ itemId: 'p', task: { id: 't9', key: 'RIG-9', title: 'Fix', deleted: false, done: true }, pending: false }, { queued: false, canMake: true })).toEqual({ kind: 'task', text: 'Follow-up task: RIG-9 (done)', taskId: 't9' });
  expect(followUpLine({ itemId: 'p', task: { id: 't9', key: 'RIG-9', title: 'Fix', deleted: true, done: true }, pending: false }, { queued: false, canMake: true })).toEqual({ kind: 'task', text: 'Follow-up task: RIG-9 (deleted)', taskId: 't9' });
  expect(followUpLine({ itemId: 'p', task: null, pending: false, moved: true }, { queued: false, canMake: true })).toEqual({ kind: 'text', text: 'Its follow-up task was moved to another project.' });
  expect(followUpLine(undefined, { queued: true, canMake: true })).toEqual({ kind: 'text', text: 'Follow-up task saved on this phone: it’s made when you’re back online.' });
  expect(followUpLine({ itemId: 'p', task: null, pending: true }, { queued: false, canMake: true })).toEqual({ kind: 'text', text: 'Its follow-up task is being made…' });
  expect(followUpLine(undefined, { queued: false, canMake: true })).toEqual({ kind: 'make' });
  expect(followUpLine(undefined, { queued: false, canMake: false })).toBeNull();
});

it('a reading without a unit shows the number alone', () => expect(readOnlyReading({ ...GUARD_RAILS, kind: 'READING', unit: null, min: null, max: null }, { result: 'PASS', reading: '3' })).toBe('3'));

describe.skipIf(!hasWeb('frontend/src/components/inspections/InspectionItem.tsx'))('the website’s item', () => {
  it('waits as long before saving', () => expect(readWeb('frontend/src/components/inspections/InspectionItem.tsx')).toContain(`export const DRAFT_DELAY_MS = ${DRAFT_DELAY_MS};`));
  it('uses the website’s words', () => {
    const web = [readWeb('frontend/src/components/inspections/InspectionItem.tsx'), readWeb('frontend/src/components/inspections/inspection-ui.tsx')];
    for (const [k, w] of Object.entries(ITEM_WORDS)) expect(websiteSays(web, w), k).toBe(true);
  });
});
