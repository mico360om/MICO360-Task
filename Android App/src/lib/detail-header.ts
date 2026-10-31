/**
 * What a detail screen's stack header says (device check H): the thing's key — a task's "SITE-1",
 * a project's code — or nothing while it isn't known or when there is none. The page itself shows
 * the big title once, as the website's task panel does.
 */
export function detailHeaderTitle(key: string | null | undefined): string {
  return key?.trim() ?? '';
}
