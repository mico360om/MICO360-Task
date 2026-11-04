import { describe, it, expect } from 'vitest';
import { parseCommand, matchNavCommands, NAV_COMMANDS, commandTaskKeys } from './commands';

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

  describe('a task number however it is typed (1.22.3)', () => {
    it('reads mico-142, mico 142, MICO142, MICO_142 and #MICO-142 in every command', () => {
      for (const key of ['mico 142', 'MICO_142', '#MICO-142', '#mico 142', 'MICO - 142']) {
        expect(parseCommand(`open ${key}`), key).toEqual({ type: 'open', taskKey: 'MICO-142' });
        expect(parseCommand(`complete ${key}`), key).toEqual({ type: 'complete', taskKey: 'MICO-142' });
        expect(parseCommand(`assign ${key} to Sara`), key).toEqual({ type: 'assign', taskKey: 'MICO-142', assignee: 'Sara' });
        expect(parseCommand(`move ${key} to Review`), key).toEqual({ type: 'move', taskKey: 'MICO-142', status: 'Review' });
      }
      expect(parseCommand('#MICO-142')).toEqual({ type: 'open', taskKey: 'MICO-142' });
    });

    it('a run-together number keeps what was typed, and is looked up under every split', () => {
      expect(parseCommand('open mico142')).toEqual({ type: 'open', taskKey: 'MICO142' });
      expect(parseCommand('complete hr214')).toEqual({ type: 'complete', taskKey: 'HR214' });
      expect(commandTaskKeys('HR214')).toEqual(['HR214', 'HR-214', 'HR2-14', 'HR21-4']);
      expect(commandTaskKeys('MICO-142')).toEqual(['MICO-142']);
      expect(commandTaskKeys('mico-7')).toEqual(['MICO-7']);
    });

    it('without a verb, a loosely typed number is offered only once the search finds it (so "phase 2" still searches)', () => {
      expect(parseCommand('mico 142')).toEqual({ type: 'open', taskKey: 'MICO-142', onlyIfFound: true });
      expect(parseCommand('MICO142')).toEqual({ type: 'open', taskKey: 'MICO142', onlyIfFound: true });
      expect(parseCommand('mico_142')).toEqual({ type: 'open', taskKey: 'MICO-142', onlyIfFound: true });
      expect(parseCommand('phase 2')).toEqual({ type: 'open', taskKey: 'PHASE-2', onlyIfFound: true });
      // The hyphenated number is a command straight away, as before.
      expect(parseCommand('mico-142')).toEqual({ type: 'open', taskKey: 'MICO-142' });
    });

    it('a bare number or other text is not a task command', () => {
      for (const text of ['142', '#142', ' 142 ', 'assign a1 to Sara', 'open scaffold permit', 'check 142 valves']) expect(parseCommand(text), text).toBeNull();
    });
  });
});

describe('matchNavCommands', () => {
  it('fuzzy-matches page names and keywords', () => {
    const m = matchNavCommands('rep', true);
    expect(m.some((c) => c.to === '/reports')).toBe(true);
    expect(matchNavCommands('cal', false).some((c) => c.to === '/calendar')).toBe(true);
  });

  it('finds Timeline and Workload for everyone, by name or by what they show', () => {
    expect(matchNavCommands('timeline', false)[0]).toMatchObject({ label: 'Timeline', to: '/timeline' });
    expect(matchNavCommands('gantt', false)[0]?.to).toBe('/timeline');
    expect(matchNavCommands('milestones', false)[0]?.to).toBe('/timeline');
    expect(matchNavCommands('workload', false)[0]).toMatchObject({ label: 'Workload', to: '/workload' });
    expect(matchNavCommands('capacity', false)[0]?.to).toBe('/workload');
    expect(parseCommand('go to workload', false)).toEqual({ type: 'navigate', to: '/workload', label: 'Workload' });
  });

  it('finds Templates for everyone, by name or by "template"', () => {
    for (const q of ['templates', 'template', 'standard tasks']) expect(matchNavCommands(q, false)[0]?.to, q).toBe('/templates');
    expect(parseCommand('go to templates', false)).toEqual({ type: 'navigate', to: '/templates', label: 'Templates' });
    // "project" still finds Projects first.
    expect(matchNavCommands('project', false)[0]?.to).toBe('/projects');
  });

  it('finds MICO AI by its name and by "ask" or "assistant"', () => {
    for (const q of ['mico ai', 'ask', 'assistant']) expect(matchNavCommands(q, false)[0]?.to, q).toBe('/mico-ai');
  });

  it('hides Reports (admin-only) from non-admins', () => {
    expect(matchNavCommands('reports', false).some((c) => c.to === '/reports')).toBe(false);
    expect(parseCommand('go to reports', false)).toBeNull();
  });

  it('hides admin destinations from non-admins but shows them to admins', () => {
    expect(matchNavCommands('users', false).some((c) => c.to === '/admin/users')).toBe(false);
    expect(matchNavCommands('users', true).some((c) => c.to === '/admin/users')).toBe(true);
  });

  it('finds the Companies page for administrators only', () => {
    expect(matchNavCommands('companies', true)[0]).toMatchObject({ id: 'admin-companies', label: 'Companies', to: '/admin/companies' });
    expect(matchNavCommands('logo', true).map((c) => c.id)).toContain('admin-companies');
    expect(matchNavCommands('companies', false).some((c) => c.to === '/admin/companies')).toBe(false);
    const ids = NAV_COMMANDS.map((c) => c.id);
    expect(ids[ids.indexOf('admin-users') + 1]).toBe('admin-companies');
  });

  it('finds Management for administrators and for the people who run a project, nobody else', () => {
    for (const q of ['management', 'health', 'red amber green', 'leadership']) {
      expect(matchNavCommands(q, true)[0]?.to, q).toBe('/management');
      expect(matchNavCommands(q, false, true)[0]?.to, q).toBe('/management');
      expect(matchNavCommands(q, false).some((c) => c.to === '/management'), q).toBe(false);
    }
    expect(parseCommand('go to management', false)).toBeNull();
    expect(parseCommand('go to management', false, true)).toEqual({ type: 'navigate', to: '/management', label: 'Management' });
    expect(NAV_COMMANDS.find((c) => c.id === 'management')).toMatchObject({ leads: true });
  });

  it('returns the common pages for an empty query (non-admin excludes admin pages)', () => {
    const all = matchNavCommands('', false);
    expect(all.length).toBeGreaterThan(3);
    expect(all.every((c) => !c.admin)).toBe(true);
    expect(NAV_COMMANDS.some((c) => c.admin)).toBe(true);
  });
});
