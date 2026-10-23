import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = (p: string) => resolve(__dirname, '..', p);
const src = (p: string) => (existsSync(path(p)) ? readFileSync(path(p), 'utf8') : '');

describe('the My Tasks screen (4d), as the website’s page', () => {
  const screen = src('screens/MyTasksScreen.tsx');

  it('is a virtualized list of my tasks with the website’s filters, chips and sort', () => {
    expect(screen).toMatch(/<FlatList/);
    expect(screen).not.toMatch(/ScrollView/);
    expect(screen).toMatch(/enrichMyTasks\(tasksQ\.data \?\? \[\], projects, \{ timeZone, now \}\)/);
    expect(screen).toMatch(/sortMyTasks\(filterMyTasks\(rows, filters, \{ timeZone, now, q \}\), filters\.sort\)/);
    expect(screen).toMatch(/myTaskCounts\(rows\)/);
    for (const chip of ['all', 'open', 'overdue', 'completed']) expect(screen, chip).toMatch(new RegExp(`setFilters\\(\\(f\\) => toggleChip\\(f, '${chip}'\\)\\)`));
    for (const what of ['project', 'status', 'priority', 'assignee', 'due date']) expect(screen, what).toContain(`Filter by ${what}`);
    expect(screen).toContain('Sort tasks');
    expect(screen).toMatch(/MY_TASKS_TEXT\.noMatchTitle/);
    expect(screen).toMatch(/MY_TASKS_TEXT\.emptyTitle/);
  });

  it('saves views on this phone (the website’s three, and your own)', () => {
    expect(screen).toMatch(/useSavedViews\(\)/);
    expect(screen).toMatch(/\[\.\.\.BUILT_IN_VIEWS, \.\.\.views\.custom\]/);
    expect(screen).toContain('Name this view…');
    expect(screen).toContain('＋ Save view');
  });

  it('selects tasks (only shown ones) and runs the website’s bulk actions, asking before clearing due dates', () => {
    expect(screen).toMatch(/toggleAllVisible\(shown, selected\)/);
    expect(screen).toMatch(/selectedOf\(shown, selected\)/);
    expect(screen).toMatch(/useBulkTaskActions\(\)/);
    expect(screen).toMatch(/runBulkAction\(\{ type: 'complete' \}, BULK_LABELS\.complete\)/);
    expect(screen).toMatch(/Alert\.alert\(clearDatesQuestion\(chosen\.length\)/);
    expect(screen).toMatch(/text: 'Clear dates'/);
    expect(screen).toMatch(/text: 'Keep'/);
    // Move to… only with one project chosen (its columns), as on the website.
    expect(screen).toMatch(/filters\.project \?/);
  });

  it('a new task starts in the project filtered to (changeable)', () => {
    expect(screen).toMatch(/navigation\.navigate\('NewTask', filters\.project \? \{ defaultProjectId: filters\.project \} : undefined\)/);
  });

  it('the bulk writes go through each task’s own write path', () => {
    const core = src('core/my-tasks-queries.ts');
    expect(core).toMatch(/sendTaskEdit\(services, qc, t\.id, patch, versions\.get\(t\.id\)\)/);
    expect(core).toMatch(/sendTaskMove\(services, \{ id: t\.id, columnId, projectId: t\.projectId, category \}\)/);
    expect(core).toMatch(/sendItemWrite\(itemLanes, w\.order, \{ kind: 'task\.assign'/);
    expect(src('core/queries.ts')).toMatch(/mutationFn: \(patch: Partial<ApiTask> & \{ scope\?: 'one' \| 'series' \}\) => sendTaskEdit\(services, qc, taskId, patch\)/);
  });
});

describe('My Tasks with TalkBack and large text (final review A9)', () => {
  const screen = src('screens/MyTasksScreen.tsx');

  it('a task’s box is named with its key and title, not the key alone', async () => {
    const { selectTaskLabel } = await import('./my-tasks');
    expect(selectTaskLabel({ task: { key: 'ABC-12', title: 'Fix the pump' } })).toBe('Select ABC-12, Fix the pump');
    expect(src('components/my-tasks/MyTaskItem.tsx')).toMatch(/accessibilityLabel=\{selectTaskLabel\(row\)\}/);
  });

  it('the list leaves room for the bulk bar as tall as it really is (it wraps to more rows at large text)', () => {
    expect(screen).toMatch(/<View style=\{s\.bulkBar\} onLayout=\{\(e\) => setBarHeight\(e\.nativeEvent\.layout\.height\)\}/);
    expect(screen).toMatch(/contentContainerStyle=\{\[s\.list, \{ paddingBottom: listBottom \}\]\}/);
  });

  it('while a bulk action runs the bar stays, says how far it is and offers Stop, not Clear', () => {
    expect(screen).toMatch(/\{showBar \? \(/);
    expect(screen).toMatch(/const showBar = chosen\.length > 0 \|\| busy;/);
    expect(screen).toMatch(/\{busy \? \(\s*\/\/[^\n]*\n\s*<Pressable\s+onPress=\{\(\) => \(stopRun\.current = true\)\}/);
  });
});
