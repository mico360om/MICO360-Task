import { describe, it, expect } from 'vitest';
import {
  EMPTY_GUEST_CATEGORY_FILTERS,
  categoryFilterOptions,
  guestCategoryFiltersActive,
  guestCompanyFilterOptions,
  guestFilterOptions,
  guestsMatchWords,
  matchesGuestCategory,
  projectCategoryChoices,
  taskCategoryChoices,
} from './guest-category-filter';

const ahmed = { id: 'g1', name: 'Ahmed Al Harthy', company: 'Acme' };
const sara = { id: 'g2', name: 'Sara Nasser', company: 'PDO' };
const salim = { id: 'g3', name: 'Salim', company: null };
const elec = { id: 'c1', name: 'Electrical', color: 'teal', retired: false };
const hse = { id: 'c2', name: 'HSE', color: 'pink', retired: false };
const civil = { id: 'c9', name: 'Civil', color: 'gold', retired: true };

const tasks = [
  { projectId: 'p1', guests: [ahmed, sara], categories: [elec] },
  { projectId: 'p1', guests: [salim], categories: [hse, elec] },
  { projectId: 'p2', guests: [], categories: [civil] },
  // An older server: no guests on the rows, only the external contacts in short.
  { projectId: 'p2', externalSummary: { count: 1, name: 'Old Contact', company: 'Petrogas', names: ['Old Contact'], companies: ['Petrogas'] } },
];

describe('Guest, Guest company and Category filters (1.24)', () => {
  it('nothing chosen keeps every task; each choice narrows', () => {
    expect(tasks.filter((t) => matchesGuestCategory(t, EMPTY_GUEST_CATEGORY_FILTERS))).toHaveLength(4);
    expect(tasks.filter((t) => matchesGuestCategory(t, { ...EMPTY_GUEST_CATEGORY_FILTERS, guest: 'g2' }))).toEqual([tasks[0]]);
    // The company case and spaces aside.
    expect(tasks.filter((t) => matchesGuestCategory(t, { ...EMPTY_GUEST_CATEGORY_FILTERS, guestCompany: ' acme ' }))).toEqual([tasks[0]]);
    expect(tasks.filter((t) => matchesGuestCategory(t, { ...EMPTY_GUEST_CATEGORY_FILTERS, category: 'c1' }))).toEqual([tasks[0], tasks[1]]);
    expect(tasks.filter((t) => matchesGuestCategory(t, { ...EMPTY_GUEST_CATEGORY_FILTERS, category: 'c2', guest: 'g3' }))).toEqual([tasks[1]]);
    expect(tasks.filter((t) => matchesGuestCategory(t, { ...EMPTY_GUEST_CATEGORY_FILTERS, category: 'c2', guest: 'g1' }))).toEqual([]);
  });

  it('an older server’s rows (external contacts in short, no guests) still match the guest company', () => {
    expect(tasks.filter((t) => matchesGuestCategory(t, { ...EMPTY_GUEST_CATEGORY_FILTERS, guestCompany: 'petrogas' }))).toEqual([tasks[3]]);
  });

  it('a search word matches a guest’s name or company (case aside), or an older server’s contacts in short', () => {
    expect(tasks.filter((t) => guestsMatchWords(t, 'sara'))).toEqual([tasks[0]]);
    expect(tasks.filter((t) => guestsMatchWords(t, 'Acme'))).toEqual([tasks[0]]);
    expect(tasks.filter((t) => guestsMatchWords(t, 'petro'))).toEqual([tasks[3]]);
    expect(tasks.filter((t) => guestsMatchWords(t, ' '))).toEqual([]);
  });

  it('counts how many are in use', () => {
    expect(guestCategoryFiltersActive(EMPTY_GUEST_CATEGORY_FILTERS)).toBe(0);
    expect(guestCategoryFiltersActive({ guest: 'g1', guestCompany: 'Acme', category: '' })).toBe(2);
  });

  it('the Guest choices: “Any guest” first, then each guest once, A to Z, by name (company)', () => {
    expect(guestFilterOptions(tasks, '')).toEqual([
      { value: '', label: 'Guest: Any guest' },
      { value: 'g1', label: 'Ahmed Al Harthy (Acme)' },
      { value: 'g3', label: 'Salim' },
      { value: 'g2', label: 'Sara Nasser (PDO)' },
    ]);
  });

  it('a chosen guest no longer on the tasks stays a choice (so it can be seen and cleared)', () => {
    expect(guestFilterOptions([], 'g7', 'Huda (BP)')).toEqual([
      { value: '', label: 'Guest: Any guest' },
      { value: 'g7', label: 'Huda (BP)' },
    ]);
    expect(guestFilterOptions([], '')).toEqual([{ value: '', label: 'Guest: Any guest' }]);
  });

  it('the Guest company choices: the guests’ companies (and an older server’s contacts’), each once, A to Z', () => {
    expect(guestCompanyFilterOptions(tasks, '')).toEqual([
      { value: '', label: 'Guest company: Any company' },
      { value: 'Acme', label: 'Acme' },
      { value: 'PDO', label: 'PDO' },
      { value: 'Petrogas', label: 'Petrogas' },
    ]);
    expect(guestCompanyFilterOptions([], 'Shell').map((o) => o.value)).toEqual(['', 'Shell']);
  });

  it('the Category choices from the tasks: each once, by project name then name, the project as a hint', () => {
    const names: Record<string, string> = { p1: 'Rig Inspection', p2: 'Admin' };
    const choices = taskCategoryChoices(tasks, (id) => names[id]);
    expect(choices.map((c) => [c.id, c.projectName])).toEqual([
      ['c9', 'Admin'],
      ['c1', 'Rig Inspection'],
      ['c2', 'Rig Inspection'],
    ]);
    expect(categoryFilterOptions(choices, '')).toEqual([
      { value: '', label: 'Category: Any category' },
      { value: 'c9', label: 'Civil', hint: 'Admin · retired', color: 'gold' },
      { value: 'c1', label: 'Electrical', hint: 'Rig Inspection', color: 'teal' },
      { value: 'c2', label: 'HSE', hint: 'Rig Inspection', color: 'pink' },
    ]);
  });

  it('a row that knows its project’s name (a card on All projects) gives it as the hint', () => {
    expect(taskCategoryChoices([{ projectName: 'Bridge', categories: [hse] }])).toEqual([{ id: 'c2', name: 'HSE', color: 'pink', retired: false, projectName: 'Bridge' }]);
  });

  it('one project’s list: in its order, the ones in use first and the retired ones marked last', () => {
    const list = [
      { id: 'a', projectId: 'p1', name: 'Zeta', color: 'teal', position: 0, retired: false, retiredAt: null },
      { id: 'b', projectId: 'p1', name: 'Old', color: 'navy', position: 1, retired: true, retiredAt: '2026-11-01T00:00:00Z' },
      { id: 'c', projectId: 'p1', name: 'Alpha', color: 'lime', position: 2, retired: false, retiredAt: null },
    ];
    expect(categoryFilterOptions(projectCategoryChoices(list), '').map((o) => [o.value, o.label, o.hint])).toEqual([
      ['', 'Category: Any category', undefined],
      ['a', 'Zeta', undefined],
      ['c', 'Alpha', undefined],
      ['b', 'Old', 'retired'],
    ]);
  });

  it('a chosen category no longer among the choices stays one', () => {
    expect(categoryFilterOptions([], 'c5', 'Piping').map((o) => [o.value, o.label])).toEqual([
      ['', 'Category: Any category'],
      ['c5', 'Piping'],
    ]);
  });
});
