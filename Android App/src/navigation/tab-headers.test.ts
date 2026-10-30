import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { TAB_ITEMS } from './tabs';
import { appPath, appSource as src } from '../testing/web-source';

/**
 * The frame, as the website's (Stage 1): one white top bar on every tab — the menu, the logo,
 * Search and the bell — and each tab's title in its own content (PageHeader), with the tab's own
 * buttons (New project, New direct message) beside it instead of in the bar.
 */
describe('the white top bar and the page titles', () => {
  const root = src('navigation/RootNavigator.tsx');

  /** Each tab's screen file, as RootNavigator maps and imports it. */
  const tabScreenFiles = (): Array<[string, string]> => {
    const block = /const TAB_SCREENS[^=]*= \{([^}]*)\}/.exec(root)?.[1] ?? '';
    return TAB_ITEMS.map((t) => {
      const component = new RegExp(`\\b${t.name}: (\\w+)`).exec(block)?.[1] ?? '';
      const from = new RegExp(`import \\{ ${component} \\} from '\\.\\./(screens/\\w+)';`).exec(root)?.[1] ?? '';
      return [t.name, from ? `${from}.tsx` : ''];
    });
  };

  it('finds every tab’s screen', () => {
    const files = tabScreenFiles();
    expect(files.map(([name]) => name)).toEqual(['Dashboard', 'MyTasks', 'Projects', 'Meetings', 'Chat']);
    for (const [name, file] of files) expect(file, name).not.toBe('');
  });

  it('every tab shows the white top bar', () => expect(root).toMatch(/<Tabs\.Navigator\s+screenOptions=\{\(\{ route \}\) => \(\{[^]*?header: \(\) => <AppTopBar \/>,/));

  it('each tab screen titles itself with PageHeader and sets no headerRight', () => {
    for (const [name, file] of tabScreenFiles()) {
      const title = TAB_ITEMS.find((t) => t.name === name)!.title;
      expect(src(file), name).toMatch(new RegExp(`<PageHeader[^>]*title="${title}"`));
      expect(src(file), name).not.toMatch(/headerRight/);
    }
  });

  it('Projects offers New project and Chat New direct message in their page header', () => {
    expect(src('screens/ProjectsScreen.tsx')).toMatch(/<PageHeader[^]*?actions=\{[^]*?title="New project"/);
    expect(src('screens/ChatScreen.tsx')).toMatch(/<PageHeader[^]*?actions=\{[^]*?label="New direct message"/);
  });

  it('the top bar: menu, logo, Search and the bell with its count', () => {
    const s = src('components/AppTopBar.tsx');
    for (const m of ['label="Open menu"', '<BrandLogo', 'label="Search"', 'label={bellLabel(count)}', 'badge={alertsBadge(count)}', "navigate('Notifications')", "navigate('Search')"]) expect(s).toContain(m);
    expect(s).toContain('hint="Finds tasks, projects, people, meetings and pages"');
  });

  it('stack screens get the white header and Notifications is one of them', () => {
    expect(root).toMatch(/headerStyle: \{ backgroundColor: colors\.surface \}/);
    expect(root).toMatch(/headerTintColor: colors\.ink/);
    expect(root).toMatch(/<AppStack\.Screen name="Notifications" component=\{NotificationsScreen\} options=\{\{ title: 'Notifications' \}\} \/>/);
    expect(root).not.toMatch(/HamburgerButton|SearchButton|headerStyle: \{ backgroundColor: colors\.brand/);
    expect(existsSync(appPath('src/components/SearchButton.tsx'))).toBe(false);
  });

  it('the sign-in test lands on the Dashboard', () => expect(src('../.maestro/login.yaml')).toMatch(/assertVisible: 'Dashboard'/));
});
