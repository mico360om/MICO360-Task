import { GUEST_WORDS, guestCompanyOptions, guestLabel, guestOptions, guestTextKey, hasGuest, hasGuestCompany } from './guest-contacts';
import { CATEGORY_WORDS, hasAnyCategory } from './task-categories';
import { externalCompanyOptions, hasExternalCompany, matchesExternalContact, type ExternalContactSummary } from './external-contacts';

/**
 * 1.24 The Guest, Guest company and Category filters of the task lists (the board, My Tasks, a project's
 * Tasks tab): what each matches and the choices each offers, from the tasks loaded (a one-project board
 * may offer its project's whole category list). They replace 1.20's "External company" filter. A row
 * from an older server (no `guests`, only `externalSummary`) still matches the guest company.
 */

export interface GuestCategoryFilters {
  /** A guest's id. */
  guest: string;
  /** A company named on a guest (case and spaces aside). */
  guestCompany: string;
  /** A category's id. */
  category: string;
}

export const EMPTY_GUEST_CATEGORY_FILTERS: GuestCategoryFilters = { guest: '', guestCompany: '', category: '' };

/** What a row needs for these filters (a task as the server sends it, or a board card mapped to it). */
export interface GuestCategoryRow {
  projectId?: string;
  /** Its project's name, when the row already knows it (a card on All projects). */
  projectName?: string;
  guests?: { id: string; name: string; company?: string | null }[] | null;
  categories?: { id: string; name: string; color: string; retired?: boolean }[] | null;
  externalSummary?: Pick<ExternalContactSummary, 'companies'> & Partial<Pick<ExternalContactSummary, 'names'>> | null;
}

/** Does the task pass the chosen filters (none chosen: every task)? */
export function matchesGuestCategory(t: GuestCategoryRow, f: GuestCategoryFilters): boolean {
  if (f.guest && !hasGuest(t.guests, f.guest)) return false;
  if (f.guestCompany.trim()) {
    const viaGuests = hasGuestCompany(t.guests, f.guestCompany);
    // An older server sends no guests: its contacts' companies in short.
    const viaSummary = !t.guests?.length && hasExternalCompany(t.externalSummary, f.guestCompany.trim());
    if (!viaGuests && !viaSummary) return false;
  }
  if (f.category && !hasAnyCategory(t.categories, [f.category])) return false;
  return true;
}

/** Does a search word match one of the task's guests — a name or a company, case aside (an older server: its contacts in short)? */
export function guestsMatchWords(t: GuestCategoryRow, words: string): boolean {
  const q = words.trim().toLocaleLowerCase('en');
  if (!q) return false;
  if ((t.guests ?? []).some((g) => g.name.toLocaleLowerCase('en').includes(q) || (g.company ?? '').toLocaleLowerCase('en').includes(q))) return true;
  const s = t.externalSummary;
  return !t.guests?.length && Boolean(s) && matchesExternalContact({ names: s!.names ?? [], companies: s!.companies }, q);
}

/** How many of the three are in use (for "Filters (2)"). */
export function guestCategoryFiltersActive(f: GuestCategoryFilters): number {
  return [f.guest, f.guestCompany, f.category].filter(Boolean).length;
}

export interface FilterOption {
  value: string;
  label: string;
  hint?: string;
  /** A category's colour key (the box draws its swatch). */
  color?: string;
}

/** The Guest filter's choices: "Guest: Any guest", then each guest on the tasks once, A to Z. */
export function guestFilterOptions(tasks: GuestCategoryRow[], chosen: string, chosenLabel?: string): FilterOption[] {
  const found = guestOptions(tasks.map((t) => ({ guests: (t.guests ?? []).map((g) => ({ ...g, company: g.company ?? null })) })));
  const options: FilterOption[] = found.map((g) => ({ value: g.id, label: guestLabel(g) }));
  // The chosen guest stays a choice on tasks without them, so it can be seen and cleared.
  if (chosen && !options.some((o) => o.value === chosen)) options.unshift({ value: chosen, label: chosenLabel || GUEST_WORDS.one });
  return [{ value: '', label: `${GUEST_WORDS.filter}: ${GUEST_WORDS.anyGuest}` }, ...options];
}

/** The Guest company filter's choices: the companies on the tasks' guests (an older server's contacts' too), A to Z. */
export function guestCompanyFilterOptions(tasks: GuestCategoryRow[], chosen: string): FilterOption[] {
  const byKey = new Map<string, string>();
  for (const c of guestCompanyOptions(tasks)) byKey.set(guestTextKey(c), c);
  for (const c of externalCompanyOptions(tasks.filter((t) => !t.guests?.length))) if (!byKey.has(guestTextKey(c))) byKey.set(guestTextKey(c), c);
  const found = [...byKey.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const choices = chosen && !byKey.has(guestTextKey(chosen)) ? [chosen, ...found] : found;
  return [{ value: '', label: `${GUEST_WORDS.filterCompany}: ${GUEST_WORDS.anyCompany}` }, ...choices.map((c) => ({ value: c, label: c }))];
}

/** A category the Category filter offers (with its project's name where tasks of several projects are shown). */
export interface CategoryChoice {
  id: string;
  name: string;
  color: string;
  retired?: boolean;
  projectName?: string;
}

/** The categories on these tasks, each once — by project name (categories are each project's own), then name. */
export function taskCategoryChoices(tasks: GuestCategoryRow[], projectName?: (projectId: string) => string | undefined): CategoryChoice[] {
  const byId = new Map<string, CategoryChoice>();
  for (const t of tasks) {
    for (const c of t.categories ?? []) {
      if (byId.has(c.id)) continue;
      const name = t.projectName ?? (t.projectId && projectName ? projectName(t.projectId) : undefined);
      byId.set(c.id, { id: c.id, name: c.name, color: c.color, retired: Boolean(c.retired), ...(name ? { projectName: name } : {}) });
    }
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  return [...byId.values()].sort((a, b) => cmp(a.projectName ?? '', b.projectName ?? '') || cmp(a.name, b.name));
}

/** One project's whole list (a one-project board): in its order, the ones in use first, the retired ones after. */
export function projectCategoryChoices(list: { id: string; name: string; color: string; position: number; retired: boolean }[]): CategoryChoice[] {
  const ordered = [...list].sort((a, b) => a.position - b.position);
  return [...ordered.filter((c) => !c.retired), ...ordered.filter((c) => c.retired)].map((c) => ({ id: c.id, name: c.name, color: c.color, retired: c.retired }));
}

/** The Category filter's choices: "Category: Any category", then each (its project, and "retired", as a hint). */
export function categoryFilterOptions(choices: CategoryChoice[], chosen: string, chosenLabel?: string): FilterOption[] {
  const options: FilterOption[] = choices.map((c) => {
    const hint = [c.projectName, c.retired ? CATEGORY_WORDS.retired : ''].filter(Boolean).join(' · ');
    return { value: c.id, label: c.name, ...(hint ? { hint } : {}), color: c.color };
  });
  if (chosen && !options.some((o) => o.value === chosen)) options.unshift({ value: chosen, label: chosenLabel || CATEGORY_WORDS.one });
  return [{ value: '', label: `${CATEGORY_WORDS.filter}: ${CATEGORY_WORDS.anyCategory}` }, ...options];
}
