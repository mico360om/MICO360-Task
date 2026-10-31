import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

// Stage 2 Task 7: moving tasks to another project (the website's MoveTaskDialog and its menus).
it('Review Focus 3: one question for the group: a single CardChoice on preview.outsiders', () => {
  const s = src('components/move/MoveTaskSheet.tsx');
  expect(s.match(/<CardChoice/g)).toHaveLength(1); expect(s).toMatch(/notOnTeamText\(preview\.outsiders/); expect(s).toMatch(/assigneeChoiceLabels\(preview\.outsiders\)/);
});
it('Review Focus 3: no answer stops the move; the server’s 409 asks again with a fresh preview', () => {
  const s = src('components/move/MoveTaskSheet.tsx');
  expect(s).toMatch(/moveInput\(\{/); expect(s).toMatch(/'problem' in input/);
  expect(s).toMatch(/rerunPreview\) \{[^]*setChoice\(''\)[^]*previewQ\.refetch\(\)/);
});
it('a move goes now, never kept for later', () => {
  const s = src('core/move-queries.ts');
  expect(s).not.toMatch(/sendInOrder|queueOnOffline|itemLanes/); expect(s).toMatch(/owned\(services\)/); expect(s).toMatch(/afterTaskMoved\(qc, /);
});
it('offered where the website offers it', () => {
  expect(src('components/task-detail/HeaderCard.tsx')).toMatch(/MOVE_TEXT\.menuItem[^]*move\.reason/);
  for (const f of ['screens/BoardScreen.tsx', 'screens/AllBoardScreen.tsx']) expect(src(f), f).toMatch(/onMoveToProject=\{[^}]*canMove/);
  for (const f of ['components/board/MoveCardSheet.tsx', 'components/board/StatusMoveSheet.tsx']) expect(src(f), f).toMatch(/onMoveToProject \? <MoveOption[^>]*label=\{MOVE_TEXT\.menuItem\}/);
  const my = src('screens/MyTasksScreen.tsx');
  expect(my).toMatch(/bulkMoveAvailability\(/); expect(my).toMatch(/MOVE_TEXT\.bulkButton/); expect(my).toMatch(/notice\(bulkMovedText\(/);
});
it('the task screen offers it with the reason, stays on the task and says where it went', () => {
  const s = src('screens/TaskDetailScreen.tsx');
  expect(s).toMatch(/moveAvailability\(task\.projectId, moveTargets, projectQ\.data\?\.name\)/);
  expect(s).toMatch(/notice\(movedText\(/); expect(s).toMatch(/<MoveTaskSheet/);
});

it('final review A1: a move goes in the task’s lane (several: every task’s), noting the version it made', () => {
  const s = src('core/move-queries.ts');
  expect(s).toMatch(/liveTaskWrite\(taskWrites, id, undefined, [^]*\(result\) => result\.task\?\.version\)/);
  expect(s).toMatch(/inTaskLanes\(taskWrites, ids, /);
  expect(s).toMatch(/if \(item\.ok\) taskWrites\.note\(item\.taskId, item\.task\?\.version\)/);
});

it('final review A4: the sheet shows the tasks it was opened for until it has closed', () => {
  const s = src('components/move/MoveTaskSheet.tsx');
  expect(s).toMatch(/const held = useRef<MoveTaskRef\[\]>\(given\);\s*if \(given\.length > 0\) held\.current = given;\s*const tasks = sheetTasks\(given, held\.current\);/);
});

it('final review A5: tapping Move without the team answer says so by the buttons, where it is always seen', () => {
  const s = src('components/move/MoveTaskSheet.tsx');
  expect(s).toMatch(/footer=\{\s*<View style=\{s\.footer\}>\s*\{choiceError \? <SheetMessage text=\{MOVE_TEXT\.chooseTeam\} \/> : null\}\s*<View style=\{s\.footerRow\}>\s*<SheetButtons/);
  expect(s.match(/MOVE_TEXT\.chooseTeam/g)).toHaveLength(1); // said once: by the buttons, not under the question scrolled out of view
});

it('final review A6: a choice card says a hint only when it has one; the team answers have none', () => {
  const kit = src('components/meeting/sheet-kit.tsx');
  expect(kit).toMatch(/options: \{ value: T; label: string; hint\?: string; disabled\?: boolean \}\[\]/);
  expect(kit).toMatch(/accessibilityLabel=\{o\.hint \? `\$\{o\.label\}\. \$\{o\.hint\}` : o\.label\}/);
  expect(kit).toMatch(/\{o\.hint \? <Text style=\{s\.cardHint\}>\{o\.hint\}<\/Text> : null\}/);
  const sheet = src('components/move/MoveTaskSheet.tsx');
  expect(sheet).not.toMatch(/hint: ''/);
  expect(sheet).toMatch(/\{ value: 'ADD_TO_TEAM', label: labels\.add \}/);
});

it('final review A8: "What will change", "Can’t be moved" and "Couldn’t be moved" are headings TalkBack reads before their lists', () => {
  const s = src('components/move/MoveTaskSheet.tsx');
  for (const k of ['changes', 'cantMove', 'notMoved']) expect(s, k).toMatch(new RegExp(`<Text style=\\{s\\.heading\\} accessibilityRole="header">\\s*\\{MOVE_TEXT\\.${k}\\}\\s*</Text>\\s*\\{lines\\(`));
  expect(s).not.toMatch(/<FieldLabel>\{MOVE_TEXT\.(changes|cantMove|notMoved)\}/);
});
