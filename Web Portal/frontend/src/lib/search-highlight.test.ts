import { describe, it, expect } from 'vitest';
import { highlightParts, matchText, resultsQuery } from './search-highlight';

describe('highlightParts — a text cut into plain and highlighted pieces, from the server’s ranges', () => {
  it('marks the ranges, keeping the text between them', () => {
    expect(highlightParts('Check the scaffold permit', [{ start: 10, end: 15 }, { start: 19, end: 25 }])).toEqual([
      { text: 'Check the ', hit: false },
      { text: 'scaff', hit: true },
      { text: 'old ', hit: false },
      { text: 'permit', hit: true },
    ]);
  });

  it('with no ranges, the whole text is plain; an empty text has no pieces', () => {
    expect(highlightParts('Plain', [])).toEqual([{ text: 'Plain', hit: false }]);
    expect(highlightParts('Plain', undefined)).toEqual([{ text: 'Plain', hit: false }]);
    expect(highlightParts('', [{ start: 0, end: 3 }])).toEqual([]);
  });

  it('sorts the ranges and joins overlapping or touching ones', () => {
    expect(highlightParts('abcdefgh', [{ start: 4, end: 6 }, { start: 0, end: 2 }, { start: 1, end: 3 }, { start: 6, end: 7 }])).toEqual([
      { text: 'abc', hit: true },
      { text: 'd', hit: false },
      { text: 'efg', hit: true },
      { text: 'h', hit: false },
    ]);
  });

  it('ignores ranges that are empty, backwards, broken or past the end, and clips the rest', () => {
    const odd = [
      { start: 3, end: 3 },
      { start: 5, end: 2 },
      { start: Number.NaN, end: 4 },
      { start: 1.5, end: 3 },
      { start: 20, end: 30 },
      { start: -4, end: 1 },
      { start: 6, end: 99 },
      null,
      'x',
    ] as unknown as { start: number; end: number }[];
    expect(highlightParts('abcdefgh', odd)).toEqual([
      { text: 'a', hit: true },
      { text: 'bcdef', hit: false },
      { text: 'gh', hit: true },
    ]);
  });

  it('works on Arabic as on any text (positions are the string’s own)', () => {
    const text = 'المُدِير أحمد';
    expect(highlightParts(text, [{ start: 2, end: 8 }])).toEqual([
      { text: 'ال', hit: false },
      { text: 'مُدِير', hit: true },
      { text: ' أحمد', hit: false },
    ]);
  });
});

describe('matchText — a match as one line', () => {
  it('is its label then its snippet', () => {
    expect(matchText({ label: 'Comment by Bilal · 28 Oct 2026', snippet: '…the scaffold permit…' })).toBe('Comment by Bilal · 28 Oct 2026: …the scaffold permit…');
  });
});

describe('resultsQuery — the full results’ address query', () => {
  it('keeps only the filters that are set', () => {
    expect(resultsQuery({ q: ' scaff permit ' })).toBe('q=scaff+permit');
    expect(resultsQuery({ q: 'rig', projectId: 'p1', status: 'TODO', assigneeId: 'me', done: false, archived: true })).toBe('q=rig&project=p1&status=TODO&assignee=me&done=false&archived=true');
    expect(resultsQuery({ q: '"hot work"', done: true, archived: false })).toBe('q=%22hot+work%22&done=true');
  });

  it('keeps at most 200 letters of the words (what the search takes)', () => {
    expect(new URLSearchParams(resultsQuery({ q: 'x'.repeat(250) })).get('q')).toHaveLength(200);
  });
});
