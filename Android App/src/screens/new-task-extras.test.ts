import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

// Stage 2 Task 6: New task's template picker, checklist and due-today note (the website's TaskFormDialog).
it('templates, the checklist and the due-today note are for new tasks only', () => {
  const s = src('screens/NewTaskScreen.tsx');
  for (const m of [/!editing && [^\n]*<TemplatePicker/, /!editing \? <ChecklistField/, /note=\{autoDue \? defaultDueNote\(autoDue, today\) : undefined\}/]) expect(s).toMatch(m);
  expect(s).toMatch(/const autoDue = editing \? null : defaultDueDay\(project, draft\.dueDate, params\.boardDate, today\)/);
  expect(s).toMatch(/useTaskTemplates\(!editing\)/);
  expect(s).toMatch(/templateFilledText\(usedTemplate\.name\)/);
});
it('the website’s order: a template first, then Describe; the checklist right after the description', () => {
  const s = src('screens/NewTaskScreen.tsx');
  expect(s.indexOf('<TemplatePicker')).toBeLessThan(s.indexOf('<DescribeTask'));
  expect(s.indexOf('<ChecklistField')).toBeGreaterThan(s.indexOf('label="Description (optional)"'));
  expect(s.indexOf('<ChecklistField')).toBeLessThan(s.indexOf('label="Priority"'));
});
it('the task templates are read through the person’s offline copy', () =>
  expect(src('core/template-queries.ts')).toMatch(/queryKey: TASK_TEMPLATES_KEY[^]*reads\.read\(queryKey, 'templates\.tasks', \(\) => resources\.templates\.listTasks\(\)\)[^]*enabled/));
it('the checklist field: each item named, removable, an emptied one leaves; the add box adds on return, on leaving, and line by line', () => {
  const s = src('components/task-form/ChecklistField.tsx');
  expect(s).toMatch(/accessibilityLabel=\{checklistItemLabel\(i \+ 1\)\}/);
  expect(s).toMatch(/icon="ui\.close"[^>]*label=\{checklistRemoveLabel\(row\.text, i \+ 1\)\}/);
  expect(s).toMatch(/onBlur=\{\(\) => \{\s*if \(!row\.text\.trim\(\)\)/);
  expect(s).toMatch(/onSubmitEditing=\{\(\) => add\(pending\)\}/);
  expect(s).toMatch(/maxLength=\{CHECKLIST_ITEM_MAX \* 20\}/);
  expect(s).toMatch(/placeholder=\{full \? CHECKLIST_TEXT\.full : CHECKLIST_TEXT\.placeholder\}/);
  expect(s).toMatch(/\/\\n\/\.test\(text\)/);
});
it('the template picker lists each template with its checklist size', () => {
  const s = src('components/task-form/TemplatePicker.tsx');
  expect(s).toMatch(/<InlinePicker[^]*label=\{TEMPLATE_TEXT\.label\}[^]*placeholder=\{TEMPLATE_TEXT\.placeholder\}/);
  expect(s).toMatch(/\{ value: t\.id, label: t\.name, hint: templateHint\(t\) \}/);
});
it('the due date can carry a note, said with the field', () => {
  const s = src('components/task-form/DueDateField.tsx');
  expect(s).toMatch(/note\?: string/); expect(s).toMatch(/\{note \? \(?\s*<Text/);
});
