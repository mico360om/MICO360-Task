import { describe, it, expect } from 'vitest';
import { CHECKLIST_ITEM_MAX, CHECKLIST_MAX, CHECKLIST_TEXT, checklistItemLabel, checklistRemoveLabel, checklistRows, checklistTexts, newChecklistRow } from './checklist-draft';
import { hasWeb, loadWebTsx, readWeb } from '../testing/web-source';

const CASES: Array<[string[], string]> = [[['  a ', '', 'b'], ''], [[], 'x\n\n y \r\nz'], [Array.from({ length: 99 }, (_, i) => `i${i}`), 'p\nq'], [[], 'w'.repeat(300)]];
const FIELD = 'frontend/src/components/task-form/ChecklistField.tsx';
const FORM = 'frontend/src/components/task-form/TaskFormDialog.tsx';

describe.skipIf(!hasWeb(FIELD, FORM))('the website’s checklist rules and words', () => {
  it('same items saved', () => {
    const web = loadWebTsx(FIELD) as { checklistTexts: typeof checklistTexts; checklistRows: typeof checklistRows; CHECKLIST_MAX: number; CHECKLIST_ITEM_MAX: number };
    for (const [texts, pending] of CASES) expect(checklistTexts(checklistRows(texts), pending)).toEqual(web.checklistTexts(web.checklistRows(texts), pending));
    expect([web.CHECKLIST_ITEM_MAX, web.CHECKLIST_MAX]).toEqual([CHECKLIST_ITEM_MAX, CHECKLIST_MAX]);
  });
  it('same words', () => {
    const w = readWeb(FIELD) + readWeb(FORM);
    const { full, ...rest } = CHECKLIST_TEXT;
    for (const t of [...Object.values(rest), 'Checklist item ', 'from the checklist']) expect(w, t).toContain(t);
    // The website writes its limit into the words: `A checklist holds up to ${CHECKLIST_MAX} items`.
    expect(readWeb(FIELD)).toContain('`A checklist holds up to ${CHECKLIST_MAX} items`');
    expect(full).toBe(`A checklist holds up to ${CHECKLIST_MAX} items`);
    expect(readWeb(FIELD)).toContain('aria-label={`Remove “${row.text || `item ${i + 1}`}” from the checklist`}');
  });
});
it('at most 100 items of 191 characters', () => {
  expect(checklistTexts([], 'w'.repeat(300))[0]).toHaveLength(191);
  expect(checklistTexts(checklistRows(Array.from({ length: 120 }, (_, i) => `i${i}`)))).toHaveLength(100);
});
it('rows keep their own key; the items’ names say which', () => {
  const [a, b] = [newChecklistRow('x'), newChecklistRow('x')];
  expect(a.id).not.toBe(b.id);
  expect(checklistItemLabel(3)).toBe('Checklist item 3');
  expect(checklistRemoveLabel('Pump check', 1)).toBe('Remove “Pump check” from the checklist');
  expect(checklistRemoveLabel('', 2)).toBe('Remove “item 2” from the checklist');
});
