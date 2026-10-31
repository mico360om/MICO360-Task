import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** New project from a template (Stage 4 Task 14): the screen's wiring, read from its source. */
it('a new project can start from a template, through the template’s endpoint', () => {
  const s = src('screens/ProjectFormScreen.tsx');
  expect(s).toMatch(/<TemplateStartField/);
  expect(s).toMatch(/create: \(input, key\) => resources\.templates\.createProject\(choice\.id, \{ \.\.\.input, startDate: choice\.startDate, roles: choice\.roles, expectedUpdatedAt: plan\.template\.updatedAt \}, key\)/);
  expect(s).toMatch(/!editing[^]*<TemplateStartField/); // new projects only
});

it('a changed or deleted template says so in the website’s words', () => {
  const s = src('screens/ProjectFormScreen.tsx');
  // The 404 / 409 TEMPLATE_CHANGED rule is lib/template-words' templateCreateProblem (templates.test.ts),
  // read before saveProject's "code taken" (a 409 too) could claim it.
  expect(s).toMatch(/templateCreateProblem\(refused\)[^]*setBanner\(templateProblem\.message\)/);
  expect(src('lib/template-words.ts')).toContain("'TEMPLATE_CHANGED'");
  expect(src('lib/template-words.ts')).toContain('TEMPLATE_START_WORDS.gone');
  expect(s).toMatch(/keepRoles\(/);
  expect(s).toContain('TEMPLATE_START_WORDS.noWholeDate');
});

it('only active people can fill a role', () => expect(src('lib/template-choice.ts')).toMatch(/active !== false/));

it('the field: the website’s order and words, its plan through the template queries', () => {
  const f = src('components/templates/TemplateStartField.tsx');
  for (const w of ['TEMPLATE_START_WORDS.heading', 'TEMPLATE_START_WORDS.startDate', 'TEMPLATE_START_WORDS.whoFills', 'TEMPLATE_START_WORDS.rolesNote', 'TEMPLATE_START_WORDS.planFailed', 'TEMPLATE_START_WORDS.tasksList', 'daysOffNote(', 'planSummary(', 'overdueWarning(', 'planTaskDue(', 'planTaskWho(']) expect(f, w).toContain(w);
  expect(f).toMatch(/TEMPLATE_START_WORDS\.personFor\.replace\('\{role\}', /);
  const q = src('core/template-queries.ts');
  expect(q).toMatch(/queryKey: PROJECT_TEMPLATES_KEY/);
  expect(q).toMatch(/queryKey: \['templates', 'projects', choice\?\.id, 'plan', choice\?\.startDate\]/);
  expect(q).toMatch(/placeholderData: keepPreviousData/);
});
