import { useMemo } from 'react';
import { SearchableSelect, type SelectOption } from './ui/SearchableSelect';
import { categoryStyle } from './CategoryChip';
import { GUEST_WORDS } from '../lib/guest-contacts';
import { CATEGORY_WORDS } from '../lib/task-categories';
import {
  categoryFilterOptions,
  guestCompanyFilterOptions,
  guestFilterOptions,
  taskCategoryChoices,
  type CategoryChoice,
  type FilterOption,
  type GuestCategoryFilters,
  type GuestCategoryRow,
} from '../lib/guest-category-filter';

/** The three filters, and the names of the guest and category chosen (kept so a choice no longer on the tasks still reads). */
export interface GuestCategoryFilterState extends GuestCategoryFilters {
  guestLabel?: string;
  categoryLabel?: string;
}

const swatch = (color: string) => <span aria-hidden="true" className="cat-swatch block h-2.5 w-2.5 rounded-[2px]" style={categoryStyle(color)} />;
const asSelect = (options: FilterOption[]): SelectOption[] =>
  options.map(({ value, label, hint, color }) => ({ value, label, ...(hint ? { hint } : {}), ...(color ? { icon: swatch(color) } : {}) }));
const labelOf = (options: FilterOption[], value: string) => options.find((o) => o.value === value)?.label;

/**
 * 1.24 The Guest, Guest company and Category filter boxes of a task list (the board, My Tasks, a
 * project's Tasks tab) — in place of 1.20's "External company". Each box shows only when it has a
 * choice (or one is chosen): a list without guests or categories isn't cluttered. The choices come from
 * the rows shown (a one-project board passes its project's whole category list as `categories`).
 */
export function GuestCategoryFilterBoxes({
  rows,
  value,
  onChange,
  categories,
  projectName,
  box,
}: {
  rows: GuestCategoryRow[];
  value: GuestCategoryFilterState;
  onChange: (next: GuestCategoryFilterState) => void;
  /** One project's whole list, in its order (retired ones marked); absent: the categories on the rows. */
  categories?: CategoryChoice[];
  /** The rows' project names (several projects: categories are each project's own). */
  projectName?: (projectId: string) => string | undefined;
  /** Each box's wrapper classes (its width in the page's toolbar). */
  box: string;
}) {
  const guestOptions = useMemo(() => guestFilterOptions(rows, value.guest, value.guestLabel), [rows, value.guest, value.guestLabel]);
  const companyOptions = useMemo(() => guestCompanyFilterOptions(rows, value.guestCompany), [rows, value.guestCompany]);
  const categoryOptions = useMemo(
    () => categoryFilterOptions(categories ?? taskCategoryChoices(rows, projectName), value.category, value.categoryLabel),
    [categories, rows, projectName, value.category, value.categoryLabel],
  );
  return (
    <>
      {guestOptions.length > 1 ? (
        <div className={box}>
          <SearchableSelect
            ariaLabel={`Filter by ${GUEST_WORDS.filter.toLowerCase()}`}
            value={value.guest}
            onChange={(guest) => onChange({ ...value, guest, guestLabel: guest ? labelOf(guestOptions, guest) : undefined })}
            options={asSelect(guestOptions)}
          />
        </div>
      ) : null}
      {companyOptions.length > 1 ? (
        <div className={box}>
          <SearchableSelect
            ariaLabel={`Filter by ${GUEST_WORDS.filterCompany.toLowerCase()}`}
            value={value.guestCompany}
            onChange={(guestCompany) => onChange({ ...value, guestCompany })}
            options={asSelect(companyOptions)}
          />
        </div>
      ) : null}
      {categoryOptions.length > 1 ? (
        <div className={box}>
          <SearchableSelect
            ariaLabel={`Filter by ${CATEGORY_WORDS.filter.toLowerCase()}`}
            value={value.category}
            onChange={(category) => onChange({ ...value, category, categoryLabel: category ? labelOf(categoryOptions, category) : undefined })}
            options={asSelect(categoryOptions)}
          />
        </div>
      ) : null}
    </>
  );
}
