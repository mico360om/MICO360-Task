import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  checklistCards,
  composerKey,
  draftAdd,
  draftAddList,
  draftDuplicate,
  draftDuplicateList,
  draftFromTexts,
  draftFromTree,
  draftMove,
  draftRemove,
  draftRemoveList,
  draftRename,
  draftRenameList,
  draftToTree,
  draftView,
  dueWords,
  emptyDraft,
  findNode,
  moveAvailability,
  overallCounts,
  treeItemCount,
  treeLeafCount,
  treeTexts,
  type CLItem,
  type ChecklistTree,
} from './checklist-tree';

const item = (id: string, listId: string, parentId: string | null, text: string, done = false, extra: Partial<CLItem> = {}): CLItem => ({ id, listId, parentId, text, done, ...extra });

// Electrical: Wiring (Label circuits ✓, Test breakers), Lights ✓ ; Plumbing: Pipes
const LISTS = [
  { id: 'L1', title: 'Electrical' },
  { id: 'L2', title: 'Plumbing' },
];
const ITEMS: CLItem[] = [
  item('a', 'L1', null, 'Wiring', false),
  item('a1', 'L1', 'a', 'Label circuits', true),
  item('a2', 'L1', 'a', 'Test breakers', false),
  item('b', 'L1', null, 'Lights', true),
  item('c', 'L2', null, 'Pipes', false),
];

describe('checklistCards: the server’s flat items as cards of nested items', () => {
  it('nests items under their parents, in order, with depths and leaf counts (a parent never counts itself)', () => {
    const cards = checklistCards(LISTS, ITEMS);
    expect(cards.map((c) => [c.list.title, c.done, c.total])).toEqual([
      ['Electrical', 2, 3],
      ['Plumbing', 0, 1],
    ]);
    const wiring = cards[0]!.roots[0]!;
    expect(wiring.children.map((n) => [n.item.text, n.depth])).toEqual([
      ['Label circuits', 1],
      ['Test breakers', 1],
    ]);
    expect([wiring.subDone, wiring.subTotal, wiring.done, wiring.descendants]).toEqual([1, 2, false, 2]);
    expect(overallCounts(cards)).toEqual({ done: 2, total: 4 });
  });

  it('a parent’s tick mirrors its sub-items: all done ticks it, whatever the server last said', () => {
    const cards = checklistCards(LISTS, ITEMS, { a2: true });
    expect(cards[0]!.roots[0]!.done).toBe(true);
    expect(cards[0]!.done).toBe(3);
    // …and one reopened unticks it again.
    const reopened = checklistCards(LISTS, ITEMS.map((i) => (i.id === 'a' ? { ...i, done: true } : i)));
    expect(reopened[0]!.roots[0]!.done).toBe(false);
  });

  it('a task with no checklists yet shows one “Checklist” card to add to (items from an older server too)', () => {
    expect(checklistCards([], [])).toEqual([expect.objectContaining({ list: { id: '', title: 'Checklist' }, implicit: true, roots: [] })]);
    const old = checklistCards([], [{ id: 'x', text: 'Old item', done: true } as unknown as CLItem]);
    expect(old[0]!.roots.map((n) => n.item.text)).toEqual(['Old item']);
    expect(old[0]!.done).toBe(1);
  });

  it('finds an item, its parents and where it sits', () => {
    const cards = checklistCards(LISTS, ITEMS);
    expect(ancestorsOf(cards, 'a2')).toEqual(['a']);
    expect(ancestorsOf(cards, 'c')).toEqual([]);
    const at = findNode(cards, 'a2')!;
    expect([at.card.list.id, at.parent?.item.id, at.index, at.siblings.length]).toEqual(['L1', 'a', 1, 2]);
  });

  it('says which moves make sense: no indent for a first item, no outdent at the top, no moving past the ends', () => {
    const cards = checklistCards(LISTS, ITEMS);
    expect(moveAvailability(cards, 'a')).toEqual({ indent: false, outdent: false, up: false, down: true });
    expect(moveAvailability(cards, 'b')).toEqual({ indent: true, outdent: false, up: true, down: false });
    expect(moveAvailability(cards, 'a2')).toEqual({ indent: true, outdent: true, up: true, down: false });
  });

  it('never indents past the twentieth level', () => {
    const deep: CLItem[] = [];
    let parent: string | null = null;
    for (let d = 0; d < 20; d++) {
      deep.push(item(`d${d}`, 'L1', parent, `Level ${d + 1}`));
      parent = `d${d}`;
    }
    deep.push(item('sib', 'L1', 'd18', 'Sibling at level 20'));
    const cards = checklistCards([LISTS[0]!], deep);
    expect(findNode(cards, 'd19')!.node.depth).toBe(19);
    // "sib" follows d19 at depth 19: indenting would make it level 21.
    expect(moveAvailability(cards, 'sib').indent).toBe(false);
  });
});

describe('dueWords', () => {
  it('writes "3 Nov" this year and "3 Nov 2027" another year', () => {
    expect(dueWords('2026-11-03', '2026-11-06')).toBe('3 Nov');
    expect(dueWords('2027-11-03', '2026-11-06')).toBe('3 Nov 2027');
    expect(dueWords(null, '2026-11-06')).toBe('');
  });
});

describe('local drafts (the New task form and the template editors)', () => {
  const tree: ChecklistTree = [
    { title: 'Electrical', items: [{ text: 'Wiring', children: [{ text: 'Label circuits' }, { text: 'Test breakers' }] }, { text: 'Lights' }] },
    { title: 'Plumbing', items: [{ text: 'Pipes' }] },
  ];

  it('round-trips a tree, and reads old plain lists as one “Checklist”', () => {
    expect(draftToTree(draftFromTree(tree))).toEqual(tree);
    expect(draftToTree(draftFromTexts(['Gate', 'Fence']))).toEqual([{ title: 'Checklist', items: [{ text: 'Gate' }, { text: 'Fence' }] }]);
    expect(draftToTree(emptyDraft())).toEqual([]);
    expect(treeLeafCount(tree)).toBe(4);
    expect(treeItemCount(tree)).toBe(5);
    expect(treeTexts(tree)).toEqual(['Wiring', 'Label circuits', 'Test breakers', 'Lights', 'Pipes']);
  });

  it('shows as the same flat items the panel gets (no ticks)', () => {
    const view = draftView(draftFromTree(tree));
    expect(view.lists.map((l) => l.title)).toEqual(['Electrical', 'Plumbing']);
    const cards = checklistCards(view.lists, view.items);
    expect(cards[0]!.roots[0]!.children.map((n) => n.item.text)).toEqual(['Label circuits', 'Test breakers']);
    expect(view.items.every((i) => i.done === false)).toBe(true);
  });

  it('adds at the end, after an item, or under a parent; trims and keeps 191 characters', () => {
    let d = draftFromTree(tree);
    const listId = d.lists[0]!.id;
    const wiringId = d.lists[0]!.items[0]!.id;
    d = draftAdd(d, { listId, parentId: null, afterId: null }, ['  Sockets  ']).draft;
    d = draftAdd(d, { listId, parentId: null, afterId: wiringId }, ['Earthing']).draft;
    d = draftAdd(d, { listId, parentId: wiringId, afterId: null }, ['Sign off', 'x'.repeat(250)]).draft;
    const out = draftToTree(d)[0]!;
    expect(out.items.map((n) => n.text)).toEqual(['Wiring', 'Earthing', 'Lights', 'Sockets']);
    expect(out.items[0]!.children!.map((n) => n.text)).toEqual(['Label circuits', 'Test breakers', 'Sign off', 'x'.repeat(191)]);
  });

  it('renames, removes (with sub-items) and duplicates (a copy of the whole branch right after it)', () => {
    let d = draftFromTree(tree);
    const wiring = d.lists[0]!.items[0]!;
    d = draftRename(d, wiring.children[0]!.id, 'Label every circuit');
    d = draftDuplicate(d, wiring.id);
    expect(draftToTree(d)[0]!.items.map((n) => [n.text, n.children?.map((c) => c.text)])).toEqual([
      ['Wiring', ['Label every circuit', 'Test breakers']],
      ['Wiring', ['Label every circuit', 'Test breakers']],
      ['Lights', undefined],
    ]);
    // The copy has ids of its own.
    const ids = draftView(d).items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    d = draftRemove(d, wiring.id);
    expect(draftToTree(d)[0]!.items.map((n) => n.text)).toEqual(['Wiring', 'Lights']);
  });

  it('indents, outdents and moves among its siblings, never anywhere else', () => {
    let d = draftFromTree(tree);
    const [wiring, lights] = d.lists[0]!.items;
    d = draftMove(d, lights!.id, 'indent'); // under Wiring, last
    expect(draftToTree(d)[0]!.items[0]!.children!.map((n) => n.text)).toEqual(['Label circuits', 'Test breakers', 'Lights']);
    d = draftMove(d, lights!.id, 'up');
    expect(draftToTree(d)[0]!.items[0]!.children!.map((n) => n.text)).toEqual(['Label circuits', 'Lights', 'Test breakers']);
    d = draftMove(d, lights!.id, 'outdent'); // right after Wiring
    expect(draftToTree(d)[0]!.items.map((n) => n.text)).toEqual(['Wiring', 'Lights']);
    d = draftMove(d, wiring!.id, 'down');
    expect(draftToTree(d)[0]!.items.map((n) => n.text)).toEqual(['Lights', 'Wiring']);
    // Nothing to do: unchanged.
    expect(draftMove(d, lights!.id, 'up')).toBe(d);
    expect(draftMove(d, lights!.id, 'outdent')).toBe(d);
  });

  it('adds, renames, duplicates and removes whole checklists', () => {
    let d = draftFromTree(tree);
    const added = draftAddList(d, 'Handover', d.lists[0]!.id);
    d = added.draft;
    expect(d.lists.map((l) => l.title)).toEqual(['Electrical', 'Handover', 'Plumbing']);
    d = draftRenameList(d, added.id, 'Hand-over');
    d = draftDuplicateList(d, d.lists[0]!.id);
    expect(d.lists.map((l) => l.title)).toEqual(['Electrical', 'Electrical (copy)', 'Hand-over', 'Plumbing']);
    expect(draftToTree(d)[1]!.items[0]!.children!.length).toBe(2);
    d = draftRemoveList(d, d.lists[0]!.id);
    expect(d.lists.map((l) => l.title)).toEqual(['Electrical (copy)', 'Hand-over', 'Plumbing']);
    // An empty checklist isn't sent.
    expect(draftToTree(d).map((l) => l.title)).toEqual(['Electrical (copy)', 'Plumbing']);
    // Removing the last one leaves an empty "Checklist" to add to.
    let one = draftFromTexts(['Gate']);
    one = draftRemoveList(one, one.lists[0]!.id);
    expect(one.lists.map((l) => l.title)).toEqual(['Checklist']);
  });

  it('text typed in an add box and not added yet is kept where it was typed (so Create never loses it)', () => {
    let d = draftFromTree(tree);
    const [electrical, plumbing] = d.lists;
    const wiringId = electrical!.items[0]!.id;
    d = { ...d, typed: { [composerKey({ listId: plumbing!.id, parentId: null, afterId: null })]: 'Drains\nTaps', [composerKey({ listId: electrical!.id, parentId: wiringId, afterId: null })]: 'Sign off' } };
    const out = draftToTree(d);
    expect(out[1]!.items.map((n) => n.text)).toEqual(['Pipes', 'Drains', 'Taps']);
    expect(out[0]!.items[0]!.children!.map((n) => n.text)).toEqual(['Label circuits', 'Test breakers', 'Sign off']);
    // Blank typing is nothing.
    expect(draftToTree({ ...draftFromTexts([]), typed: { x: '   ' } })).toEqual([]);
  });
});
