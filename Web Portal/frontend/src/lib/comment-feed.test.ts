import { describe, it, expect, vi, afterEach } from 'vitest';
import { COMMENTS_PAGE, matchedPending, newCommentsText, newestFirst, scrolledPast, scrollToListTop, type PendingComment } from './comment-feed';

const at = (min: number) => new Date(Date.UTC(2026, 10, 10, 8, min)).toISOString();
const rect = (top: number, bottom = top + 10) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe('comment feed: newest first', () => {
  it('puts the newest comment (by its own time) at the top; its replies stay under it in their order', () => {
    const t = (id: string, min: number, replies: string[] = []) => ({ comment: { id, createdAt: at(min) }, replies: replies.map((r) => ({ id: r, createdAt: at(min + 1) })) });
    const out = newestFirst([t('a', 1, ['a1', 'a2']), t('b', 5), t('c', 3)], (c) => c.createdAt);
    expect(out.map((x) => x.comment.id)).toEqual(['b', 'c', 'a']);
    expect(out[2]!.replies.map((r) => r.id)).toEqual(['a1', 'a2']);
  });

  it('keeps the later-listed one first when two have the same time, and copes with a missing time', () => {
    const out = newestFirst(
      [
        { comment: { id: 'x', createdAt: at(1) }, replies: [] },
        { comment: { id: 'y', createdAt: at(1) }, replies: [] },
        { comment: { id: 'z', createdAt: undefined as string | undefined }, replies: [] },
      ],
      (c) => c.createdAt,
    );
    expect(out.map((x) => x.comment.id)).toEqual(['y', 'x', 'z']);
  });

  it('shows 30 at a time', () => {
    expect(COMMENTS_PAGE).toBe(30);
  });

  it('says how many new comments wait above', () => {
    expect(newCommentsText(1)).toBe('1 new comment');
    expect(newCommentsText(3)).toBe('3 new comments');
  });
});

describe('comment feed: my sending comments meet their saved copies (no duplicate)', () => {
  const list = [
    { id: 'old', mine: true, body: 'Same words' },
    { id: 'c9', mine: true, body: 'Same words' },
    { id: 'c10', mine: false, body: 'Hello' },
  ];
  const pending = (key: string, body: string, before: string[], savedId?: string): PendingComment => ({ key, body, status: 'sending', before: new Set(before), savedId });

  it('by the saved id once the answer came', () => {
    expect([...matchedPending([pending('p1', 'Anything', ['old'], 'c9')], list)]).toEqual(['p1']);
  });

  it('by its words when the live copy came first: a comment of mine that wasn’t there when I pressed send', () => {
    // 'old' has the same words but was already there; c9 is the echo.
    expect([...matchedPending([pending('p1', '  Same words ', ['old'])], list)]).toEqual(['p1']);
    // Someone else's comment with my words is never mine.
    expect([...matchedPending([pending('p1', 'Hello', ['old'])], list)]).toEqual([]);
  });

  it('one saved comment answers one sending comment only (the same words sent twice)', () => {
    const out = matchedPending([pending('p1', 'Same words', ['old']), pending('p2', 'Same words', ['old'])], list);
    expect([...out]).toEqual(['p1']);
  });

  it('a “Not sent” one whose saved copy shows up was saved after all (a timeout after saving): it goes, so Try again can’t post it twice', () => {
    expect([...matchedPending([{ ...pending('p1', 'Same words', ['old']), status: 'failed' }], list)]).toEqual(['p1']);
    expect([...matchedPending([{ ...pending('p1', 'Other words', ['old']), status: 'failed' }], list)]).toEqual([]);
  });
});

describe('comment feed: where the reader is', () => {
  it('is away from the top once the list’s top has gone under the write box (or above the view)', () => {
    const top = document.createElement('div');
    const box = document.createElement('div');
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(rect(100, 200));
    const spy = vi.spyOn(top, 'getBoundingClientRect').mockReturnValue(rect(210));
    expect(scrolledPast(top, box)).toBe(false); // the list starts under the box: at the top
    spy.mockReturnValue(rect(-400));
    expect(scrolledPast(top, box)).toBe(true); // scrolled down the list
    spy.mockReturnValue(rect(900));
    expect(scrolledPast(top, box)).toBe(false); // the comments are still below
    expect(scrolledPast(null, box)).toBe(false);
  });
});

describe('comment feed: back to the top', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = (reduce: boolean) => {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 500 });
    const section = document.createElement('section');
    scroller.appendChild(section);
    document.body.appendChild(scroller);
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(60, 560));
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(rect(-340, 1400));
    const scrollBy = vi.fn();
    (scroller as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    return { section, scrollBy };
  };

  it('scrolls the panel (not the page) smoothly so the comments’ heading is at its top', () => {
    const { section, scrollBy } = setup(false);
    scrollToListTop(section);
    expect(scrollBy).toHaveBeenCalledWith({ top: -400 - 8, behavior: 'smooth' });
  });

  it('jumps at once with reduced motion', () => {
    const { section, scrollBy } = setup(true);
    scrollToListTop(section);
    expect(scrollBy).toHaveBeenCalledWith({ top: -408, behavior: 'auto' });
  });
});
