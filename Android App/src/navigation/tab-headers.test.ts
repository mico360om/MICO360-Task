import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TAB_ITEMS } from './tabs';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/**
 * Search (🔍) is in every tab's header (6b), as the website's search box is on every page. The tabs
 * share one header button (RootNavigator's screenOptions); a tab that sets its own right side (Chat's
 * ＋ New direct message, Projects' + New) replaces it, so it must put the 🔍 back — through
 * TabHeaderButtons (components/SearchButton), the 🔍 followed by its own buttons.
 */
describe('every tab’s header offers Search (6b, after the lane merge)', () => {
  const root = src('navigation/RootNavigator.tsx');

  it('the tabs share the 🔍 as their header’s right side', () => {
    expect(root).toMatch(/<Tabs\.Navigator\s+screenOptions=\{\(\{ route \}\) => \(\{[^]*?headerRight: \(\) => <SearchButton \/>,/);
  });

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
    expect(files.map(([name]) => name)).toEqual(['Dashboard', 'MyTasks', 'Projects', 'Meetings', 'Chat', 'Notifications']);
    for (const [name, file] of files) expect(file, name).not.toBe('');
  });

  it('a tab with its own header buttons keeps the 🔍 first (Chat’s ＋ and Projects’ + New among them)', () => {
    const own: string[] = [];
    for (const [name, file] of tabScreenFiles()) {
      const screen = src(file);
      const sets = screen.match(/headerRight:/g)?.length ?? 0;
      if (sets === 0) continue;
      own.push(name);
      // Every right side the screen sets is TabHeaderButtons — never a button alone, never none for someone.
      const withSearch = screen.match(/headerRight: \(\) => \(\s*<TabHeaderButtons>/g)?.length ?? 0;
      expect(withSearch, `${file}: every headerRight is <TabHeaderButtons>`).toBe(sets);
      expect(screen, file).toMatch(/import \{ TabHeaderButtons \} from '\.\.\/components\/SearchButton';/);
    }
    expect(own).toEqual(expect.arrayContaining(['Projects', 'Chat']));
  });

  it('TabHeaderButtons is the 🔍 followed by the tab’s own buttons', () => {
    const button = src('components/SearchButton.tsx');
    expect(button).toMatch(/export function TabHeaderButtons\([^]*?<SearchButton \/>\s*\{children\}/);
    expect(button).toMatch(/accessibilityLabel="Search"/);
    expect(button).toMatch(/navigationRef\.navigate\('Search'\)/);
  });

  it('Chat’s header has both: 🔍 Search and ＋ New direct message', () => {
    const chat = src('screens/ChatScreen.tsx');
    expect(chat).toMatch(/<TabHeaderButtons>\s*<Pressable onPress=\{\(\) => setDmOpen\(true\)\} accessibilityRole="button" accessibilityLabel="New direct message"/);
  });
});
