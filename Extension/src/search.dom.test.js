// @vitest-environment jsdom
/**
 * Stage 6: search, as the website's Ctrl+K — pages, a task by its key, and the tasks, projects,
 * people and meetings GET /search finds. What the extension has a screen for opens here; the rest
 * opens on the website. A combobox with a list of results, worked from the keyboard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchPanel, openSearch, isSearchShortcut } from '../app/search.js';
import { SearchScreen } from '../app/screens/search.js';
import { ApiError } from './errors.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const key = (node, k, extra = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  node.dispatchEvent(e);
  return e;
};
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const FOUND = {
  tasks: [
    { id: 't1', key: 'RIG-7', title: 'Inspect the north rig', projectId: 'p1' },
    { id: 't5', key: 'RIG-50', title: 'Paint the rig', projectId: 'p1' },
  ],
  projects: [{ id: 'p1', code: 'RIG', name: 'Rig Inspection' }],
  users: [{ id: 'u2', username: 'mariam', firstName: 'Mariam', lastName: 'Al Hinai' }],
  meetings: [{ id: 'm1', title: 'Rig review', projectId: 'p1', snippet: 'the rig valves' }],
};

function makeCtx(over = {}) {
  return {
    me: { id: 'me', roles: [] },
    appBase: 'https://task.mico360.com',
    apiBase: 'https://task.mico360.com/api/v1',
    query: {},
    params: {},
    navigate: vi.fn(),
    openExternal: vi.fn(),
    api: {
      search: vi.fn(async () => FOUND),
      projects: { list: vi.fn(async () => ({ data: [{ id: 'p1', name: 'Rig Inspection', color: '#0F766E', icon: 'oil' }] })) },
      chat: { startDirect: vi.fn(async () => ({ id: 'c9' })) },
    },
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

function panel(ctx = makeCtx(), opts = {}) {
  const p = SearchPanel(ctx, { debounceMs: 0, ...opts });
  document.body.append(p.node);
  return p;
}
const options = (root) => [...root.querySelectorAll('[role="option"]')];

describe('the search box', () => {
  it('is a combobox over a list of results, named for screen readers', () => {
    const { node, input } = panel();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-label')).toBe('Search');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    const list = node.querySelector('[role="listbox"]');
    expect(list).toBeTruthy();
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(input.getAttribute('placeholder')).toBe('Search tasks, projects, people, meetings…');
  });

  it('lists pages before anything is typed, and asks the server only from two letters', async () => {
    const ctx = makeCtx();
    const { node, input } = panel(ctx);
    await settle();
    expect(options(node).map((o) => o.dataset.itemId)).toEqual(['nav-dashboard', 'nav-my-tasks', 'nav-board', 'nav-projects', 'nav-calendar']);
    type(input, 'r');
    await settle();
    expect(ctx.api.search).not.toHaveBeenCalled();
    type(input, 'rig');
    await settle();
    expect(ctx.api.search).toHaveBeenCalledWith('rig');
  });

  it('shows what was found in groups, the web’s order, each group named', async () => {
    const { node, input } = panel();
    type(input, 'rig');
    await settle();
    const groups = [...node.querySelectorAll('[role="group"]')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Tasks', 'Projects', 'People', 'Meetings']);
    const task = node.querySelector('[data-item-id="task-t1"]');
    expect(task.textContent).toContain('RIG-7');
    expect(task.textContent).toContain('Inspect the north rig');
    const meeting = node.querySelector('[data-item-id="meeting-m1"]');
    expect(meeting.textContent).toContain('the rig valves');
    // The project shows its picture, as on the web.
    expect(node.querySelector('[data-item-id="proj-p1"] .pavatar')).toBeTruthy();
    expect(node.querySelector('[role="status"]').textContent).toBe('5 results');
  });

  it('arrows move through the results; Enter opens the one chosen', async () => {
    const ctx = makeCtx();
    const { node, input } = panel(ctx);
    type(input, 'rig');
    await settle();
    const first = options(node)[0];
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(key(input, 'ArrowDown').defaultPrevented).toBe(true);
    const second = options(node)[1];
    expect(input.getAttribute('aria-activedescendant')).toBe(second.id);
    expect(first.getAttribute('aria-selected')).toBe('false');
    key(input, 'ArrowUp');
    key(input, 'ArrowUp'); // stays on the first
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    // Home and End stay the text box's own (they move the caret).
    expect(key(input, 'End').defaultPrevented).toBe(false);
    key(input, 'Enter');
    expect(ctx.navigate).toHaveBeenCalledWith('#/task/t1');
  });

  it('a task opens its panel, a project its board and a meeting its page — here', async () => {
    const ctx = makeCtx();
    const { node, input } = panel(ctx);
    type(input, 'rig');
    await settle();
    node.querySelector('[data-item-id="proj-p1"]').click();
    expect(ctx.navigate).toHaveBeenLastCalledWith('#/board/p1');
    node.querySelector('[data-item-id="meeting-m1"]').click();
    expect(ctx.navigate).toHaveBeenLastCalledWith('#/meeting/m1');
  });

  it('a person opens a direct message with them here', async () => {
    const ctx = makeCtx();
    const { node, input } = panel(ctx);
    type(input, 'mar');
    await settle();
    node.querySelector('[data-item-id="user-u2"]').click();
    await settle();
    expect(ctx.api.chat.startDirect).toHaveBeenCalledWith('u2');
    expect(ctx.navigate).toHaveBeenCalledWith('#/chat/c9');
  });

  it('a page the extension doesn’t have opens on the website, and says so', async () => {
    const ctx = makeCtx();
    const { node, input } = panel(ctx);
    type(input, 'activity');
    await settle();
    const row = node.querySelector('[data-item-id="nav-activity"]');
    expect(row.textContent).toContain('opens on the website');
    row.click();
    expect(ctx.openExternal).toHaveBeenCalledWith('https://task.mico360.com/activity');
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  it('a task key opens exactly that task (never RIG-50 for RIG-5)', async () => {
    const ctx = makeCtx();
    const { node, input } = panel(ctx);
    type(input, 'RIG-7');
    await settle();
    expect(options(node)[0].textContent).toContain('Open RIG-7');
    key(input, 'Enter');
    await settle();
    expect(ctx.api.search).toHaveBeenLastCalledWith('RIG-7');
    expect(ctx.navigate).toHaveBeenCalledWith('#/task/t1');

    type(input, 'RIG-5');
    await settle();
    key(input, 'Enter');
    await settle();
    expect(ctx.navigate).toHaveBeenCalledTimes(1);
    expect(node.querySelector('[role="status"]').textContent).toBe('No task RIG-5.');
  });

  it('says when nothing matches', async () => {
    const ctx = makeCtx({ api: { ...makeCtx().api, search: vi.fn(async () => ({ tasks: [], projects: [], users: [], meetings: [] })) } });
    const { node, input } = panel(ctx);
    type(input, 'zzz');
    await settle();
    expect(node.textContent).toContain('No matches for “zzz”.');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('offline: says search needs a connection, and still lists pages', async () => {
    const ctx = makeCtx({ api: { ...makeCtx().api, search: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) } });
    const { node, input } = panel(ctx);
    type(input, 'cal');
    await settle();
    expect(node.textContent).toContain('You’re offline — search needs a connection.');
    expect(node.querySelector('[data-item-id="nav-calendar"]')).toBeTruthy();
  });

  it('shows the server’s own words when it refuses', async () => {
    const ctx = makeCtx({ api: { ...makeCtx().api, search: vi.fn(async () => { throw new ApiError(400, 'Search for fewer words.'); }) } });
    const { node, input } = panel(ctx);
    type(input, 'rig');
    await settle();
    expect(node.textContent).toContain('Search for fewer words.');
  });

  it('an older answer that arrives late doesn’t replace a newer one', async () => {
    let first;
    const ctx = makeCtx({
      api: {
        ...makeCtx().api,
        search: vi.fn((q) => (q === 'ri' ? new Promise((r) => { first = r; }) : Promise.resolve({ ...FOUND, tasks: [FOUND.tasks[1]] }))),
      },
    });
    const { node, input } = panel(ctx);
    type(input, 'ri');
    await settle();
    type(input, 'rig');
    await settle();
    first(FOUND);
    await settle();
    expect(node.querySelector('[data-item-id="task-t5"]')).toBeTruthy();
    expect(node.querySelector('[data-item-id="task-t1"]')).toBeNull();
  });

  it('keeps Arabic words in their own direction', async () => {
    const ctx = makeCtx({ api: { ...makeCtx().api, search: vi.fn(async () => ({ tasks: [{ id: 'ta', key: 'RIG-9', title: 'فحص المنصة', projectId: 'p1' }] })) } });
    const { node, input } = panel(ctx);
    expect(input.getAttribute('dir')).toBe('auto');
    type(input, 'فحص');
    await settle();
    expect(node.querySelector('[data-item-id="task-ta"] .search-label').getAttribute('dir')).toBe('auto');
  });
});

describe('Ctrl+K: the search dialog', () => {
  it('Ctrl+K and ⌘K open search; other keys don’t', () => {
    const ev = (o) => new KeyboardEvent('keydown', { key: 'k', ...o });
    expect(isSearchShortcut(ev({ ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(ev({ metaKey: true }))).toBe(true);
    expect(isSearchShortcut(new KeyboardEvent('keydown', { key: 'K', ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(ev({ ctrlKey: true, shiftKey: true }))).toBe(false); // Ctrl+Shift+K is "Add a task"
    expect(isSearchShortcut(ev({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSearchShortcut(ev({}))).toBe(false);
  });

  it('opens as a modal dialog with the box focused; Escape closes it and focus goes back', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const ctx = makeCtx();
    const close = openSearch(ctx);
    await settle();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Search');
    expect(document.activeElement).toBe(dialog.querySelector('[role="combobox"]'));
    key(document.activeElement, 'Escape');
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(typeof close).toBe('function');
  });

  it('opening a result closes the dialog first', async () => {
    const ctx = makeCtx();
    openSearch(ctx, { debounceMs: 0 });
    await settle();
    const input = document.querySelector('[role="combobox"]');
    type(input, 'rig');
    await settle();
    key(input, 'Enter');
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(ctx.navigate).toHaveBeenCalledWith('#/task/t1');
  });

  it('a click on the backdrop closes it', async () => {
    openSearch(makeCtx());
    await settle();
    document.querySelector('.search-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('the Search screen (the address bar’s “mico …” and “See all” lead here)', () => {
  it('searches for the words it was opened with, straight away', async () => {
    const ctx = makeCtx({ query: { q: 'rig' } });
    const root = SearchScreen(ctx);
    document.body.append(root);
    await settle();
    expect(root.querySelector('[role="combobox"]').value).toBe('rig');
    expect(ctx.api.search).toHaveBeenCalledWith('rig');
    expect(root.querySelector('[data-item-id="task-t1"]')).toBeTruthy();
  });
});
