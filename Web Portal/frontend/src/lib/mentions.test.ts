import { describe, it, expect } from 'vitest';
import { detectMention, applyMention, tokenizeMentions } from './mentions';

describe('detectMention', () => {
  it('detects an @mention being typed at the caret', () => {
    expect(detectMention('hi @om', 6)).toEqual({ query: 'om', start: 3 });
    expect(detectMention('@ad', 3)).toEqual({ query: 'ad', start: 0 });
  });
  it('returns null when not in an @mention', () => {
    expect(detectMention('hello world', 11)).toBeNull();
    expect(detectMention('email me@x.com', 14)).toBeNull(); // '@' not preceded by whitespace/start
    expect(detectMention('done @omar ', 11)).toBeNull(); // trailing space closes it
  });
});

describe('applyMention', () => {
  it('replaces the partial token with @username and a trailing space', () => {
    const r = applyMention('hi @om', 3, 'omar', 6);
    expect(r.text).toBe('hi @omar ');
    expect(r.caret).toBe(9);
  });
  it('keeps text after the caret intact', () => {
    const r = applyMention('hi @om there', 3, 'omar', 6);
    expect(r.text).toBe('hi @omar  there');
  });
});

describe('tokenizeMentions', () => {
  it('splits body into text and mention tokens', () => {
    const t = tokenizeMentions('hey @omar and @ada!');
    expect(t).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'mention', value: '@omar', username: 'omar' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: '@ada', username: 'ada' },
      { type: 'text', value: '!' },
    ]);
  });
  it('returns a single text token when there are no mentions', () => {
    expect(tokenizeMentions('plain text')).toEqual([{ type: 'text', value: 'plain text' }]);
  });
});
