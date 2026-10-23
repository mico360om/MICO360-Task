/**
 * Task keys are a project code and a number ("RIG-12"). The highest number among some keys (0 for
 * none): compared as numbers, so RIG-10 comes after RIG-9 — the text order would put it first.
 * Worked out here rather than in SQL, so it is the same on MySQL and PostgreSQL.
 */
export function highestKeyNumberIn(keys: Iterable<string>): number {
  let highest = 0;
  for (const key of keys) {
    const m = /-(\d+)$/.exec(key);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return highest;
}
