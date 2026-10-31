import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';
import { roleCounts } from '../lib/role-counts';

/** Save a project or a task as a template (Stage 4 Task 16), read from the screens' source. */
it('Save as template is offered to the people who run the project, as on the website', () => {
  expect(src('screens/ProjectDetailScreen.tsx')).toMatch(/canManageProject\(user, project, members\)[^]*title="Save as template"/);
  expect(src('components/task-detail/HeaderCard.tsx')).toMatch(/canSaveTemplate[^]*'Save as template…'/);
  expect(src('screens/TaskDetailScreen.tsx')).toMatch(/canSaveTemplate=\{canDeleteTask\(user, project, members\)\}/);
});

it('the role a task gets follows the website’s rule', () => {
  const c = roleCounts([['u1', 'u2'], ['u2'], []], ['u1', 'u2'], { u2: 'Inspector' });
  expect(c.roles).toEqual([{ name: 'Inspector', tasks: 2 }]);
  expect(c.unassigned).toBe(1);
});

it('after saving, Templates opens on the website', () => {
  expect(src('components/templates/SaveProjectTemplateSheet.tsx')).toMatch(/openWebsitePage\([^)]*'\/templates'\)/);
  expect(src('components/templates/SaveTaskTemplateSheet.tsx')).toMatch(/openWebsitePage\([^)]*'\/templates\?tab=tasks'\)/);
});

it('the project sheet can’t save what the server would refuse, and names each person’s role as the server will', () => {
  const p = src('components/templates/SaveProjectTemplateSheet.tsx');
  expect(p).toMatch(/disabled=\{!d \|\| !!blocked\}/);
  expect(p).toMatch(/roleCounts\(/);
  expect(p).toMatch(/personRoleNote\(/);
  expect(p).toMatch(/accessibilityLabel=\{W\.roleFor\.replace\('\{name\}', who\)\}/);
  expect(p).toMatch(/<Toggle[^>]*label=\{W\.includeDescriptions\}/);
});

it('each save sends one key per opening of its sheet, and the template lists refresh after', () => {
  const q = src('core/template-queries.ts');
  expect(q).toMatch(/useSaveProjectTemplate[^]*saveProject\(projectId, input, key\)[^]*invalidateQueries\(\{ queryKey: PROJECT_TEMPLATES_KEY \}\)/);
  expect(q).toMatch(/useSaveTaskTemplate[^]*saveTask\(taskId, input, key\)[^]*invalidateQueries\(\{ queryKey: TASK_TEMPLATES_KEY \}\)/);
  expect(q).toMatch(/queryKey: \['templates', 'from-project', projectId\]/);
  for (const f of ['components/templates/SaveProjectTemplateSheet.tsx', 'components/templates/SaveTaskTemplateSheet.tsx']) expect(src(f), f).toMatch(/useRef\(newIdempotencyKey\(\)\)/);
});
