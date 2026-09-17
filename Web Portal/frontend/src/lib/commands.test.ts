import { describe, it, expect } from 'vitest';
import { parseCommand, matchNavCommands, NAV_COMMANDS } from './commands';

describe('parseCommand', () => {
  it('parses "assign <KEY> to <name>"', () => {
    expect(parseCommand('assign MICO-7 to Sara')).toEqual({ type: 'assign', taskKey: 'MICO-7', assignee: 'Sara' });
  });

  it('parses completion verbs and normalises the key to upper case', () => {
    expect(parseCommand('complete rig-3')).toEqual({ type: 'complete', taskKey: 'RIG-3' });
    expect(parseCommand('done MICO-12')).toEqual({ type: 'complete', taskKey: 'MICO-12' });
  });

  it('parses "move <KEY> to <status>"', () => {
    expect(parseCommand('move MICO-7 to Review')).toEqual({ type: 'move', taskKey: 'MICO-7', status: 'Review' });
  });

  it('treats a bare task key (or "open <KEY>") as an open command', () => {
    expect(parseCommand('MICO-7')).toEqual({ type: 'open', taskKey: 'MICO-7' });
    expect(parseCommand('open rig-9')).toEqual({ type: 'open', taskKey: 'RIG-9' });
  });

  it('parses "go to <page>" into a navigation command', () => {
    expect(parseCommand('go to reports')).toEqual({ type: 'navigate', to: '/reports', label: 'Reports' });
    expect(parseCommand('goto board')).toEqual({ type: 'navigate', to: '/board', label: 'Kanban Board' });
  });

  it('returns null for free text that is not a command', () => {
    expect(parseCommand('quarterly planning notes')).toBeNull();
    expect(parseCommand('go to nowhere')).toBeNull();
  });
});

describe('matchNavCommands', () => {
  it('fuzzy-matches page names and keywords', () => {
    const m = matchNavCommands('rep', false);
    expect(m.some((c) => c.to === '/reports')).toBe(true);
  });

  it('hides admin destinations from non-admins but shows them to admins', () => {
    expect(matchNavCommands('users', false).some((c) => c.to === '/admin/users')).toBe(false);
    expect(matchNavCommands('users', true).some((c) => c.to === '/admin/users')).toBe(true);
  });

  it('returns the common pages for an empty query (non-admin excludes admin pages)', () => {
    const all = matchNavCommands('', false);
    expect(all.length).toBeGreaterThan(3);
    expect(all.every((c) => !c.admin)).toBe(true);
    expect(NAV_COMMANDS.some((c) => c.admin)).toBe(true);
  });
});
