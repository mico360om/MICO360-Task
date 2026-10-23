import { describe, it, expect } from 'vitest';
import { listShownText, matchCountText, pageText, showingText } from './daily-email-words';

describe('Daily task emails: the words for the list’s pages', () => {
  it('who is shown, of how many', () => {
    expect(showingText(21, 40, 63)).toBe('Showing 21–40 of 63 people');
    expect(showingText(1, 63, 63)).toBe('Showing all 63 people');
    expect(showingText(61, 61, 61)).toBe('Showing person 61 of 61');
    expect(showingText(1, 1, 1)).toBe('Showing 1 person');
  });

  it('which page', () => {
    expect(pageText(2, 4)).toBe('Page 2 of 4');
  });

  it('how many match', () => {
    expect(matchCountText(3)).toBe('3 people match');
    expect(matchCountText(1)).toBe('1 person matches');
    expect(matchCountText(0)).toBe('No one matches');
  });

  it('what is read out when the list changes: the page, and how many match a search or filter', () => {
    const page = { from: 21, to: 40, total: 63, page: 2, pages: 4 };
    expect(listShownText({ ...page, filtered: false, matching: 63 })).toBe('Showing 21–40 of 63 people. Page 2 of 4.');
    expect(listShownText({ from: 1, to: 3, total: 3, page: 1, pages: 1, filtered: false, matching: 3 })).toBe('Showing all 3 people.');
    expect(listShownText({ from: 1, to: 3, total: 3, page: 1, pages: 1, filtered: true, matching: 3 })).toBe('3 people match.');
    expect(listShownText({ from: 1, to: 20, total: 25, page: 1, pages: 2, filtered: true, matching: 25 })).toBe('25 people match. Showing 1–20 of 25 people. Page 1 of 2.');
    // Someone kept in view after a send no longer matches: both numbers.
    expect(listShownText({ from: 1, to: 3, total: 3, page: 1, pages: 1, filtered: true, matching: 2 })).toBe('2 people match. Showing all 3 people.');
    expect(listShownText({ from: 0, to: 0, total: 0, page: 1, pages: 1, filtered: true, matching: 0 })).toBe('No one matches these filters.');
  });
});
