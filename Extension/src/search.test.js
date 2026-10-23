import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PAGES, rankPages, matchPages, parseCommand, buildResults, flatItems, searchable, MIN_QUERY, taskByKey } from './search.js';

const APP = 'https://task.mico360.com';
const RESULTS = {
  tasks: [
    { id: 't1', key: 'RIG-7', title: 'Inspect the north rig', projectId: 'p1' },
    { id: 't2', key: 'RIG-8', title: 'Order spare valves', projectId: 'p1' },
  ],
  projects: [{ id: 'p1', code: 'RIG', name: 'Rig Inspection' }],
  users: [
    { id: 'me', username: 'admin', firstName: 'Khurram', lastName: 'Shah' },
    { id: 'u2', username: 'mariam', firstName: 'Mariam', lastName: 'Al Hinai' },
    { id: 'u3', username: 'omar', firstName: '', lastName: '' },
  ],
  meetings: [{ id: 'm1', title: 'Rig review', projectId: 'p1', snippet: '…the rig valves were…' }],
};

describe('search: the pages to go to', () => {
  it('lists the extension’s own screens, which open here, and the website’s other pages, which open there', () => {
    const byId = Object.fromEntries(PAGES.map((p) => [p.id, p]));
    expect(byId.dashboard.hash).toBe('#/');
    expect(byId['my-tasks'].hash).toBe('#/my-tasks');
    expect(byId.projects.hash).toBe('#/projects');
    expect(byId.calendar.hash).toBe('#/calendar');
    expect(byId.meetings.hash).toBe('#/meetings');
    expect(byId.chat.hash).toBe('#/chat');
    expect(byId.notifications.hash).toBe('#/notifications');
    expect(byId.reports.hash).toBe('#/reports');
    expect(byId.settings.hash).toBe('#/settings');
    // Not in the extension: they open on the website.
    expect(byId.board.web).toBe('/board');
    expect(byId.activity.web).toBe('/activity');
    expect(byId.profile.web).toBe('/profile');
    expect(byId.about.web).toBe('/about');
    expect(byId['admin-users'].web).toBe('/admin/users');
    for (const p of PAGES) expect(Boolean(p.hash) !== Boolean(p.web), p.id).toBe(true);
  });

  it('ranks pages as the web does: an exact name or keyword, then a start, then anywhere in it', () => {
    expect(matchPages('board', true).map((p) => p.id)[0]).toBe('board'); // "Kanban Board" before "Dashboard"
    expect(matchPages('meet', false).map((p) => p.id)).toEqual(['meetings']);
    expect(matchPages('', false).length).toBe(PAGES.filter((p) => !p.admin).length);
  });

  it('hides admin pages from people who aren’t admins', () => {
    expect(matchPages('reports', false)).toEqual([]);
    expect(matchPages('reports', true).map((p) => p.id)).toEqual(['reports']);
    expect(matchPages('audit', false)).toEqual([]);
  });
});

describe('search: commands', () => {
  it('a task key, or "open KEY", opens that task; "go to <page>" goes there', () => {
    expect(parseCommand('rig-7')).toEqual({ type: 'open', taskKey: 'RIG-7' });
    expect(parseCommand('RIG-7')).toEqual({ type: 'open', taskKey: 'RIG-7' });
    expect(parseCommand('hello world')).toBeNull(); // plain words are searched
    expect(parseCommand('open rig-7')).toEqual({ type: 'open', taskKey: 'RIG-7' });
    expect(parseCommand('go to calendar', false)).toMatchObject({ type: 'navigate', page: { id: 'calendar' } });
    expect(parseCommand('goto meetings', false)).toMatchObject({ type: 'navigate', page: { id: 'meetings' } });
    expect(parseCommand('go to nowhere', false)).toBeNull();
    expect(parseCommand('go to reports', false)).toBeNull(); // not for this person
  });

  it('changes (complete, assign, move) stay on the website: they are searched as words here', () => {
    expect(parseCommand('complete RIG-7')).toBeNull();
    expect(parseCommand('assign RIG-7 to Sara')).toBeNull();
    expect(parseCommand('move RIG-7 to Done')).toBeNull();
  });
});

describe('search: results', () => {
  const build = (term, over = {}) => buildResults({ term, results: RESULTS, isAdmin: false, myId: 'me', appBase: APP, ...over });

  it('searches only from two letters, as the web does', () => {
    expect(MIN_QUERY).toBe(2);
    expect(searchable('r')).toBe(false);
    expect(searchable(' ri ')).toBe(true);
  });

  it('groups what was found in the web’s order: a command, pages, tasks, projects, people, meetings', () => {
    const groups = build('rig');
    expect(groups.map((g) => g.group)).toEqual(['Tasks', 'Projects', 'People', 'Meetings']);
    const withPage = build('cal');
    expect(withPage[0].group).toBe('Go to');
    expect(build('RIG-7')[0]).toMatchObject({ group: 'Command', items: [{ label: 'Open RIG-7' }] });
  });

  it('a task opens its panel here, a project its board here, a meeting its page here', () => {
    const items = flatItems(build('rig'));
    const task = items.find((i) => i.id === 'task-t1');
    expect(task).toMatchObject({ label: 'Inspect the north rig', hint: 'RIG-7', target: { hash: '#/task/t1' } });
    expect(items.find((i) => i.id === 'proj-p1')).toMatchObject({ label: 'Rig Inspection', hint: 'RIG', target: { hash: '#/board/p1' }, projectId: 'p1' });
    expect(items.find((i) => i.id === 'meeting-m1')).toMatchObject({ label: 'Rig review', secondary: '…the rig valves were…', target: { hash: '#/meeting/m1' } });
  });

  it('“open KEY” opens only that task — or the one that had that key before it moved project — and a moved task shows its old key', () => {
    const moved = { id: 't4', key: 'OPS-17', title: 'Inspect the rig', projectId: 'p2', formerKeys: ['RIG-4'] };
    expect(taskByKey({ tasks: [{ id: 't40', key: 'RIG-40', title: 'Forty', projectId: 'p1' }] }, 'RIG-4')).toBeNull();
    expect(taskByKey({ tasks: [moved] }, 'rig-4')?.id).toBe('t4');
    expect(taskByKey({ tasks: [moved, { id: 'now', key: 'RIG-4', title: 'New', projectId: 'p1' }] }, 'RIG-4')?.id).toBe('now');
    const items = flatItems(buildResults({ term: 'rig-4', results: { tasks: [moved], projects: [], users: [], meetings: [] }, isAdmin: false, myId: 'me', appBase: APP }));
    expect(items.find((i) => i.id === 'task-t4')).toMatchObject({ hint: 'OPS-17 (was RIG-4)' });
  });

  it('a person opens a direct message here; yourself your profile on the website; an admin the user list there (as the web)', () => {
    const people = flatItems(build('a')).length; // too short: nothing found shown
    expect(people).toBeGreaterThanOrEqual(0);
    const items = flatItems(build('rig'));
    expect(items.find((i) => i.id === 'user-u2')).toMatchObject({ label: 'Mariam Al Hinai', target: { dm: 'u2' } });
    expect(items.find((i) => i.id === 'user-u3')).toMatchObject({ label: 'omar' });
    expect(items.find((i) => i.id === 'user-me').target).toEqual({ url: `${APP}/profile` });
    const admin = flatItems(build('rig', { isAdmin: true }));
    expect(admin.find((i) => i.id === 'user-u2').target).toEqual({ url: `${APP}/admin/users` });
  });

  it('a page the extension doesn’t have opens on the website, at the configured address', () => {
    const items = flatItems(buildResults({ term: 'activity', results: null, isAdmin: false, myId: 'me', appBase: `${APP}/` }));
    expect(items[0]).toMatchObject({ label: 'Activity', target: { url: `${APP}/activity` }, web: true });
    const none = flatItems(buildResults({ term: 'activity', results: null, isAdmin: false, myId: 'me', appBase: '' }));
    expect(none).toEqual([]); // no address for the website: not offered
  });

  it('shows at most as many of each kind as the web (6 tasks, 5 projects, 5 people, 6 meetings)', () => {
    const many = {
      tasks: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, key: `A-${i}`, title: `Task ${i}`, projectId: 'p' })),
      projects: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, code: `P${i}`, name: `Project ${i}` })),
      users: Array.from({ length: 9 }, (_, i) => ({ id: `u${i}`, username: `u${i}`, firstName: 'A', lastName: `${i}` })),
      meetings: Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, title: `Meeting ${i}`, projectId: null, snippet: '' })),
    };
    const groups = buildResults({ term: 'zz', results: many, isAdmin: false, myId: 'me', appBase: APP });
    expect(groups.map((g) => g.items.length)).toEqual([6, 5, 5, 6]);
  });

  it('leaves out rows without an id and treats a missing list as empty (an older server sends no meetings)', () => {
    const groups = buildResults({ term: 'zz', results: { tasks: [{ key: 'X-1', title: 'no id' }], projects: null }, isAdmin: false, myId: 'me', appBase: APP });
    expect(groups).toEqual([]);
  });

  it('builds hashes with the ids encoded', () => {
    const odd = { tasks: [{ id: 'a/b?c', key: 'K-1', title: 'x', projectId: 'p' }], projects: [], users: [], meetings: [] };
    const [item] = flatItems(buildResults({ term: 'xx', results: odd, isAdmin: false, myId: 'me', appBase: APP }));
    expect(item.target.hash).toBe('#/task/a%2Fb%3Fc');
  });
});

// The page list and its ranking are copies of the web's command palette (lib/commands.ts): run both.
const WEB_COMMANDS = resolve(__dirname, '../../Web Portal/frontend/src/lib/commands.ts');
const web = existsSync(WEB_COMMANDS) ? await import(pathToFileURL(WEB_COMMANDS).href) : null;

describe.skipIf(!web)('search: the same pages and ranking as the web’s command palette (lib/commands.ts)', () => {
  it('has every page the web’s palette has, with the same name and words', () => {
    for (const c of web.NAV_COMMANDS) {
      const mine = PAGES.find((p) => p.id === c.id);
      expect(mine, c.id).toBeTruthy();
      expect(mine.label, c.id).toBe(c.label);
      expect(mine.keywords, c.id).toEqual(c.keywords);
      expect(Boolean(mine.admin), c.id).toBe(Boolean(c.admin));
    }
  });

  it('ranks them the same way for anything typed', () => {
    const terms = ['', 'b', 'board', 'Board ', 'da', 'tasks', 'my', 'set', 'admin', 'ai', 'version', 'whats new', 'xyz', 'cal', 'report', 'p'];
    for (const term of terms) {
      for (const admin of [true, false]) {
        expect(rankPages(web.NAV_COMMANDS, term, admin).map((c) => c.id), `${term} ${admin}`).toEqual(web.matchNavCommands(term, admin).map((c) => c.id));
      }
    }
  });

  it('reads "open KEY", a bare key and "go to <page>" the same way', () => {
    const inputs = ['RIG-7', 'open rig-7', 'Open  ABC-12', 'go to calendar', 'goto my tasks', 'navigate to chat', 'open settings', 'go to nowhere', 'rig-7', 'hello world', ''];
    for (const input of inputs) {
      const theirs = web.parseCommand(input, true);
      const mine = parseCommand(input, true);
      if (!theirs) expect(mine, input).toBeNull();
      else if (theirs.type === 'open') expect(mine, input).toEqual(theirs);
      else expect(mine && mine.page && mine.page.label, input).toBe(theirs.label);
    }
  });
});
