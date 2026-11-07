/**
 * 1.23.8 Consistent spacing — the steps every page uses, so cards, sections and rows line up from page to page:
 *
 * - page edges: the app shell's frame (lib/page-layout: 95% of the room, at most 1680px; 16px top on a phone,
 *   20px from 1024px) — pages never add their own;
 * - page header: `PageHeader` (components/ui/PageHeader) on every list page, 16px under it (`mb-4`); a detail
 *   page (a project, a meeting) has its own header in the same frame;
 * - between sections and cards: 16px (`gap-4` / `space-y-4` / `mb-4`);
 * - inside a card: `card-pad` (index.css) — 16px on a phone, 20px from 640px (a phone keeps the room for words);
 * - list rows: 16px sides, 10px top and bottom (`px-4 py-2.5`), a third less in Compact (lib/density).
 */
export const SPACE = {
  /** Under a page's header. */
  header: 'mb-4',
  /** Between sections and cards. */
  section: 'gap-4',
  /** Inside a card. */
  card: 'card-pad',
  /** A list row. */
  row: 'px-4 py-2.5',
} as const;
