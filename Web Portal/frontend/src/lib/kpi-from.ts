/**
 * 1.24.6 (owner, 24 Nov: "the page they came from"): another person's KPI page (/performance/<id>) is no menu
 * item of its own, so the menu lights the page it was opened from. Links to it carry that page in their state.
 */
export type KpiFrom = '/workload' | '/projects';

const ORIGINS: readonly string[] = ['/workload', '/projects'];

/** The state a link to another person's KPI page carries. */
export const kpiLinkState = (from: KpiFrom) => ({ kpiFrom: from });

/**
 * The menu item to light on another person's KPI page: the page it was opened from, or Workload (the team's
 * KPIs list) when that isn't known (a typed address, an old link). Null on every other page.
 */
export function kpiMenuOrigin(pathname: string, state: unknown): KpiFrom | null {
  if (!/^\/performance\/[^/]+\/?$/.test(pathname)) return null;
  const from = (state as { kpiFrom?: unknown } | null)?.kpiFrom;
  return typeof from === 'string' && ORIGINS.includes(from) ? (from as KpiFrom) : '/workload';
}
