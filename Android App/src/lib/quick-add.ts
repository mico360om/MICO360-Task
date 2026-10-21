/**
 * Tag names typed in one box (a task’s tags, on its details). The old Quick add sheet’s other rules went
 * with it in 4a: New task is the website’s form now (lib/task-form).
 *
 * Tag separators: ASCII comma, the Arabic comma "،" (what Arabic keyboards type), semicolons
 * (ASCII and Arabic "؛") and new lines (ARB-04).
 */
const TAG_SEPARATORS = /[,،;؛\n]/;

/**
 * Split a tag string into clean names: trimmed, non-empty, and de-duplicated case-insensitively
 * (first spelling wins). "عاجل، مالية" is two tags, not one merged tag. Used by the tag field.
 */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(TAG_SEPARATORS)) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
