import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, NetworkError } from './api-client';
import { NAV_COMMANDS } from './commands';
import {
  APP_PAGES,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMITS,
  exactTask,
  routeOf,
  searchEnabled,
  searchItems,
  searchStatus,
  type SearchResults,
} from './search';

const results = (over: Partial<SearchResults> = {}): SearchResults => ({
  tasks: [],
  projects: [],
  users: [],
  meetings: [],
  ...over,
});

const ctx = { isAdmin: false, myId: 'me' };
const groups = (items: { group: string }[]) => [...new Set(items.map((i) => i.group))];

describe('search: what the box offers before and while typing', () => {
  it('waits for typing to pause, and asks the server from 2 letters', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(250);
    expect(searchEnabled('a')).toBe(false);
    expect(searchEnabled(' ab ')).toBe(true);
    expect(searchEnabled('  a ')).toBe(false);
  });

  it('with nothing typed, offers the first five pages the phone has', () => {
    const items = searchItems({ raw: '', results: undefined, ...ctx });
    expect(items.map((i) => i.primary)).toEqual(['Home', 'My Tasks', 'Projects', 'Calendar', 'Chat']);
    expect(groups(items)).toEqual(['Go to']);
  });

  it('pages match by name or keyword; the admin pages only for administrators, the rest on the website', () => {
    expect(searchItems({ raw: 'rep', results: undefined, ...ctx }).map((i) => i.primary)).toEqual([]);
    expect(searchItems({ raw: 'rep', results: undefined, isAdmin: true, myId: 'me' }).map((i) => i.primary)).toEqual(['Reports']);
    const ai = searchItems({ raw: 'models', results: undefined, isAdmin: true, myId: 'me' })[0]!;
    expect(ai).toMatchObject({ group: 'Go to', primary: 'AI Management', hint: 'On the website', target: { kind: 'website', path: '/admin/ai' }, label: 'AI Management, opens on the website' });
    expect(searchItems({ raw: 'users', results: undefined, isAdmin: true, myId: 'me' })[0]).toMatchObject({ primary: 'User Management', target: { kind: 'screen', action: { type: 'stack', screen: 'Users' } } });
    expect(searchItems({ raw: 'alerts', results: undefined, ...ctx })[0]).toMatchObject({ primary: 'Alerts', target: { kind: 'screen', action: { type: 'tab', tab: 'Notifications' } } });
    expect(searchItems({ raw: 'what’s new', results: undefined, ...ctx })[0]).toMatchObject({ primary: 'About and version history', target: { kind: 'screen', action: { type: 'stack', screen: 'About' } } });
  });

  it('has a phone page for every page of the website’s search, except the all-projects board', () => {
    const missing = NAV_COMMANDS.filter((c) => !APP_PAGES[c.id]).map((c) => c.id);
    expect(missing).toEqual(['board']);
    // "board" then finds the dashboard (Home), as the website's ranking puts it second.
    expect(searchItems({ raw: 'board', results: undefined, ...ctx }).map((i) => i.primary)).toEqual(['Home']);
  });

  it('reads “open KEY” (or a bare key) and “go to …” as a command; the task-changing commands stay on the website', () => {
    expect(searchItems({ raw: 'mico-7', results: undefined, ...ctx })[0]).toMatchObject({ group: 'Command', primary: 'Open MICO-7', target: { kind: 'openKey', key: 'MICO-7' } });
    expect(searchItems({ raw: 'go to calendar', results: undefined, ...ctx })[0]).toMatchObject({ group: 'Command', primary: 'Go to Calendar', target: { kind: 'screen', action: { type: 'stack', screen: 'Calendar' } } });
    expect(searchItems({ raw: 'go to audit', results: undefined, isAdmin: true, myId: 'me' })[0]).toMatchObject({ group: 'Command', primary: 'Go to Audit Logs', target: { kind: 'website', path: '/admin/audit' } });
    expect(groups(searchItems({ raw: 'complete MICO-7', results: undefined, ...ctx }))).not.toContain('Command');
    expect(groups(searchItems({ raw: 'go to board', results: undefined, ...ctx }))).not.toContain('Command');
  });
});

describe('search: the server’s results, in the website’s groups and numbers', () => {
  const many = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));
  const r = results({
    tasks: many(9, (i) => ({ id: `t${i}`, key: `MICO-${i}`, title: `Task ${i}`, projectId: 'p1' })),
    projects: many(7, (i) => ({ id: `p${i}`, code: `P${i}`, name: `Project ${i}` })),
    users: many(7, (i) => ({ id: `u${i}`, username: `user${i}`, firstName: `First${i}`, lastName: i === 0 ? '' : 'Last' })),
    meetings: many(8, (i) => ({ id: `m${i}`, title: `Meeting ${i}`, projectId: null, snippet: `…said ${i}…` })),
  });

  it('tasks 6, projects 5, people 5 and meetings 6, after the commands and pages', () => {
    expect(SEARCH_LIMITS).toEqual({ tasks: 6, projects: 5, people: 5, meetings: 6, pages: 6, pagesEmpty: 5 });
    const items = searchItems({ raw: 'zz', results: r, ...ctx });
    expect(groups(items)).toEqual(['Tasks', 'Projects', 'People', 'Meetings']);
    const count = (g: string) => items.filter((i) => i.group === g).length;
    expect([count('Tasks'), count('Projects'), count('People'), count('Meetings')]).toEqual([6, 5, 5, 6]);
  });

  it('a task opens the task, a project its dashboard, a meeting the meeting', () => {
    const items = searchItems({ raw: 'zz', results: r, ...ctx });
    expect(items[0]).toMatchObject({ primary: 'Task 0', hint: 'MICO-0', label: 'Task MICO-0, Task 0', target: { kind: 'screen', action: { type: 'stack', screen: 'TaskDetail', params: { taskId: 't0', title: 'Task 0' } } } });
    expect(items.find((i) => i.group === 'Projects')).toMatchObject({ primary: 'Project 0', hint: 'P0', label: 'Project P0, Project 0', target: { kind: 'screen', action: { type: 'stack', screen: 'ProjectDetail', params: { projectId: 'p0', projectName: 'Project 0' } } } });
    expect(items.find((i) => i.group === 'Meetings')).toMatchObject({ primary: 'Meeting 0', secondary: '…said 0…', label: 'Meeting Meeting 0, …said 0…', target: { kind: 'screen', action: { type: 'stack', screen: 'MeetingDetail', params: { meetingId: 'm0', title: 'Meeting 0' } } } });
  });

  it('a person opens your profile (you), User Management (an administrator) or a conversation with them', () => {
    const people = results({ users: [{ id: 'me', username: 'mariam', firstName: 'Mariam', lastName: 'Al Balushi' }, { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Ahmed' }] });
    const asMember = searchItems({ raw: 'ma', results: people, ...ctx }).filter((i) => i.group === 'People');
    expect(asMember.map((i) => [i.primary, i.target])).toEqual([
      ['Mariam Al Balushi', { kind: 'screen', action: { type: 'stack', screen: 'Profile' } }],
      ['Omar Ahmed', { kind: 'directMessage', userId: 'u2', name: 'Omar Ahmed' }],
    ]);
    expect(asMember[1]!.label).toBe('Person Omar Ahmed, opens a chat');
    const asAdmin = searchItems({ raw: 'ma', results: people, isAdmin: true, myId: 'me' }).filter((i) => i.group === 'People');
    expect(asAdmin[1]!.target).toEqual({ kind: 'screen', action: { type: 'stack', screen: 'Users', params: { q: 'omar' } } });
    // A name-less person shows the username.
    expect(searchItems({ raw: 'zz', results: r, ...ctx }).find((i) => i.group === 'People')?.primary).toBe('First0');
  });

  it('leaves out anything whose id isn’t an id (it would go into an API path)', () => {
    const bad = results({
      tasks: [{ id: '../users', key: 'X-1', title: 'Bad', projectId: 'p' }],
      projects: [{ id: 'p 1', code: 'B', name: 'Bad' }],
      users: [{ id: 'u/2', username: 'bad', firstName: 'B', lastName: '' }],
      meetings: [{ id: 'm?x=1', title: 'Bad', projectId: null, snippet: '' }],
    });
    expect(searchItems({ raw: 'bad', results: bad, ...ctx })).toEqual([]);
  });

  it('a server without meetings in its results still works', () => {
    const old = { tasks: [], projects: [], users: [] } as unknown as SearchResults;
    expect(searchItems({ raw: 'zz', results: old, ...ctx })).toEqual([]);
  });

  it('“Open KEY” opens only the task with exactly that key, never a longer one', () => {
    const found = results({ tasks: [{ id: 't50', key: 'WEB-50', title: 'Fifty', projectId: 'p' }, { id: 't5', key: 'web-5', title: 'Five', projectId: 'p' }] });
    expect(exactTask(found, 'WEB-5')?.id).toBe('t5');
    expect(exactTask(results({ tasks: [{ id: 't50', key: 'WEB-50', title: 'Fifty', projectId: 'p' }] }), 'WEB-5')).toBeNull();
    expect(exactTask(results({ tasks: [{ id: 'bad id', key: 'WEB-5', title: 'x', projectId: 'p' }] }), 'WEB-5')).toBeNull();
  });
});

describe('search: what the list says', () => {
  it('searching, nothing found, offline, or the server failing', () => {
    expect(searchStatus({ term: 'a', debounced: 'a', loading: false, error: null, resultCount: 0 })).toBe('Type 2 or more letters to search tasks, projects, people and meetings.');
    expect(searchStatus({ term: 'ab', debounced: 'ab', loading: true, error: null, resultCount: 0 })).toBe('Searching…');
    expect(searchStatus({ term: 'ab', debounced: 'ab', loading: false, error: null, resultCount: 0 })).toBe('No matches for “ab”.');
    expect(searchStatus({ term: 'ab', debounced: 'ab', loading: false, error: null, resultCount: 3 })).toBeNull();
    expect(searchStatus({ term: 'ab', debounced: 'ab', loading: false, error: new NetworkError('x'), resultCount: 0 })).toBe('You’re offline — search needs a connection. The pages above still open.');
    expect(searchStatus({ term: 'ab', debounced: 'ab', loading: false, error: new ApiError(500, 'ERROR', 'Request failed (500)'), resultCount: 0 })).toBe('Couldn’t search. Please try again.');
    expect(searchStatus({ term: '', debounced: '', loading: false, error: null, resultCount: 0 })).toBeNull();
  });
});

describe('search: opening a result on the phone', () => {
  it('a tab, or a screen with its details', () => {
    expect(routeOf({ type: 'tab', tab: 'MyTasks' })).toEqual({ name: 'Tabs', params: { screen: 'MyTasks' } });
    expect(routeOf({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't1', title: 'X' } })).toEqual({ name: 'TaskDetail', params: { taskId: 't1', title: 'X' } });
    expect(routeOf({ type: 'stack', screen: 'About' })).toEqual({ name: 'About', params: undefined });
    expect(routeOf({ type: 'website', path: '/admin/ai' })).toBeNull();
  });
});

const webSearch = resolve(__dirname, '../../../Web Portal/frontend/src/components/GlobalSearch.tsx');
describe.skipIf(!existsSync(webSearch))('the same groups, numbers and wait as the website’s search', () => {
  it('reads them from the website’s search box', () => {
    const source = readFileSync(webSearch, 'utf8');
    expect(source).toContain(`debounceMs = ${SEARCH_DEBOUNCE_MS}`);
    expect(source).toContain('debounced.trim().length >= 2');
    expect(source).toContain(`.slice(0, raw ? ${SEARCH_LIMITS.pages} : ${SEARCH_LIMITS.pagesEmpty})`);
    expect(source).toContain(`r.tasks.slice(0, ${SEARCH_LIMITS.tasks})) out.push({ id: \`task-\${t.id}\`, group: 'Tasks'`);
    expect(source).toContain(`r.projects.slice(0, ${SEARCH_LIMITS.projects})`);
    expect(source).toContain(`r.users.slice(0, ${SEARCH_LIMITS.people})) out.push({ id: \`user-\${u.id}\`, group: 'People'`);
    expect(source).toContain(`(r.meetings ?? []).slice(0, ${SEARCH_LIMITS.meetings})) out.push({ id: \`meeting-\${m.id}\`, group: 'Meetings'`);
    expect(source).toContain(`group: 'Projects'`);
    expect(source).toContain('No matches for “{debounced}”.');
  });
});
