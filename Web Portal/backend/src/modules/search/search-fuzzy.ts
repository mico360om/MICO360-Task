/**
 * 1.23 search — spelling mistakes. When the exact pass finds little, each word of 4 letters or more is
 * compared with the words in the index (search_words): one letter off for 4–7 letters, two for 8 or
 * more (a swap of two letters counts as one), the start of a longer word too. Only the corrected words
 * are then searched, among what the person may see: a word from an item they can't open finds nothing.
 */

/** How many typos a word may have and still be corrected. */
export function allowedTypos(word: string): number {
  if (/\p{N}/u.test(word)) return 0;
  const n = [...word].length;
  return n < 4 ? 0 : n < 8 ? 1 : 2;
}

/**
 * The edit distance between two words (insert, delete, change, or swap two neighbours), or `max + 1`
 * as soon as it must be more than `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  const s = [...a];
  const t = [...b];
  if (Math.abs(s.length - t.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return Math.min(prev[t.length]!, max + 1);
}

export interface VocabularyDeps {
  /** Every word in the index. */
  load: () => Promise<string[]>;
  /** Keep new words (search_words); absent: only in memory. */
  store?: (words: string[]) => Promise<void>;
  ttlMs?: number;
  now?: () => number;
  /** At most this many words are kept in memory. */
  maxWords?: number;
  /** The clock a suggestion's deadline is on (milliseconds; default performance.now). */
  clock?: () => number;
}

/** At most this many corrections are tried per word. */
export const MAX_SUGGESTIONS = 4;
/**
 * Security review (1.23): one word's spelling pass stops after this long (the server has one thread), with
 * what it found so far. A search's words share one deadline (search-engine).
 */
export const SUGGEST_BUDGET_MS = 25;
/** How many words are compared between looks at the clock. */
const CLOCK_EVERY = 256;

export interface SuggestOptions {
  /** Stop comparing at this time (on the vocabulary's clock); absent: SUGGEST_BUDGET_MS from now. */
  deadline?: number;
}

export function createVocabulary({ load, store, ttlMs = 10 * 60_000, now = () => Date.now(), maxWords = 300_000, clock = () => performance.now() }: VocabularyDeps) {
  let words = new Set<string>();
  let byLength = new Map<number, string[]>();
  let loadedAt: number | null = null;
  let loading: Promise<void> | null = null;

  const index = (list: Iterable<string>) => {
    const set = new Set<string>();
    const lengths = new Map<number, string[]>();
    for (const w of list) {
      if (set.size >= maxWords) break;
      if (set.has(w)) continue;
      set.add(w);
      const n = [...w].length;
      const bucket = lengths.get(n) ?? [];
      bucket.push(w);
      lengths.set(n, bucket);
    }
    words = set;
    byLength = lengths;
  };

  /** The words, (re)loaded when stale; a failed reload keeps the words it had (and tries again next time). */
  async function ready(): Promise<void> {
    const stale = loadedAt === null || now() - loadedAt >= ttlMs;
    if (!stale) return;
    if (!loading) {
      loading = load().then(
        (list) => {
          index(list);
          loadedAt = now();
          loading = null;
        },
        () => {
          loading = null;
        },
      );
    }
    // The first load is waited for; later ones run while the old words still answer.
    if (loadedAt === null) await loading;
  }

  async function has(word: string): Promise<boolean> {
    await ready();
    return words.has(word);
  }

  /**
   * Words this one may be a misspelling of (closest first; the start of a longer word as that start).
   * Kept to its time (`deadline`): what is found by then is the answer.
   */
  async function suggest(term: string, opts: SuggestOptions = {}): Promise<string[]> {
    const max = allowedTypos(term);
    if (max === 0) return [];
    await ready();
    if (words.has(term)) return [];
    const deadline = opts.deadline ?? clock() + SUGGEST_BUDGET_MS;
    const n = [...term].length;
    const found = new Map<string, number>();
    let compared = 0;
    scan: for (const [len, bucket] of byLength) {
      if (len < n - max) continue;
      for (const w of bucket) {
        if (++compared % CLOCK_EVERY === 0 && clock() >= deadline) break scan;
        if (len <= n + max) {
          const d = editDistance(term, w, max);
          if (d <= max && d > 0) found.set(w, Math.min(found.get(w) ?? 9, d));
        }
        if (len > n) {
          // A part typed with a typo: compare with the word's starts of about the same length.
          // (A word of one-unit letters — nearly all — is cut as it is, without splitting it into letters.)
          const letters = w.length === len ? null : [...w];
          for (let k = Math.max(1, n - max); k <= Math.min(len - 1, n + max); k++) {
            const start = letters ? letters.slice(0, k).join('') : w.slice(0, k);
            if (start === term || found.has(start)) continue;
            const d = editDistance(term, start, max);
            if (d <= max && d > 0) found.set(start, d + 0.5);
          }
        }
      }
    }
    if (found.size === 0) return [];
    // Only the closest: a word one letter off makes those two letters off noise.
    const best = Math.min(...[...found.values()].map(Math.floor));
    return [...found.entries()]
      .filter(([, d]) => Math.floor(d) === best)
      .sort((a, b) => a[1] - b[1] || Math.abs([...a[0]].length - n) - Math.abs([...b[0]].length - n) || a[0].localeCompare(b[0]))
      .slice(0, MAX_SUGGESTIONS)
      .map(([w]) => w);
  }

  /** Words just indexed: those it didn't have are kept (and stored). Never throws. */
  async function add(list: readonly string[]): Promise<void> {
    await ready().catch(() => undefined);
    const fresh = [...new Set(list)].filter((w) => !words.has(w));
    if (fresh.length === 0) return;
    for (const w of fresh) {
      if (words.size >= maxWords) break;
      words.add(w);
      const n = [...w].length;
      // Into its length's list (never a copy of the list per word: that was quadratic).
      const bucket = byLength.get(n);
      if (bucket) bucket.push(w);
      else byLength.set(n, [w]);
    }
    await store?.(fresh).catch(() => undefined);
  }

  return { has, suggest, add };
}

export type Vocabulary = ReturnType<typeof createVocabulary>;
