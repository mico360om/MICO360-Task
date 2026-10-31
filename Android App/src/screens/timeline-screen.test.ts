import { it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

/** Stage 3 Task 3: the Timeline screen, as the website's phone layout (frontend/src/pages/TimelinePage.tsx PhoneList). */
it('rows show the server’s numbers: progress and health as sent, tasks’ overdue as sent (Review Focus 5)', () => {
  const row = src('components/timeline/TimelineRow.tsx'), tasks = src('components/timeline/TimelineTasks.tsx');
  expect(row).toMatch(/timelineRow\(project, today\)/); expect(row).toMatch(/<ProgressBar[^>]*value=\{row\.progress\}/);
  expect(row).not.toMatch(/tasks\.done|tasks\.total/); expect(tasks).toMatch(/phoneTaskParts\(task, /); expect(tasks).not.toMatch(/isTaskLate|isOverdue|dueDayKey|< today/);
});
it('two cards to a row only while every card’s label fits: Stage 1’s statTileColumns, measuring the labels shown', () => {
  const s = src('screens/TimelineScreen.tsx');
  const call = /statTileColumns\(\[([^\]]*)\], width, fontScale\)/.exec(s);
  expect(call, 'statTileColumns([…labels], width, fontScale)').not.toBeNull();
  const measured = [...call![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const shown = [...s.matchAll(/<StatTile[^>]*?\blabel="([^"]+)"/g)].map((m) => m[1]);
  expect(measured).toEqual(shown);
  expect(s).toMatch(/cols === 2 \? s\.tileHalf : s\.tileFull/);
  expect(s).not.toMatch(/TWO_TILES_FROM/);
});
it('the five cards are the website’s; Late and At risk narrow the list', () => {
  const s = src('screens/TimelineScreen.tsx');
  for (const w of ['Open projects', 'Late · target passed', 'At risk', 'Milestones in 30 days', 'Meetings this week']) expect(s).toContain(w);
  expect(s).toMatch(/selected=\{state\.show === 'late'\}/); expect(s).toMatch(/selected=\{state\.show === 'at-risk'\}/);
  if (hasWeb('frontend/src/pages/TimelinePage.tsx')) for (const w of ['Late · target passed', 'Milestones in 30 days', 'Show only these projects', 'Show every project again']) expect(readWeb('frontend/src/pages/TimelinePage.tsx')).toContain(w);
});
it('the weeks follow your week start and the company day', () => expect(src('screens/TimelineScreen.tsx')).toMatch(/weekDays\(today, weekStart\)\[0\]/));
it('a project row opens the project and its tasks open the task', () => { expect(src('components/timeline/TimelineRow.tsx')).toMatch(/navigate\('ProjectDetail'/); expect(src('components/timeline/TimelineTasks.tsx')).toMatch(/navigate\('TaskDetail'/); });
it('no website fallback is left', () => expect(src('screens/TimelineScreen.tsx')).not.toMatch(/openWebsitePage/));
it('a tile that filters says whether it is on, with a brand border while it is', () => {
  const tile = src('components/ui/StatTile.tsx');
  expect(tile).toMatch(/selected\?: boolean/); expect(tile).toMatch(/accessibilityState=\{\{ selected/); expect(tile).toMatch(/selected \? \{[^}]*borderColor: c\.brand/);
});
it('the page’s own words, states and the tasks’ words are the website’s', () => {
  const s = src('screens/TimelineScreen.tsx'), tasks = src('components/timeline/TimelineTasks.tsx'), row = src('components/timeline/TimelineRow.tsx');
  for (const w of ['No open projects', 'Projects that are not completed or archived appear here, along their dates.', 'Go to Projects', 'No late projects', 'No projects at risk', 'No projects for this owner', 'Show every project', 'Couldn’t load the timeline.', 'Anyone']) expect(s).toContain(w);
  expect(s).toMatch(/accessibilityLiveRegion="polite"/); expect(s).toMatch(/periodText\(data\.from, data\.to\)/);
  for (const w of ['Loading tasks…', 'Couldn’t load these tasks.', 'Try again', ', assigned to ']) expect(tasks).toContain(w);
  expect(tasks).toMatch(/tasksFooter\(/); expect(tasks).toMatch(/<Avatar[^>]*size="sm"/);
  expect(row).toMatch(/accessibilityLabel=\{`Tasks of \$\{project\.name\}`\}/); expect(row).toMatch(/accessibilityState=\{\{ expanded/); expect(row).toMatch(/misc\.milestone/);
  if (hasWeb('frontend/src/pages/TimelinePage.tsx', 'frontend/src/components/timeline/TimelineTasks.tsx')) {
    const page = readWeb('frontend/src/pages/TimelinePage.tsx');
    for (const w of ['No open projects', 'Projects that are not completed or archived appear here, along their dates.', 'Go to Projects', 'No late projects', 'No projects at risk', 'No projects for this owner', 'Show every project', 'Anyone']) expect(page).toContain(w);
    for (const w of ['Loading tasks…', 'Couldn’t load these tasks.', 'Try again', ', assigned to ']) expect(readWeb('frontend/src/components/timeline/TimelineTasks.tsx') + readWeb('frontend/src/components/timeline/parts.tsx')).toContain(w);
  }
});
