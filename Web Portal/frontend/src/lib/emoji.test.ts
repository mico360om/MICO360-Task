import { describe, it, expect } from 'vitest';
import { EMOJI, QUICK_REACTIONS, searchEmoji } from './emoji';

describe('emoji', () => {
  it('finds emoji by name or a related word, in any case', () => {
    expect(searchEmoji('party').map((e) => e.char)).toContain('🎉');
    expect(searchEmoji('HEART').map((e) => e.char)).toContain('❤️');
    expect(searchEmoji('thumbs').map((e) => e.char)).toContain('👍');
  });
  it('lists everything for an empty search and nothing for nonsense', () => {
    expect(searchEmoji('  ')).toHaveLength(EMOJI.length);
    expect(searchEmoji('zzzqqq')).toEqual([]);
  });
  it('offers the quick reactions from the full set (no duplicates)', () => {
    const all = new Set(EMOJI.map((e) => e.char));
    for (const r of QUICK_REACTIONS) expect(all.has(r)).toBe(true);
    expect(new Set(EMOJI.map((e) => e.char)).size).toBe(EMOJI.length);
  });
});
