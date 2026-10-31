import { it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

/** Stage 3 Task 5: the Workload screen — one card per person (the website has no phone layout here; spec §7). */
it('every number on a card is the server’s (Review Focus 5)', () => {
  const s = src('components/workload/PersonCard.tsx');
  expect(s).toMatch(/cell\.limit === 0 && cell\.count === 0 \? 'Off' : cell\.count/); expect(s).toMatch(/person\.overdue/); expect(s).toMatch(/weekBar\(person\)/);
  expect(s).not.toMatch(/tasks\.length|isTaskLate|isOverdue|\.reduce\(/); expect(s).toMatch(/accessibilityLabel=\{cellLabel\(person\.name, cell\)\}/);
});
it('a day lists what the website lists and offers the server’s suggestion', () => {
  const s = src('components/workload/DaySheet.tsx');
  expect(s).toMatch(/popoverTasks\(cell\)/); expect(s).toMatch(/suggestionText\(task\.suggestion, week\)/); expect(s).toMatch(/cell\.over > 0[^]*No room nearby/); expect(s).toContain('Nothing due.');
});
it('the day sheet for TalkBack: a task’s key and title are one stop; a suggestion being saved says “Saving…” (final review P6)', () => {
  const s = src('components/workload/DaySheet.tsx');
  // The key sits inside the task's button, so the button's name (key and title) is read once.
  expect(s).toMatch(/<Pressable[^]*?accessibilityLabel=\{`\$\{task\.key\} \$\{task\.title\}`\}[^]*?>\s*<View style=\{s\.keyBox\}>/);
  expect(s.match(/s\.keyBox/g)).toHaveLength(1);
  expect(s).toMatch(/const saving = busyTaskId === task\.id;/);
  expect(s).toMatch(/accessibilityLabel=\{saving \? 'Saving…' : suggestionLabel\(task\.suggestion, task\.key\)\}/);
  // And it is said as it starts: the sheet's polite line speaks it until the result replaces it.
  expect(s).toMatch(/accessibilityLiveRegion="polite" accessibilityLabel=\{busyTaskId && !notice \? 'Saving…' : undefined\}/);
});
it('only an administrator gets the daily-limit picker; everyone else sees the number', () => { const s = src('screens/WorkloadScreen.tsx'); expect(s).toMatch(/data\.canChangeLimit \?[^]*limitOptions\(/); expect(s).toContain('Set by an administrator'); });
it('the week starts on your week start and the problem is said aloud', () => { const s = src('screens/WorkloadScreen.tsx'); expect(s).toMatch(/weekDays\(today, weekStart\)\[0\]/); expect(s).toMatch(/accessibilityLiveRegion="polite"/); expect(s).not.toMatch(/openWebsitePage/); });
it('the card, the day and the page use the website’s words, colours and states', () => {
  const card = src('components/workload/PersonCard.tsx'), sheet = src('components/workload/DaySheet.tsx'), page = src('screens/WorkloadScreen.tsx');
  expect(card).toMatch(/<Avatar[^>]*size="md"/); expect(card).toMatch(/<ProgressBar[^>]*value=\{bar\.pct\}[^>]*color=\{weekBarColor\(c, bar\.tone\)\}/); expect(card).toMatch(/cellLook\(c, /); expect(card).toMatch(/dayHeading\(cell\.date, today\)/);
  expect(sheet).toMatch(/popoverTitle\(person\.name, cell\.date\)/); expect(sheet).toMatch(/popoverSub\(cell\)/); expect(sheet).toMatch(/suggestionLabel\(task\.suggestion, task\.key\)/); expect(sheet).toContain('Saving…');
  expect(sheet).toMatch(/navigate\('TaskDetail'/); expect(sheet).toMatch(/`\+ \$\{more\} more`/);
  for (const w of ['Open in My Tasks', 'Open in Calendar']) expect(sheet).toContain(w);
  for (const w of ['Open tasks due each day, per person.', 'Previous week', 'Next week', 'Back to this week', 'Find a person…', 'Daily limit', 'Open tasks a person may have due on one working day — for everyone', 'Couldn’t load the workload.', 'Nobody to show for this week.', 'Nobody matches “', 'none', 'below the limit', 'at the limit', '! over the limit', 'not a working day (Meeting hours)', 'due on a day off', 'Project', 'All'])
    expect(page, w).toContain(w);
  expect(page).toMatch(/summaryLine\(people, week === thisWeek\)/); expect(page).toMatch(/scopeLead\(data\.scope\)/); expect(page).toMatch(/footerLine\(data\.scope\)/); expect(page).toMatch(/weekLabel\(week, today\)/);
  expect(page).toMatch(/filterPeople\(people, q\)/); expect(page).toMatch(/sortPeople\(/);
  if (hasWeb('frontend/src/pages/WorkloadPage.tsx', 'frontend/src/components/workload/WorkloadPopover.tsx')) {
    const web = readWeb('frontend/src/pages/WorkloadPage.tsx');
    for (const w of ['Open tasks due each day, per person.', 'Previous week', 'Next week', 'Back to this week', 'Find a person…', 'Open tasks a person may have due on one working day — for everyone', 'Set by an administrator', 'Nobody to show for this week.', 'Nobody matches “', 'below the limit', 'at the limit', '! over the limit', 'not a working day (Meeting hours)', 'due on a day off'])
      expect(web, w).toContain(w);
    const pop = readWeb('frontend/src/components/workload/WorkloadPopover.tsx');
    for (const w of ['Nothing due.', 'No room nearby', 'Saving…', 'Open in My Tasks', 'Open in Calendar', '`+ ${more} more`']) expect(pop, w).toContain(w);
  }
});
