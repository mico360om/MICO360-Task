/**
 * companies: the people offered where someone is chosen outside a project (a new direct message,
 * guests of a meeting with neither project nor company) are colleagues — people who share a company
 * with me (the directory marks them `colleague`; administrators are everyone's). Teammates from
 * another company on a shared project and old chat partners stay in the directory for their names.
 * An older server marks nobody: everyone is kept, as before.
 */
export function colleaguesOf<T extends { colleague?: boolean }>(directory: readonly T[]): T[] {
  return directory.filter((u) => u.colleague !== false);
}
