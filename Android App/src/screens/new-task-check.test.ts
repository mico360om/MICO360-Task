import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** New and Edit task carry a check's form and place (Stage 4 Task 20), read from the screen's source. */
it('the form offers an inspection form (with its note) and, once one is chosen, its place', () => {
  const s = src('screens/NewTaskScreen.tsx');
  expect(s).toMatch(/options=\{inspectionFormOptions\(forms, editTask\?\.inspectionForm\)\}/);
  expect(s).toMatch(/inspectionFormNote\(!!draft\.inspectionFormId\)/);
  expect(s).toMatch(/draft\.inspectionFormId \? \(\s*<TextField\s+label=\{TASK_CHECK_WORDS\.place\}[^]*?maxLength=\{INSPECTION_LIMITS\.placeMax\}/);
  // The website's order: after the checklist, before the priority.
  expect(s.indexOf('inspectionFormOptions(')).toBeGreaterThan(s.indexOf('<ChecklistField'));
  expect(s.indexOf('inspectionFormOptions(')).toBeLessThan(s.indexOf('label="Priority"'));
});

it('a repeating check makes its checks on schedule, and its repeat editor counts checks (keeping “No repeat”)', () => {
  const s = src('screens/NewTaskScreen.tsx');
  expect(s).toMatch(/setDraft\(\(d\) => asCheck\(\{ \.\.\.d, \.\.\.patch \}\)\)/);
  expect(s).toMatch(/kind=\{draft\.inspectionFormId \? 'check' : 'task'\}/);
  expect(s).toMatch(/allowNone/);
  expect(src('components/RecurrenceEditor.tsx')).toMatch(/check && !allowNone \? null : chip\('NONE'/);
});

it('a too-long place is said under the place, in New and Edit task', () => {
  const s = src('screens/NewTaskScreen.tsx');
  expect(s.match(/check\.field === 'inspection'\) setPlaceError\(check\.message\)/g)).toHaveLength(2);
  expect(s).toMatch(/error=\{placeError\}/);
});
