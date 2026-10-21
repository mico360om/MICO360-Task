import { describe, it, expect } from 'vitest';
import { OMNIBOX_KEYWORD, escapeXml, omniboxSuggestions, omniboxTarget, defaultSuggestion } from './omnibox.js';

// Stage 6: typing "mico" and a space in Chrome's address bar searches MICO360 Tasks.
const FOUND = {
  tasks: [{ id: 't1', key: 'RIG-7', title: 'Inspect <the> rig & "valves"', projectId: 'p1' }],
  projects: [{ id: 'p1', code: 'RIG', name: 'Rig Inspection' }],
  users: [{ id: 'u2', username: 'mariam', firstName: 'Mariam', lastName: 'Al Hinai' }],
  meetings: [{ id: 'm1', title: 'Rig review', projectId: 'p1', snippet: '' }],
};

describe('the address bar’s “mico” search', () => {
  it('is the keyword in the manifest', async () => {
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    expect(manifest.omnibox).toEqual({ keyword: OMNIBOX_KEYWORD });
    expect(OMNIBOX_KEYWORD).toBe('mico');
  });

  it('suggests what search finds: tasks, projects, meetings and pages (people open a conversation in the app)', () => {
    const s = omniboxSuggestions(FOUND, 'rig', { isAdmin: false });
    expect(s.map((x) => x.content)).toEqual(['task:t1', 'project:p1', 'meeting:m1']);
    expect(s[0].description).toBe('Inspect &lt;the&gt; rig &amp; &quot;valves&quot; <dim>RIG-7 · task</dim>');
    expect(s[1].description).toBe('Rig Inspection <dim>RIG · project board</dim>');
    expect(s[2].description).toBe('Rig review <dim>meeting</dim>');
    expect(omniboxSuggestions(null, 'cal', { isAdmin: false }).map((x) => x.content)).toEqual(['page:calendar']);
    expect(omniboxSuggestions(null, 'cal', { isAdmin: false })[0].description).toBe('Go to <match>Calendar</match>');
    expect(omniboxSuggestions(FOUND, 'rig', { isAdmin: false, max: 2 })).toHaveLength(2);
  });

  it('writes every character safely (the address bar reads the words as XML)', () => {
    expect(escapeXml(`a<b>&'"`)).toBe('a&lt;b&gt;&amp;&apos;&quot;');
  });

  it('says what pressing Enter does', () => {
    expect(defaultSuggestion(true)).toBe('Search MICO360 Tasks for <match>%s</match>');
    expect(defaultSuggestion(false)).toBe('Sign in to MICO360 Tasks to search it from here');
  });

  it('a chosen suggestion opens here: a task’s panel, a board, a meeting, a page', () => {
    expect(omniboxTarget('task:t1')).toEqual({ hash: '#/task/t1' });
    expect(omniboxTarget('project:p1')).toEqual({ hash: '#/board/p1' });
    expect(omniboxTarget('meeting:m1')).toEqual({ hash: '#/meeting/m1' });
    expect(omniboxTarget('page:calendar')).toEqual({ hash: '#/calendar' });
    expect(omniboxTarget('page:activity', { appBase: 'https://task.mico360.com' })).toEqual({ url: 'https://task.mico360.com/activity' });
  });

  it('anything else typed opens the Search screen with those words', () => {
    expect(omniboxTarget('rig valves')).toEqual({ hash: '#/search?q=rig%20valves' });
    expect(omniboxTarget('RIG-7')).toEqual({ hash: '#/search?q=RIG-7' });
    expect(omniboxTarget('  ')).toEqual({ hash: '#/' });
    // Something that only looks like a suggestion is searched for as words, never used as an address.
    expect(omniboxTarget('task:../../admin')).toEqual({ hash: '#/search?q=task%3A..%2F..%2Fadmin' });
    expect(omniboxTarget('page:nowhere')).toEqual({ hash: '#/search?q=page%3Anowhere' });
  });
});
