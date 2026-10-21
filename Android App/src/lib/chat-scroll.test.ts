import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterNewest, isFarFromNewest, isNearNewest, KEEP_READING_POSITION, NEAR_NEWEST_PX, newMessagesLabel } from './chat-scroll';

const item = (id: string, userId = 'u2') => ({ id, userId });

// 3a review fix 4: scrolled up reading, a new message must not move the text under the eyes.
describe('the reading position while scrolled up', () => {
  it('stays put as new messages come in; near the newest the list still follows them', () => {
    expect(KEEP_READING_POSITION).toEqual({ minIndexForVisible: 0, autoscrollToTopThreshold: NEAR_NEWEST_PX });
    const screen = readFileSync(resolve(__dirname, '../screens/ChatThreadScreen.tsx'), 'utf8');
    expect(screen).toContain('maintainVisibleContentPosition={KEEP_READING_POSITION}');
  });
});

describe('isNearNewest / isFarFromNewest (the inverted list: offset 0 is the newest message)', () => {
  it('counts a finger’s scroll from the newest as still at the newest', () => {
    expect(isNearNewest(0)).toBe(true);
    expect(isNearNewest(120)).toBe(true);
    expect(isNearNewest(121)).toBe(false);
  });
  it('offers a way back after scrolling well into the history', () => {
    expect(isFarFromNewest(600)).toBe(false);
    expect(isFarFromNewest(601)).toBe(true);
  });
});

describe('afterNewest (a new newest message: follow it, or count it on the pill)', () => {
  it('follows on the first load', () => {
    expect(afterNewest({ prevNewestId: undefined, items: [item('a')], nearNewest: false, myId: 'me' })).toEqual({ follow: true, unseen: 0 });
  });
  it('does nothing when the newest message is the same one (an older page loaded, an edit)', () => {
    expect(afterNewest({ prevNewestId: 'a', items: [item('a'), item('z')], nearNewest: false, myId: 'me' })).toEqual({ follow: false, unseen: 0 });
  });
  it('follows when you are at the newest already', () => {
    expect(afterNewest({ prevNewestId: 'a', items: [item('b'), item('a')], nearNewest: true, myId: 'me' })).toEqual({ follow: true, unseen: 0 });
  });
  it('follows your own message wherever you were (you just sent it)', () => {
    expect(afterNewest({ prevNewestId: 'a', items: [item('out-1', 'me'), item('a')], nearNewest: false, myId: 'me' })).toEqual({ follow: true, unseen: 0 });
  });
  it('reading older messages: stays put and counts what others wrote since', () => {
    const items = [item('d'), item('c', 'me'), item('b'), item('a')];
    expect(afterNewest({ prevNewestId: 'a', items, nearNewest: false, myId: 'me' })).toEqual({ follow: false, unseen: 2 });
  });
  it('counts one when the previous newest is gone (deleted, or replaced by its saved copy)', () => {
    expect(afterNewest({ prevNewestId: 'gone', items: [item('b'), item('a')], nearNewest: false, myId: 'me' })).toEqual({ follow: false, unseen: 1 });
  });
  it('nothing to follow in an empty thread', () => {
    expect(afterNewest({ prevNewestId: 'a', items: [], nearNewest: false, myId: 'me' })).toEqual({ follow: false, unseen: 0 });
  });
});

describe('newMessagesLabel (the pill)', () => {
  it('counts in plain words', () => {
    expect(newMessagesLabel(1)).toBe('1 new message');
    expect(newMessagesLabel(4)).toBe('4 new messages');
  });
});
