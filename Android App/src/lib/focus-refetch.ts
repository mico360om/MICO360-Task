/**
 * Whether a screen's figures are read again as it comes back into view (Stage 3 final review P1):
 * only figures it already shows (a first load is the query's own), out of date (a task changed on a
 * screen opened from it marks them so: lib/task-cache TASK_FIGURE_VIEWS), not being read now, and
 * only while the screen may ask at all (Management: once the server said yes — Review Focus 1;
 * a query's refetch would ask even while it is turned off).
 */
export function refetchOnFocusWanted(q: { isStale: boolean; isFetching: boolean; hasData: boolean }, enabled: boolean): boolean {
  return enabled && q.hasData && q.isStale && !q.isFetching;
}
