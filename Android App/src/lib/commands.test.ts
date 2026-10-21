import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV_COMMANDS, findNav, matchNavCommands, parseCommand } from './commands';

describe('the search’s pages and commands (a copy of the website’s lib/commands)', () => {
  it('finds pages by name or keyword, best match first; admin pages for administrators only', () => {
    expect(matchNavCommands('board', true).map((c) => c.id).slice(0, 2)).toEqual(['board', 'dashboard']);
    expect(matchNavCommands('version', false).map((c) => c.id)).toEqual(['about']);
    expect(matchNavCommands('audit', false)).toEqual([]);
    expect(matchNavCommands('audit', true).map((c) => c.id)).toEqual(['admin-audit']);
    expect(matchNavCommands('', false).every((c) => !c.admin)).toBe(true);
    expect(findNav('cal', true)?.id).toBe('calendar');
  });

  it('reads “open KEY”, a bare key and “go to <page>”', () => {
    expect(parseCommand('MICO-7')).toEqual({ type: 'open', taskKey: 'MICO-7' });
    expect(parseCommand('open mico-7')).toEqual({ type: 'open', taskKey: 'MICO-7' });
    expect(parseCommand('go to reports', true)).toEqual({ type: 'navigate', to: '/reports', label: 'Reports' });
    expect(parseCommand('go to reports', false)).toBeNull();
    expect(parseCommand('complete MICO-7')).toEqual({ type: 'complete', taskKey: 'MICO-7' });
    expect(parseCommand('pour the slab')).toBeNull();
  });
});

/**
 * The website's palette (Web Portal/frontend/src/lib/commands.ts) and this copy must offer the same
 * pages and read the same commands. Skipped when the website's code isn't next to the app.
 */
const web = resolve(__dirname, '../../../Web Portal/frontend/src/lib/commands.ts');
describe.skipIf(!existsSync(web))('the same as the website', () => {
  type Mod = { NAV_COMMANDS: unknown; matchNavCommands: (q: string, admin: boolean) => unknown; parseCommand: (q: string, admin?: boolean) => unknown };
  const load = async () => (await import(/* @vite-ignore */ web)) as Mod;
  const inputs = ['', 'b', 'board', 'Kanban', 'home', 'tasks', 'admin', 'users', 'ai', 'what’s new', 'changelog', 'zzz', 'MICO-7', 'open web-12', 'go to calendar',
    'goto settings', 'navigate to audit', 'open reports', 'assign MICO-7 to Sara Ali', 'move MICO-7 to In Progress', 'done A1-2', 'close x-1', 'complete', '  MICO-7  '];

  it('the pages', async () => {
    expect(NAV_COMMANDS).toEqual((await load()).NAV_COMMANDS);
  });

  it('the matching and the commands', async () => {
    const w = await load();
    for (const admin of [true, false]) {
      for (const q of inputs) {
        expect(matchNavCommands(q, admin), q).toEqual(w.matchNavCommands(q, admin));
        expect(parseCommand(q, admin), q).toEqual(w.parseCommand(q, admin));
      }
    }
  });
});
