/**
 * Management's sections (Stage 3 Task 8): project health, approvals, inspections and people — every
 * figure the server's (Review Focus 5), each opening its list, in the website's words.
 */
import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

it('every figure shown is the server’s, and each opens its list', () => {
  const h = src('components/management/HealthSection.tsx');
  expect(h).toMatch(/row\.completionPct/); expect(h).toMatch(/reasonQuery\(reason\.code, row\.id\)/); expect(h).not.toMatch(/row\.done \/|\/ row\.total/);
  expect(src('components/management/ApprovalsSection.tsx')).toMatch(/metric: 'awaiting-approval'/);
  expect(src('components/management/PeopleSection.tsx')).toMatch(/metric: 'person-overloaded', personId: p\.id/);
});
it('health: the bar is the server’s percentage, rows in the chosen order, names and milestones opening their screens', () => {
  const h = src('components/management/HealthSection.tsx');
  expect(h).toMatch(/<ProgressBar value=\{row\.completionPct\}/);
  expect(h).toMatch(/sortHealth\(rows, sort\)/);
  expect(h).toMatch(/HEALTH_SORTS/);
  expect(h).toMatch(/rows\.length > 1/);
  expect(h).toMatch(/milestoneText\(m\)/); expect(h).toMatch(/idleText\(row\.lastActivityAt, today, timeZone\)/);
  expect(h).toMatch(/kind: 'project'/); expect(h).toMatch(/kind: 'task', id: m\.id/);
  expect(h).toMatch(/metric: 'late-milestones', projectId: row\.id/);
  expect(h).toMatch(/!m\.waiting && m\.daysLeft !== null && m\.daysLeft < 0/);
});
it('inspections and people show the server’s numbers; nothing is added up on the phone', () => {
  const i = src('components/management/InspectionsSection.tsx'), p = src('components/management/PeopleSection.tsx');
  expect(i).toMatch(/inspectionFigures\(data\)/);
  expect(i).toMatch(/metric: 'failed-item'/); expect(i).toMatch(/metric: 'failed-form', formId/); expect(i).toMatch(/metric: 'inspections', formId, failed: true/);
  expect(p).toMatch(/overloadedDaysText\(p\.overloadedDays\)/); expect(p).toMatch(/metric: 'overdue-actions', personId: p\.id/); expect(p).toMatch(/metric: 'person-actions', personId: p\.id/); expect(p).toMatch(/metric: 'late-tasks', personId: p\.id/);
  for (const f of ['HealthSection', 'ApprovalsSection', 'InspectionsSection', 'PeopleSection']) expect(src(`components/management/${f}.tsx`), f).not.toMatch(/\.reduce\(|isTaskLate|isOverdue/);
});
it('a number at 0 is plain text; any other opens its list, named for TalkBack', () => {
  const parts = src('components/management/parts.tsx');
  expect(parts).toMatch(/if \(!query\)/);
  expect(parts).toMatch(/accessibilityLabel=\{`\$\{label\}: show the list`\}/);
  expect(parts).toMatch(/onOpen\(query, label\)/);
});
it('the screen draws the four sections, approvals only when the server sends them', () => {
  const s = src('screens/ManagementScreen.tsx');
  expect(s).toMatch(/<HealthSection\s+rows=\{data\.projects\}/);
  expect(s).toMatch(/data\.approvals \? <ApprovalsSection approvals=\{data\.approvals\}/);
  expect(s).toMatch(/<InspectionsSection data=\{data\.inspections\}/);
  expect(s).toMatch(/<PeopleSection people=\{data\.people\} week=\{data\.workload\.week\} limit=\{data\.workload\.limit\}/);
  expect(s).toMatch(/onOpen=\{openList\}/);
});
it('“Inspection forms” opens the website’s Templates, which stays a website page', () => expect(src('components/management/InspectionsSection.tsx')).toMatch(/openWebsitePage\(baseUrl, '\/templates'\)/));
describe.skipIf(!hasWeb('frontend/src/components/management/HealthSection.tsx', 'frontend/src/components/management/PeopleSection.tsx', 'frontend/src/components/management/ApprovalsSection.tsx', 'frontend/src/components/management/InspectionsSection.tsx'))('the website’s words', () => {
  it('section notes and empty states', () => {
    for (const [file, words] of [['HealthSection', ['No projects yet', 'No projects to show']], ['ApprovalsSection', ['Nothing is waiting', 'No task in these projects is waiting for approval.']], ['InspectionsSection', ['Most-failed items', 'Forms with the most failed items', 'No item failed in this period.']], ['PeopleSection', ['Nobody is behind']]] as const)
      for (const w of words) { expect(src(`components/management/${file}.tsx`), w).toContain(w); expect(readWeb(`frontend/src/components/management/${file}.tsx`), w).toContain(w); }
  });
  it('every title, note, label and empty text the sections share with the website', () => {
    const shared: Record<string, string[]> = {
      HealthSection: [
        'Project health',
        'Red: a milestone is late, a quarter or more of the open tasks are late (at least 3), or 3 or more checks are missing. Amber: any late task or missing check, or an active project with no change for 14 days.',
        'Each project’s health shows here once there is one: its late tasks, milestones and checks.',
        'Go to Projects',
        'The projects you chose have a status the filter leaves out. Tick their status, or clear the filters.',
        'No project matches these filters. Choose other statuses or projects, or clear the filters.',
        'Late tasks', 'Missing checks', 'Next milestone', 'Last activity', 'Done',
        "'late task')} in ${", "'missing check')} in ${", '`Late milestones in ${row.name}`',
      ],
      ApprovalsSection: ['Waiting for approval', 'Tasks finished but not approved yet by whoever runs the project. They don’t count as done until then.', 'In all:', "'task') + ' waiting for approval'", "waiting for approval in ${p.name}`"],
      InspectionsSection: [
        'Checks are tasks that carry an inspection form. Due, done and the pass rate cover the chosen period; missing checks and follow-ups are now.',
        'No inspections yet',
        'Checks due and inspections finished in this period show here. Start with a form in Templates, then schedule checks from a project’s Inspections tab.',
        'Inspection forms',
        'No form had a failed item in this period.',
        "'failed item' : 'failed items'", "'inspection had' : 'inspections had'", 'a failure', "failed ${plural(i.failures, 'time')}`",
      ],
      PeopleSection: [
        'People and workload',
        'Nobody has late work, an overloaded day or open action items in these projects.',
        '`This week from ${shortDay(week)}. Overloaded: more than ${limit} open tasks due on a working day (the Workload limit).`',
        'Late tasks', 'Overloaded days', 'Action items', '`${p.overdueActions} overdue`', "'late task')}`", "'day')} over the limit this week`", "'open action item')}`", "'overdue action item')}`",
      ],
    };
    for (const [file, words] of Object.entries(shared))
      for (const w of words) { expect(src(`components/management/${file}.tsx`), `${file}: ${w}`).toContain(w); expect(readWeb(`frontend/src/components/management/${file}.tsx`), `${file}: ${w}`).toContain(w); }
  });
});

it('trends: each chart or its quiet words, then the weeks table; drawn last on the screen', () => {
  const t = src('components/management/TrendsSection.tsx');
  expect(t).toMatch(/trendCharts\(weeks\)/);
  expect(t).toMatch(/chart\.empty \?/);
  expect(t).toMatch(/<LineChart[^>]*unit=\{chart\.unit\}/);
  expect(t).toMatch(/trendTableRows\(weeks, all\)/);
  expect(t).toMatch(/trendToggleText\(weeks\.length, all\)/);
  expect(t).toMatch(/weeks\.length > 6/);
  expect(t).toMatch(/w\.passRate === null \? '—' : `\$\{w\.passRate\}%`/);
  for (const w of ['Week of', 'Created', 'Completed', 'Late', 'Pass rate', 'Trends']) expect(t, w).toContain(w);
  expect(t).not.toMatch(/\.reduce\(/);
  const s = src('screens/ManagementScreen.tsx');
  expect(s).toMatch(/<PeopleSection[^]*<TrendsSection weeks=\{data\.trends\} \/>/);
});
