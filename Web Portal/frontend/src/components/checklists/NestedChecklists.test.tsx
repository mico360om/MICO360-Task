import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NestedChecklists, type ChecklistActions } from './NestedChecklists';
import type { CLItem, CLList } from '../../lib/checklist-tree';
import { useAuthStore } from '../../stores/auth-store';

const LISTS: CLList[] = [
  { id: 'L1', title: 'Electrical' },
  { id: 'L2', title: 'Plumbing' },
];
const item = (id: string, listId: string, parentId: string | null, text: string, done = false, extra: Partial<CLItem> = {}): CLItem => ({ id, listId, parentId, text, done, ...extra });
const ITEMS: CLItem[] = [
  item('a', 'L1', null, 'Wiring'),
  item('a1', 'L1', 'a', 'Label circuits', true, { assignee: { id: 'u2', name: 'Omar Ahmed' }, dueDate: '2026-11-03' }),
  item('a2', 'L1', 'a', 'Test breakers', false, { dueDate: '2027-01-09' }),
  item('b', 'L1', null, 'Lights', true),
  item('c', 'L2', null, 'Pipes'),
];
const PEOPLE = [
  { id: 'u1', name: 'Khurram' },
  { id: 'u2', name: 'Omar Ahmed' },
];

const card = (title: string) => screen.getAllByTestId('checklist-card').find((c) => within(c).queryByRole('heading', { name: title }))!;
const row = (text: string) => screen.getAllByTestId('checklist-item').find((li) => li.querySelector(':scope > [data-row]')?.textContent?.includes(text))!;
const openMenu = async (text: string) => userEvent.click(screen.getByRole('button', { name: `More actions for “${text}”` }));

function panel(actions: ChecklistActions = {}, extra: Partial<Parameters<typeof NestedChecklists>[0]> = {}) {
  return render(<NestedChecklists lists={LISTS} items={ITEMS} actions={actions} people={PEOPLE} today="2026-11-06" mode="panel" {...extra} />);
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('NestedChecklists: what the task panel shows', () => {
  it('the overall line, each checklist with its own count and bar, and items nested under their parents', () => {
    panel({ toggle: vi.fn() });
    expect(screen.getByRole('heading', { name: 'Checklists' })).toBeInTheDocument();
    expect(screen.getByText('2/4 completed')).toBeInTheDocument();
    const electrical = card('Electrical');
    expect(within(electrical).getByText('2/3')).toBeInTheDocument();
    expect(within(electrical).getByRole('progressbar', { name: 'Progress of “Electrical”' })).toHaveAttribute('aria-valuenow', '67');
    expect(row('Label circuits')).toHaveAttribute('data-depth', '1');
    expect(row('Wiring')).toHaveAttribute('data-depth', '0');
    // A parent shows how many of its sub-items are done.
    expect(within(row('Wiring')).getAllByText('1/2')[0]).toBeInTheDocument();
    expect(within(row('Wiring')).getByText('1 of 2 sub-items done')).toHaveClass('sr-only');
    // The person and the due date, when set ("3 Nov" this year, with the year otherwise).
    expect(within(row('Label circuits')).getByRole('img', { name: 'Omar Ahmed' })).toBeInTheDocument();
    expect(within(row('Label circuits')).getByText('3 Nov')).toBeInTheDocument();
    expect(within(row('Test breakers')).getByText('9 Jan 2027')).toBeInTheDocument();
  });

  it('indents 20 px a level up to four, then keeps the fourth indent with a guide line', () => {
    const deep: CLItem[] = [];
    let parent: string | null = null;
    for (let d = 0; d < 7; d++) {
      deep.push(item(`d${d}`, 'L1', parent, `Level ${d + 1}`));
      parent = `d${d}`;
    }
    render(<NestedChecklists lists={[LISTS[0]!]} items={deep} actions={{}} mode="panel" today="2026-11-06" />);
    const pad = (text: string) => (row(text).querySelector('[data-row]') as HTMLElement).style.paddingInlineStart;
    expect(['Level 1', 'Level 2', 'Level 5', 'Level 7'].map(pad)).toEqual(['0px', '20px', '80px', '80px']);
    expect(row('Level 7').querySelector('[data-guide]')).not.toBeNull();
    expect(row('Level 4').querySelector(':scope > [data-row] [data-guide]')).toBeNull();
  });
});

describe('NestedChecklists: ticks', () => {
  it('ticks a leaf at once and puts it back when the save fails', async () => {
    let reject: (e: Error) => void = () => {};
    const toggle = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
    panel({ toggle });
    const box = screen.getByRole('checkbox', { name: 'Test breakers' });
    await userEvent.click(box);
    expect(toggle).toHaveBeenCalledWith('a2', true);
    expect(box).toBeChecked();
    // The parent follows its sub-items at once too.
    expect(screen.getByRole('checkbox', { name: 'Wiring' })).toBeChecked();
    await act(async () => reject(new Error('You don’t have permission to do that.')));
    expect(box).not.toBeChecked();
    expect(within(card('Electrical')).getByRole('alert')).toHaveTextContent('You don’t have permission to do that.');
  });

  it('a parent with sub-items still open can’t be ticked by hand: it says how many are open and changes nothing', async () => {
    const toggle = vi.fn();
    panel({ toggle });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Wiring' }));
    expect(toggle).not.toHaveBeenCalled();
    expect(within(row('Wiring')).getByRole('status')).toHaveTextContent('1 sub-item still open');
    expect(screen.getByRole('checkbox', { name: 'Wiring' })).not.toBeChecked();
  });

  it('shows the server’s refusal of a parent tick (400 CHECKLIST_PARENT) and puts the tick back', async () => {
    const toggle = vi.fn().mockRejectedValue(new Error('2 sub-items still open'));
    panel({ toggle });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pipes' }));
    await waitFor(() => expect(within(card('Plumbing')).getByRole('alert')).toHaveTextContent('2 sub-items still open'));
    expect(screen.getByRole('checkbox', { name: 'Pipes' })).not.toBeChecked();
  });
});

describe('NestedChecklists: expand and collapse', () => {
  it('collapses a parent (its count stays) and remembers it for this person and task', async () => {
    useAuthStore.setState({ user: { id: 'me' } as never });
    const { unmount } = panel({}, { memoryKey: 't1' });
    await userEvent.click(screen.getByRole('button', { name: 'Collapse “Wiring”' }));
    expect(screen.queryByText('Label circuits')).toBeNull();
    expect(within(row('Wiring')).getAllByText('1/2')[0]).toBeInTheDocument();
    unmount();
    panel({}, { memoryKey: 't1' });
    expect(screen.queryByText('Label circuits')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand “Wiring”' })).toHaveAttribute('aria-expanded', 'false');
    // Another task: its own.
    render(<NestedChecklists lists={LISTS} items={ITEMS} actions={{}} mode="panel" today="2026-11-06" memoryKey="t2" />);
    expect(screen.getAllByText('Label circuits')).toHaveLength(1);
    useAuthStore.setState({ user: null });
  });

  it('Collapse all / Expand all from a checklist’s menu', async () => {
    panel({});
    await userEvent.click(within(card('Electrical')).getByRole('button', { name: 'Actions for the checklist “Electrical”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Collapse all' }));
    expect(screen.queryByText('Label circuits')).toBeNull();
    await userEvent.click(within(card('Electrical')).getByRole('button', { name: 'Actions for the checklist “Electrical”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Expand all' }));
    expect(screen.getByText('Label circuits')).toBeInTheDocument();
  });
});

describe('NestedChecklists: writing items with the keyboard', () => {
  it('Enter in an item saves it and starts the next one at the same level; Enter there adds it', async () => {
    const rename = vi.fn(async () => {});
    const addItem = vi.fn(async () => 'new1');
    panel({ rename, addItem });
    await userEvent.click(screen.getByRole('button', { name: 'Edit “Label circuits”' }));
    const input = screen.getByRole('textbox', { name: 'Checklist item' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Label every circuit{Enter}');
    expect(rename).toHaveBeenCalledWith('a1', 'Label every circuit');
    const next = await screen.findByRole('textbox', { name: 'New item after “Label circuits”' });
    expect(next).toHaveFocus();
    await userEvent.type(next, 'Check sockets{Enter}');
    expect(addItem).toHaveBeenCalledWith({ listId: 'L1', parentId: 'a', afterId: 'a1' }, 'Check sockets');
  });

  it('Tab and Shift+Tab indent and outdent the item being edited; Esc drops the edit', async () => {
    const move = vi.fn(async () => {});
    const rename = vi.fn(async () => {});
    panel({ move, rename });
    await userEvent.click(screen.getByRole('button', { name: 'Edit “Lights”' }));
    await userEvent.keyboard('{Tab}');
    expect(move).toHaveBeenLastCalledWith('b', 'indent');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    // Lights is at the top level: nothing to outdent — Shift+Tab is left to move focus on.
    expect(move).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Edit “Test breakers”' }));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(move).toHaveBeenLastCalledWith('a2', 'outdent');
    await userEvent.type(screen.getByRole('textbox', { name: 'Checklist item' }), ' later{Escape}');
    expect(rename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Checklist item' })).toBeNull();
  });

  it('adds at the end of a checklist from its own box; pasted lines become items in one go', async () => {
    const addItem = vi.fn(async () => 'x');
    const addItems = vi.fn(async () => {});
    panel({ addItem, addItems });
    const box = within(card('Plumbing')).getByRole('textbox', { name: 'Add an item to “Plumbing”' });
    await userEvent.type(box, 'Drains{Enter}');
    expect(addItem).toHaveBeenCalledWith({ listId: 'L2', parentId: null, afterId: null }, 'Drains');
    expect(box).toHaveValue('');
    box.focus();
    await userEvent.paste('Taps\nBoiler\n');
    expect(addItems).toHaveBeenCalledWith({ listId: 'L2', parentId: null, afterId: null }, ['Taps', 'Boiler']);
  });
});

describe('NestedChecklists: an item’s menu', () => {
  it('adds a sub-item, duplicates, and moves among its siblings', async () => {
    const addItem = vi.fn(async () => 'n1');
    const duplicate = vi.fn(async () => {});
    const move = vi.fn(async () => {});
    panel({ addItem, duplicate, move });
    await openMenu('Lights');
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent);
    // First at the top level? No: Lights is second — it can go up and in, not out or down.
    expect(items).toEqual(['Add sub-item', 'Duplicate', 'Indent', 'Move up']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add sub-item' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New sub-item of “Lights”' }), 'Hall{Enter}');
    expect(addItem).toHaveBeenCalledWith({ listId: 'L1', parentId: 'b', afterId: null }, 'Hall');
    await openMenu('Lights');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(duplicate).toHaveBeenCalledWith('b');
    await openMenu('Lights');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(move).toHaveBeenCalledWith('b', 'up');
  });

  it('the menu works from the keyboard: arrows move, Escape closes it back to its button', async () => {
    panel({ duplicate: vi.fn(), move: vi.fn() });
    const button = screen.getByRole('button', { name: 'More actions for “Wiring”' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getAllByRole('menuitem')[1]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('assigns an item to someone on the team, and sets its due date', async () => {
    const assign = vi.fn(async () => {});
    const setDue = vi.fn(async () => {});
    panel({ assign, setDue });
    await openMenu('Lights');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Assign…' }));
    const who = screen.getByRole('combobox', { name: 'Who is “Lights” for?' });
    expect(who).toHaveFocus();
    await userEvent.type(who, 'kh{Enter}');
    expect(assign).toHaveBeenCalledWith('b', 'u1');
    // Someone already on it: changed from its face, or taken off.
    await userEvent.click(within(row('Label circuits')).getByRole('button', { name: 'For Omar Ahmed — change who it’s for' }));
    await userEvent.click(screen.getByRole('option', { name: 'No one' }));
    expect(assign).toHaveBeenLastCalledWith('a1', null);
    await openMenu('Lights');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Due date…' }));
    const day = screen.getByLabelText('Due date for “Lights”');
    fireEvent.change(day, { target: { value: '2026-11-20' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save the due date' }));
    expect(setDue).toHaveBeenCalledWith('b', '2026-11-20');
    await userEvent.click(within(row('Label circuits')).getByRole('button', { name: 'Due 3 Nov — change the due date' }));
    await userEvent.click(screen.getByRole('button', { name: 'No due date' }));
    expect(setDue).toHaveBeenLastCalledWith('a1', null);
  });
});

describe('NestedChecklists: deleting safely', () => {
  it('deletes an item with no sub-items at once, with Undo', async () => {
    const remove = vi.fn(async () => ({ batchId: 'b1', count: 1, taskId: 't1' }));
    const restore = vi.fn(async () => {});
    panel({ remove, restore });
    await openMenu('Lights');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('b');
    const notice = await screen.findByTestId('checklist-undo');
    expect(notice).toHaveTextContent('Deleted “Lights”.');
    const undo = within(notice).getByRole('button', { name: 'Undo' });
    expect(undo).toHaveFocus();
    await userEvent.click(undo);
    expect(restore).toHaveBeenCalledWith('b1');
  });

  it('asks first before deleting an item with sub-items, or a whole checklist', async () => {
    const remove = vi.fn(async () => ({ batchId: 'b2', count: 3, taskId: 't1' }));
    const removeList = vi.fn(async () => ({ batchId: 'b3', count: 4, taskId: 't1' }));
    panel({ remove, removeList, restore: vi.fn() });
    await openMenu('Wiring');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    const ask = screen.getByRole('alertdialog', { name: 'Delete “Wiring” and its 2 sub-items?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('a');
    expect(await screen.findByTestId('checklist-undo')).toHaveTextContent('Deleted “Wiring” and its 2 sub-items.');

    await userEvent.click(within(card('Electrical')).getByRole('button', { name: 'Actions for the checklist “Electrical”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const askList = screen.getByRole('alertdialog', { name: 'Delete the checklist “Electrical” and its 4 items?' });
    await userEvent.click(within(askList).getByRole('button', { name: 'Keep it' }));
    expect(removeList).not.toHaveBeenCalled();
  });
});

describe('NestedChecklists: whole checklists', () => {
  it('adds, renames and duplicates a checklist', async () => {
    const addList = vi.fn(async () => 'L3');
    const renameList = vi.fn(async () => {});
    const duplicateList = vi.fn(async () => {});
    panel({ addList, renameList, duplicateList });
    await userEvent.click(screen.getByRole('button', { name: 'Add checklist' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New checklist title' }), 'Handover{Enter}');
    expect(addList).toHaveBeenCalledWith('Handover', 'L2');
    await userEvent.click(within(card('Plumbing')).getByRole('button', { name: 'Actions for the checklist “Plumbing”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const title = screen.getByRole('textbox', { name: 'Checklist title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Plumbing works{Enter}');
    expect(renameList).toHaveBeenCalledWith('L2', 'Plumbing works');
    await userEvent.click(within(card('Plumbing')).getByRole('button', { name: 'Actions for the checklist “Plumbing”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(duplicateList).toHaveBeenCalledWith('L2');
  });

  it('a task with no checklists yet: one “Checklist” to add to straight away', async () => {
    const addItem = vi.fn(async () => 'x');
    render(<NestedChecklists lists={[]} items={[]} actions={{ addItem }} mode="panel" today="2026-11-06" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add an item to “Checklist”' }), 'First step{Enter}');
    expect(addItem).toHaveBeenCalledWith({ listId: '', parentId: null, afterId: null }, 'First step');
  });
});

describe('NestedChecklists: opened at an item (?item=)', () => {
  it('opens its parents, brings it into view and marks it', async () => {
    useAuthStore.setState({ user: { id: 'me' } as never });
    localStorage.setItem('mico360.u.me.checklist.collapsed.t1', JSON.stringify(['a']));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    panel({}, { memoryKey: 't1', focusItemId: 'a2' });
    await waitFor(() => expect(row('Test breakers')).toHaveAttribute('data-found', 'true'));
    expect(screen.getByRole('button', { name: 'Collapse “Wiring”' })).toHaveAttribute('aria-expanded', 'true');
    expect(scroll).toHaveBeenCalled();
    useAuthStore.setState({ user: null });
  });
});

describe('NestedChecklists: AI steps', () => {
  it('adds the chosen steps in one go to the first checklist, or the one asked from', async () => {
    const addItems = vi.fn(async () => {});
    const onSuggest = vi.fn().mockResolvedValue(['Collect figures', 'Draft report', 'Send for review']);
    panel({ addItems, addItem: vi.fn() }, { onSuggest });
    await userEvent.click(screen.getByRole('button', { name: /Suggest steps/ }));
    const review = await within(card('Electrical')).findByRole('group', { name: 'Suggested steps' });
    await userEvent.click(within(review).getByRole('checkbox', { name: 'Draft report' }));
    await userEvent.click(within(review).getByRole('button', { name: 'Add 2 steps' }));
    expect(addItems).toHaveBeenCalledWith({ listId: 'L1', parentId: null, afterId: null }, ['Collect figures', 'Send for review']);

    await userEvent.click(within(card('Plumbing')).getByRole('button', { name: 'Actions for the checklist “Plumbing”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Suggest steps (AI)' }));
    const second = await within(card('Plumbing')).findByRole('group', { name: 'Suggested steps' });
    await userEvent.click(within(second).getByRole('button', { name: 'Add 3 steps' }));
    expect(addItems).toHaveBeenLastCalledWith({ listId: 'L2', parentId: null, afterId: null }, ['Collect figures', 'Draft report', 'Send for review']);
  });
});

describe('NestedChecklists: as an editor (the New task form, templates)', () => {
  it('shows no ticks, counts or people — only the writing', () => {
    render(<NestedChecklists lists={LISTS} items={ITEMS} actions={{ rename: vi.fn(), addItem: vi.fn() }} mode="editor" />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Checklists' })).toBeNull();
    expect(screen.queryByText('3 Nov')).toBeNull();
  });

  it('keeps what is typed in an add box with the caller (so a form’s Create never loses it)', async () => {
    const onTypedChange = vi.fn();
    render(<NestedChecklists lists={LISTS} items={ITEMS} actions={{ addItem: vi.fn() }} mode="editor" typed={{}} onTypedChange={onTypedChange} />);
    await userEvent.type(within(card('Plumbing')).getByRole('textbox', { name: 'Add an item to “Plumbing”' }), 'D');
    expect(onTypedChange).toHaveBeenLastCalledWith({ 'L2||': 'D' });
  });
});

describe('NestedChecklists: merged tasks (1.23.1 → 1.23.3)', () => {
  it('a merged task’s whole checklist is titled "From MICO-14 · …"; its items don’t repeat it, while an older item-level label still shows', () => {
    const lists = [
      { id: 'L1', title: 'Checklist' },
      { id: 'L9', title: 'From MICO-14 · Checklist' },
    ];
    const items = [item('own', 'L1', null, 'Own step'), item('old', 'L1', null, 'Their old step'), item('m1', 'L9', null, 'Their step')];
    render(<NestedChecklists lists={lists} items={items} actions={{}} mode="panel" today="2026-11-06" fromKeys={{ old: 'MICO-14', m1: 'MICO-14' }} />);
    const headings = screen.getAllByTestId('checklist-from');
    expect(headings).toHaveLength(1);
    expect(within(card('Checklist')).getByTestId('checklist-from')).toHaveTextContent('From MICO-14');
    expect(within(card('From MICO-14 · Checklist')).queryByTestId('checklist-from')).toBeNull();
  });
});
