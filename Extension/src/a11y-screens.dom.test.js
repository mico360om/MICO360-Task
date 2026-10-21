// @vitest-environment jsdom
/**
 * Keyboard and screen-reader use: board cards open with Enter or Space and move with a "Move to…"
 * menu; the task drawer is a modal dialog (focus moves in, stays in, Escape closes it, and focus
 * goes back to the card that opened it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BoardScreen } from '../app/screens/board.js';
import { TaskDetail } from '../app/screens/task-detail.js';
import { showModal, returnFocus } from '../app/dialog.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, tag, text) => [...root.querySelectorAll(tag)].find((n) => n.textContent.trim() === text);
const key = (node, k, opts = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  node.dispatchEvent(e);
  return e;
};
const active = () => document.activeElement;

const releases = [];
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  while (releases.length) releases.pop()(); // as the app does when a drawer closes
  document.body.innerHTML = '';
});

const COLUMNS = [
  { id: 'c1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'c2', name: 'In progress', category: 'IN_PROGRESS', enabled: true, position: 1 },
  { id: 'c9', name: 'Done', category: 'DONE', enabled: true, position: 2 },
];

function boardCtx({ columns = COLUMNS, tasks } = {}) {
  return {
    params: { projectId: 'p1' },
    query: {},
    timeZone: TZ,
    api: {
      projects: {
        get: async () => ({ data: { name: 'Ops' } }),
        columns: async () => ({ data: columns }),
        progress: async () => ({ data: null }),
      },
      tasks: { list: vi.fn(async () => ({ data: tasks || [{ id: 't1', key: 'OPS-1', title: 'Existing', columnId: 'c1', priority: 'HIGH' }] })) },
    },
    navigate: vi.fn(),
    openTask: vi.fn(),
    write: vi.fn(async () => ({ queued: false, data: { id: 't1', version: 2 } })),
    afterMutation: vi.fn(),
  };
}

async function renderBoard(ctx) {
  const root = BoardScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const cardOf = (root, id) => [...root.querySelectorAll('.tcard')].find((c) => c.dataset.taskId === id);
const columnOf = (node) => node.closest('.column').querySelector('.cname').textContent;

describe('board cards from the keyboard', () => {
  it('a card is a button named after the task; Enter or Space opens it', async () => {
    const ctx = boardCtx();
    const root = await renderBoard(ctx);
    const card = cardOf(root, 't1');
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.getAttribute('aria-label')).toBe('Existing, OPS-1, High priority');
    expect(key(card, 'Enter').defaultPrevented).toBe(true);
    expect(ctx.openTask).toHaveBeenCalledWith('t1');
    const space = key(card, ' ');
    expect(space.defaultPrevented).toBe(true); // no page scroll
    expect(ctx.openTask).toHaveBeenCalledTimes(2);
    key(card, 'a');
    expect(ctx.openTask).toHaveBeenCalledTimes(2);
  });

  it('each card has a "Move to…" menu: it lists the other columns, and moving puts focus on the moved card', async () => {
    const ctx = boardCtx();
    const root = await renderBoard(ctx);
    const button = root.querySelector('[aria-haspopup="menu"]');
    expect(button.getAttribute('aria-label')).toBe('Move “Existing” to another column');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.focus();
    button.click();
    const menu = root.querySelector('[role="menu"]');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(menu.getAttribute('aria-label')).toBe('Move “Existing” to');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent.trim())).toEqual(['In progress', 'Done']);
    expect(active()).toBe(items[0]);
    key(items[0], 'ArrowDown');
    expect(active()).toBe(items[1]);
    key(items[1], 'ArrowDown');
    expect(active()).toBe(items[0]); // wraps
    key(items[0], 'End');
    expect(active()).toBe(items[1]);
    active().click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.move', { id: 't1', columnId: 'c9', position: 0, columnCategory: 'DONE' });
    expect(root.querySelector('[role="menu"]')).toBeNull();
    const moved = cardOf(root, 't1');
    expect(columnOf(moved)).toBe('Done');
    expect(active()).toBe(moved);
    expect(root.querySelector('[role="status"][aria-live="polite"]').textContent).toBe('Moved “Existing” to Done.');
  });

  it('Escape closes the menu and puts focus back on its button; so does Tab, without trapping', async () => {
    const root = await renderBoard(boardCtx());
    const button = root.querySelector('[aria-haspopup="menu"]');
    button.focus();
    key(button, 'ArrowDown'); // opens it from the keyboard too
    let menu = root.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    const esc = key(active(), 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(active()).toBe(button);

    key(button, 'ArrowUp'); // opens on the last item
    menu = root.querySelector('[role="menu"]');
    expect(active().textContent.trim()).toBe('Done');
    const tab = key(active(), 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

  it('a click elsewhere closes the menu', async () => {
    const root = await renderBoard(boardCtx());
    root.querySelector('[aria-haspopup="menu"]').click();
    expect(root.querySelector('[role="menu"]')).toBeTruthy();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

  it('focus stays on the card when completing a repeating task reloads the board (its next copy appears)', async () => {
    const ctx = boardCtx();
    let calls = 0;
    ctx.api.tasks.list = vi.fn(async () => {
      calls += 1;
      const first = { id: 't1', key: 'OPS-1', title: 'Daily check', columnId: calls === 1 ? 'c1' : 'c9', priority: 'NORMAL', recurrenceRule: calls === 1 ? { freq: 'DAILY', interval: 1 } : null };
      return { data: calls === 1 ? [first] : [first, { id: 't2', key: 'OPS-2', title: 'Daily check', columnId: 'c1', priority: 'NORMAL', recurrenceRule: { freq: 'DAILY', interval: 1 } }] };
    });
    const root = await renderBoard(ctx);
    root.querySelector('[aria-haspopup="menu"]').click();
    byText(root, '[role="menuitem"]', 'Done').click();
    await settle();
    expect(ctx.api.tasks.list).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('.tcard')).toHaveLength(2);
    expect(active()).toBe(cardOf(root, 't1'));
    expect(columnOf(active())).toBe('Done');
  });

  it('a redraw keeps focus on the card that had it', async () => {
    const ctx = boardCtx();
    ctx.write = vi.fn(async () => ({ queued: true, item: { id: 'q1' } })); // saved on this device: the board redraws with a note
    const root = await renderBoard(ctx);
    root.querySelector('[aria-haspopup="menu"]').click();
    byText(root, '[role="menuitem"]', 'In progress').click();
    await settle();
    expect(root.textContent).toContain('Saved on this device');
    expect(active()).toBe(cardOf(root, 't1'));
  });

  it('a board with one column has nowhere to move to, so no menu', async () => {
    const root = await renderBoard(boardCtx({ columns: [COLUMNS[0]] }));
    expect(root.querySelector('.tcard')).toBeTruthy();
    expect(root.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it('a task still waiting to sync can’t be moved yet, and says so', async () => {
    const ctx = boardCtx({ tasks: [{ id: 'tmp-q1', title: 'Offline one', columnId: 'c1', priority: 'NORMAL', pending: true }] });
    const root = await renderBoard(ctx);
    root.querySelector('[aria-haspopup="menu"]').click();
    byText(root, '[role="menuitem"]', 'Done').click();
    await settle();
    expect(ctx.write).not.toHaveBeenCalled();
    expect(root.textContent).toContain('still waiting to sync');
  });
});

function drawerCtx(task = {}) {
  return {
    params: { taskId: 't1' },
    me: { id: 'u1', name: 'Me', email: '' },
    timeZone: TZ,
    isOnline: () => true,
    api: {
      tasks: {
        get: async () => ({ data: { id: 't1', key: 'OPS-1', title: 'Report', priority: 'NORMAL', version: 3, ...task } }),
        assignees: async () => ({ data: [] }),
        checklist: async () => ({ data: { items: [], done: 0, total: 0 } }),
        comments: async () => ({ data: [] }),
      },
      directory: async () => ({ data: [] }),
    },
    write: vi.fn(async () => ({ queued: false, data: { id: 't1', version: 4 } })),
    afterMutation: vi.fn(),
  };
}

/** The app shell, the task drawer over it, shown as the app does (app/app.js). */
async function openDrawer(ctx = drawerCtx()) {
  const app = document.createElement('div');
  app.id = 'app';
  const opener = document.createElement('button');
  opener.textContent = 'Card';
  app.append(opener);
  document.body.append(app);
  opener.focus();
  const onClose = vi.fn();
  const overlay = TaskDetail(ctx, onClose);
  document.body.append(overlay);
  const release = showModal(overlay, { onEscape: onClose });
  releases.push(release);
  await settle();
  return { app, opener, overlay, dialog: overlay.querySelector('[role="dialog"]'), onClose, release, ctx };
}

describe('the task drawer is a modal dialog', () => {
  it('is a labelled modal dialog; focus moves into it and the page behind is inert', async () => {
    const { app, dialog, overlay } = await openDrawer();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Task OPS-1: Report');
    expect(overlay.querySelector('.scrim').getAttribute('aria-hidden')).toBe('true');
    expect(active()).toBe(dialog);
    expect(app.hasAttribute('inert')).toBe(true);
    expect(overlay.hasAttribute('inert')).toBe(false);
  });

  it('Tab and Shift+Tab stay inside it', async () => {
    const { dialog } = await openDrawer();
    const close = dialog.querySelector('[aria-label="Close"]');
    // From the dialog itself (where focus lands): Tab → the first control, Shift+Tab → the last.
    expect(key(dialog, 'Tab').defaultPrevented).toBe(true);
    const first = active();
    expect(dialog.contains(first)).toBe(true);
    dialog.focus();
    key(dialog, 'Tab', { shiftKey: true });
    const last = active();
    expect(last.textContent.trim()).toBe('Post');
    expect(key(last, 'Tab').defaultPrevented).toBe(true);
    expect(active()).toBe(first);
    expect(key(first, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(active()).toBe(last);
    // In the middle, Tab is left to the browser.
    close.focus();
    expect(dialog.contains(close)).toBe(true);
  });

  it('Escape closes it, saving a title being typed first', async () => {
    const { dialog, onClose, ctx } = await openDrawer();
    const title = dialog.querySelector('input[aria-label="Task title"]');
    title.focus();
    title.value = 'Report v2';
    key(title, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.update', { id: 't1', patch: { title: 'Report v2' }, expectedVersion: 3 });
  });

  it('focus stays on the same control when the drawer redraws after a change', async () => {
    const { dialog } = await openDrawer();
    const high = byText(dialog, 'button', 'High');
    high.focus();
    high.click(); // the drawer redraws: this button is replaced
    await settle();
    expect(high.isConnected).toBe(false);
    expect(active()).not.toBe(high);
    expect(active().textContent.trim()).toBe('High');
    expect(dialog.contains(active())).toBe(true);
  });

  it('Tab after editing the title goes on to the next control, though saving the title redraws the drawer', async () => {
    const { dialog, ctx } = await openDrawer();
    const title = dialog.querySelector('input[aria-label="Task title"]');
    title.focus();
    title.value = 'Report v2';
    expect(key(title, 'Tab').defaultPrevented).toBe(false); // not at an end: the browser moves focus…
    title.blur(); // …which blurs the title: it saves, and the drawer redraws under it
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.update', { id: 't1', patch: { title: 'Report v2' }, expectedVersion: 3 });
    expect(active().textContent.trim()).toBe('Low'); // the priority chip after the title
    expect(dialog.contains(active())).toBe(true);
  });

  it('releasing it gives the page back', async () => {
    const { app, release } = await openDrawer();
    release();
    expect(app.hasAttribute('inert')).toBe(false);
  });

  it('Tab between a date’s own parts (day, month, year) keeps focus on the date when typing it saves and redraws', async () => {
    const draw = () => [
      Object.assign(document.createElement('input'), { type: 'date' }),
      document.createElement('select'),
    ];
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    const [date, repeat] = draw();
    date.setAttribute('aria-label', 'Due date');
    repeat.setAttribute('aria-label', 'Repeat');
    panel.append(date, repeat);
    document.body.append(panel);
    releases.push(showModal(panel));
    date.focus();
    key(date, 'Tab'); // the browser moves to the date's next part: focus stays on the date input
    await settle();
    // Typing the day completes the date: it saves, and the drawer is drawn again.
    const [date2, repeat2] = draw();
    date2.setAttribute('aria-label', 'Due date');
    repeat2.setAttribute('aria-label', 'Repeat');
    panel.replaceChildren(date2, repeat2);
    await settle();
    expect(active()).toBe(date2);
  });
});

describe('returnFocus (closing the drawer)', () => {
  it('focuses the card again once the screen under it is drawn again', async () => {
    const content = document.createElement('div');
    document.body.append(content);
    const old = document.createElement('div');
    old.dataset.taskId = 't1';
    returnFocus(content, { el: old, taskId: 't1' }); // the old card is gone: wait for the new one
    const card = document.createElement('div');
    card.tabIndex = 0;
    card.dataset.taskId = 't1';
    content.append(card);
    await settle();
    expect(active()).toBe(card);
  });

  it('leaves focus alone when the person has moved on meanwhile', async () => {
    const content = document.createElement('div');
    const elsewhere = document.createElement('button');
    document.body.append(content, elsewhere);
    returnFocus(content, { taskId: 't1' });
    elsewhere.focus();
    const card = document.createElement('div');
    card.tabIndex = 0;
    card.dataset.taskId = 't1';
    content.append(card);
    await settle();
    expect(active()).toBe(elsewhere);
  });
});
