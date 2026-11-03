import type { Query, QueryClient } from '@tanstack/react-query';
import { MY_COMPANIES_KEY } from '../api/companies';
import { useCompanyStore } from '../stores/company-store';
import { onCompaniesChanged } from './authedSocket';

/**
 * What every cached answer was read under: the company picked in the top bar. These keep across a
 * change of pick — the site's settings, the picker's own list, my own date settings and the footer's
 * version and download checks (none of them is a company's); everything else was read for one
 * company (or for all of mine) and is dropped.
 */
const KEPT: readonly (readonly string[])[] = [
  ['app-config'],
  MY_COMPANIES_KEY,
  ['date-prefs'],
  ['app-version'],
  ['web-build'],
  ['android-apk'],
  ['hosted-download'],
];

function readForAPick(query: Query): boolean {
  const key = query.queryKey;
  return !KEPT.some((kept) => kept.length <= key.length && kept.every((part, i) => key[i] === part));
}

/**
 * Drop every answer read for the old scope: requests on their way are cancelled, cached answers are
 * cleared (so no list, count or figure of the old scope is shown) and the pages on screen read again.
 */
export function resetCompanyScopedQueries(qc: QueryClient): void {
  void qc.cancelQueries({ predicate: readForAPick });
  void qc.resetQueries({ predicate: readForAPick });
}

/**
 * Tie the query cache to the picked company: changing the pick (or the server refusing it) resets
 * every list, and when the server says my companies changed (`companies:changed`) the picker's list
 * is read again and the lists reset — a company taken away disappears at once. Returns an unsubscribe.
 */
export function bindQueryCacheToCompanyPick(qc: QueryClient): () => void {
  const offPick = useCompanyStore.subscribe((state, prev) => {
    if (state.pick !== prev.pick) resetCompanyScopedQueries(qc);
  });
  const offChanged = onCompaniesChanged(() => {
    void qc.invalidateQueries({ queryKey: MY_COMPANIES_KEY });
    resetCompanyScopedQueries(qc);
  });
  return () => {
    offPick();
    offChanged();
  };
}
