import { it, expect } from 'vitest';
import { detailHeaderTitle } from '../lib/detail-header';
import { appSource as src } from '../testing/web-source';

/**
 * Device check H (31 Oct): the task screen showed its title twice — in the stack header and again as
 * the page's big heading — where the website's task panel shows it once. A detail screen's header
 * shows the thing's key (a task's SITE-1, a project's code), or nothing while the key isn't known or
 * when it has none (a meeting, an inspection); the page keeps its big title.
 */
it('a detail header is the key, or nothing', () => {
  expect(detailHeaderTitle('SITE-1')).toBe('SITE-1');
  expect(detailHeaderTitle(' SITE ')).toBe('SITE');
  expect(detailHeaderTitle(undefined)).toBe('');
  expect(detailHeaderTitle(null)).toBe('');
  expect(detailHeaderTitle('  ')).toBe('');
});

const root = src('navigation/RootNavigator.tsx');
/** The `options` a stack screen is given in RootNavigator. */
const optionsOf = (name: string) => new RegExp(`<AppStack\\.Screen\\s+name="${name}"[^]*?/>`).exec(root)?.[0] ?? '';

it('the task, project, meeting and inspection screens open with an empty header, not the title the caller passed', () => {
  for (const name of ['TaskDetail', 'ProjectDetail', 'MeetingDetail', 'Inspection']) {
    const options = optionsOf(name);
    expect(options, name).toMatch(/options=\{\{ title: '' \}\}/);
    expect(options, name).not.toMatch(/route\.params/);
  }
});

it('the task screen titles its header with the task’s key once it is known', () => {
  const s = src('screens/TaskDetailScreen.tsx');
  expect(s).toMatch(/navigation\.setOptions\(\{ title: detailHeaderTitle\(task\?\.key\) \}\)/);
  expect(s).not.toMatch(/setOptions\(\{ title: task\??\.title/);
});

it('the project screen titles its header with the project’s code, not its name', () => {
  const s = src('screens/ProjectDetailScreen.tsx');
  expect(s).toMatch(/navigation\.setOptions\(\{ title: detailHeaderTitle\(project\?\.code\) \}\)/);
  expect(s).not.toMatch(/setOptions\(\{ title: project\.name \}\)/);
  expect(s).toMatch(/<Text style=\{s\.name\} accessibilityRole="header">\s*\{project\.name\}/); // the page keeps its big title
});

it('the meeting and inspection screens leave their header empty (they have no key; the page shows the title)', () => {
  for (const f of ['screens/MeetingDetailScreen.tsx', 'screens/InspectionScreen.tsx']) expect(src(f), f).not.toMatch(/setOptions\(\{ title/);
  expect(src('components/meeting/MeetingDetailParts.tsx')).toMatch(/accessibilityRole="header">\s*\{m\.title\}/);
  expect(src('screens/InspectionScreen.tsx')).toMatch(/accessibilityRole="header">\s*\{d\.title\}/);
});
