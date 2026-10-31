import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** Stage 4's final review, part S (lane S): each fix pinned where it lives in the screens' source. */

it('S1: a task whose form changed re-reads its details, and the card never starts the old form', () => {
  const card = src('components/inspections/TaskInspectionsCard.tsx');
  expect(card).toMatch(/checkFormOf\(task, formsQ\.data\?\.forms\)/);
  expect(card).not.toMatch(/task\.inspectionForm \?\? null/);
});
