import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMOJI, EMOJI_GROUPS, QUICK_REACTIONS, searchEmoji } from './emoji';

describe('the chat’s emoji (3b)', () => {
  it('offers the website’s quick reactions first', () => {
    expect(QUICK_REACTIONS).toEqual(['👍', '❤️', '😂', '🎉', '✅', '😮', '🙏']);
  });
  it('finds emoji by every word typed', () => {
    expect(searchEmoji('thumbs up').map((e) => e.char)).toEqual(['👍']);
    expect(searchEmoji('').length).toBe(EMOJI.length);
    expect(searchEmoji('zzz-nothing')).toEqual([]);
  });
  it('has every emoji in one of the groups, each once', () => {
    expect(EMOJI.every((e) => EMOJI_GROUPS.includes(e.group))).toBe(true);
    expect(new Set(EMOJI.map((e) => e.char)).size).toBe(EMOJI.length);
  });
});

/** The website's set and this copy must not drift apart. Skipped when the website's code isn't next to the app. */
const web = resolve(__dirname, '../../../Web Portal/frontend/src/lib/emoji.ts');
describe.skipIf(!existsSync(web))('the same as the website', () => {
  it('has the same emoji, groups and quick reactions, and finds the same', async () => {
    const w = (await import(/* @vite-ignore */ web)) as typeof import('./emoji');
    expect(EMOJI).toEqual(w.EMOJI);
    expect(EMOJI_GROUPS).toEqual(w.EMOJI_GROUPS);
    expect(QUICK_REACTIONS).toEqual(w.QUICK_REACTIONS);
    for (const q of ['heart', 'thumbs', 'cal', 'party celebrate', 'x']) expect(searchEmoji(q)).toEqual(w.searchEmoji(q));
  });
});
