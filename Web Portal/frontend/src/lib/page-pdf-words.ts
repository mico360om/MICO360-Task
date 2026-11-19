import { guestFilterOptions, taskCategoryChoices, type GuestCategoryFilters, type GuestCategoryRow } from './guest-category-filter';

/**
 * 1.24.3 page PDFs: the Guest, Guest company and Category filters in words for a PDF's header
 * ("Guest: Ali Hassan (Contoso)", "Guest company: Fabrikam", "Category: Snagging") — only those in use.
 */
export function guestCategoryWords(rows: GuestCategoryRow[], picked: GuestCategoryFilters, projectName?: (projectId: string) => string | undefined, categories?: { id: string; name: string }[]): string[] {
  const out: string[] = [];
  if (picked.guest) out.push(`Guest: ${guestFilterOptions(rows, picked.guest).find((o) => o.value === picked.guest)?.label ?? 'the chosen guest'}`);
  if (picked.guestCompany.trim()) out.push(`Guest company: ${picked.guestCompany.trim()}`);
  if (picked.category) {
    const own = categories?.find((x) => x.id === picked.category);
    const c = own ? { name: own.name, projectName: undefined } : taskCategoryChoices(rows, projectName).find((x) => x.id === picked.category);
    out.push(`Category: ${c ? (c.projectName ? `${c.name} (${c.projectName})` : c.name) : 'the chosen category'}`);
  }
  return out;
}

/** The words of a select's chosen option, or '' when nothing (or "any") is chosen. */
export function chosenWords(label: string, value: string, options: { value: string; label: string }[]): string {
  if (!value) return '';
  return `${label}: ${options.find((o) => o.value === value)?.label ?? value}`;
}
