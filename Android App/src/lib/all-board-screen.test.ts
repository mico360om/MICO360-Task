import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = (p: string) => resolve(__dirname, '..', p);
const src = (p: string) => (existsSync(path(p)) ? readFileSync(path(p), 'utf8') : '');

describe('the All projects board screen (4c)', () => {
  const screen = src('screens/AllBoardScreen.tsx');

  it('exists, and is registered and reachable from the Projects tab (with more than one project, as on the website)', () => {
    expect(screen).not.toBe('');
    expect(src('navigation/types.ts')).toMatch(/AllBoard: undefined;/);
    expect(src('navigation/RootNavigator.tsx')).toMatch(/name="AllBoard" component=\{AllBoardScreen\} options=\{\{ title: ALL_PROJECTS_TEXT\.title \}\}/);
    const projects = src('screens/ProjectsScreen.tsx');
    expect(projects).toMatch(/boardProjects\(list\)\.length > 1 \?/);
    expect(projects).toMatch(/navigation\.navigate\('AllBoard'\)/);
  });

  it('shows every shown project’s tasks for the day under the six statuses, as virtualized lists', () => {
    expect(screen).toMatch(/useAllProjectsTasks\(boardDate\)/);
    expect(screen).toMatch(/composeAllProjectsBoard\(tasksQ\.data \?\? \[\], projects, \{ hidden \}\)/);
    expect(screen).toMatch(/<FlatList\s+horizontal\s+data=\{board\}/);
    expect(screen).not.toMatch(/ScrollView/);
    expect(screen).toMatch(/<BoardColumnView/);
  });

  it('each card is the board’s card with its project, in its status’s colour', () => {
    expect(screen).toMatch(/allBoardCard\(t\.task, item\.status, t\.project, color\)/);
    expect(screen).toMatch(/const color = categoryColorOf\(c, item\.status\)/);
    const card = src('components/board/BoardCard.tsx');
    expect(card).toMatch(/\{card\.project \? \(/);
    expect(card).toMatch(/<ProjectAvatar project=\{card\.project\} size="xs" \/>/);
  });

  it('a card changes status in its own project through the task write path; cards keep their order (no reordering)', () => {
    expect(screen).toMatch(/<StatusMoveSheet/);
    expect(screen).toMatch(/statusMove\(/);
    expect(screen).toMatch(/canStepUp=\{false\}|steps=\{false\}/);
    const core = src('core/all-board-queries.ts');
    expect(core).toMatch(/sendTaskMove\(services, \{ id: task\.id, columnId, projectId: task\.projectId, category: status \}\)/);
    expect(core).toMatch(/statusMovePlan\(task, status, columns, projectName\)/);
    expect(core).toMatch(/withStatus\(list, task\.id, columnId, status\)/);
    // The project board's moves go the same way (one write path).
    expect(src('core/queries.ts')).toMatch(/mutationFn: \(\{ id, columnId, position, at \}[^\n]*\n\s*sendTaskMove\(services,/);
  });

  it('is kept offline per day (among the board days), with the moves still waiting laid over it', () => {
    expect(src('core/all-board-queries.ts')).toMatch(/reads\.readBoard\(queryKey, allTasksCopyKey\(boardDate\), \(\) => resources\.tasks\.list\(\{ boardDate \}\)/);
  });

  it('is live: one connection for every project it shows, while it is in view (caught up when back)', () => {
    expect(screen).toMatch(/useAllBoardRealtime\(focused \? liveRooms : undefined\)/);
    const hook = src('core/useBoardRealtime.ts');
    expect(hook).toMatch(/export function useAllBoardRealtime/);
    expect(hook).toMatch(/for \(const id of ids\) s\.emit\('join', \{ projectId: id \}\)/);
    expect(hook).toMatch(/allBoardEventRefreshes\(ev, payload\)/);
    expect(hook).toMatch(/later\(allBoardRefreshes\(\)\)/);
  });

  it('chooses its projects with “Projects:”, remembered per person', () => {
    expect(screen).toMatch(/projectFilterLabel\(/);
    expect(screen).toMatch(/<ProjectFilterSheet/);
    expect(screen).toMatch(/useHiddenProjects\(\)/);
    const sheet = src('components/board/ProjectFilterSheet.tsx');
    expect(sheet).toMatch(/ALL_PROJECTS_TEXT\.showAll/);
    expect(sheet).toMatch(/ALL_PROJECTS_TEXT\.showNone/);
    expect(sheet).toMatch(/projects\.length > 8 \?/);
    expect(sheet).toMatch(/accessibilityRole="checkbox"/);
  });

  it('“+” on a status starts a new task in that kind of column, in the project chosen in the form, on the day shown', () => {
    expect(screen).toMatch(/navigation\.navigate\('NewTask', \{ boardDate, \.\.\.\(status \? \{ columnCategory: status \} : \{\}\) \}\)/);
    expect(src('navigation/types.ts')).toMatch(/columnCategory\?: ColumnCategory/);
    expect(src('screens/NewTaskScreen.tsx')).toMatch(/const preferKind = useRef<string \| null>\(params\.columnCategory \?\? null\)/);
  });
});
