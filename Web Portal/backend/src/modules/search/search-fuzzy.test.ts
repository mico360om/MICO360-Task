import { describe, it, expect } from 'vitest';
import { allowedTypos, createVocabulary, editDistance } from './search-fuzzy';

describe('editDistance (a swap of two letters counts as one)', () => {
  it('counts insertions, deletions, changes and swaps; stops past the limit', () => {
    expect(editDistance('generator', 'generator', 2)).toBe(0);
    expect(editDistance('genarator', 'generator', 2)).toBe(1);
    expect(editDistance('genrator', 'generator', 2)).toBe(1);
    expect(editDistance('generatro', 'generator', 2)).toBe(1); // swapped
    expect(editDistance('ganerater', 'generator', 2)).toBe(2);
    expect(editDistance('pump', 'valve', 1)).toBeGreaterThan(1);
    expect(editDistance('سلامه', 'سلامت', 1)).toBe(1);
  });
});

describe('allowedTypos', () => {
  it('none under 4 letters, 1 for 4–7, 2 for 8 or more; words with digits never', () => {
    expect(allowedTypos('rig')).toBe(0);
    expect(allowedTypos('pump')).toBe(1);
    expect(allowedTypos('scaffol')).toBe(1);
    expect(allowedTypos('scaffold')).toBe(2);
    expect(allowedTypos('rig3')).toBe(0);
  });
});

describe('createVocabulary', () => {
  const words = ['generator', 'generators', 'scaffold', 'scaffolding', 'pump', 'pumps', 'permit', 'electrical', 'electric', 'valve', 'مضخه', 'سلامه'];
  const vocab = () => createVocabulary({ load: async () => words, ttlMs: 60_000 });

  it('suggests indexed words within the allowed typos, closest first, never the word itself', async () => {
    const v = vocab();
    expect(await v.suggest('genarator')).toEqual(['generator']);
    expect(await v.suggest('elctrical')).toEqual(['electrical']);
    expect((await v.suggest('pmup'))).toContain('pump');
    expect(await v.suggest('pump')).toEqual([]); // spelled right: nothing to correct
    expect(await v.suggest('سلامت')).toEqual(['سلامه']);
    expect(await v.suggest('xyzzy')).toEqual([]);
  });

  it('also corrects the start of a longer word (a part typed with a typo)', async () => {
    // "scafol" is one letter off "scaffo…": the corrected part is what is searched.
    expect(await vocab().suggest('scafol')).toContain('scaffol');
  });

  it('knows which words it has, and adds new ones (only those it did not have)', async () => {
    const added: string[][] = [];
    const v = createVocabulary({ load: async () => ['pump'], ttlMs: 60_000, store: async (w) => void added.push(w) });
    expect(await v.has('pump')).toBe(true);
    await v.add(['pump', 'impeller', 'impeller']);
    expect(added).toEqual([['impeller']]);
    expect(await v.has('impeller')).toBe(true);
  });

  it('reloads after its time, and keeps working on the old words while a reload fails', async () => {
    let t = 0;
    let fail = false;
    let list = ['pump'];
    const v = createVocabulary({ load: async () => { if (fail) throw new Error('db'); return list; }, ttlMs: 10, now: () => t });
    expect(await v.has('pump')).toBe(true);
    list = ['valve'];
    t = 20;
    fail = true;
    expect(await v.has('pump')).toBe(true);
    fail = false;
    t = 40;
    await v.has('x');
    expect(await v.has('valve')).toBe(true);
  });
});
