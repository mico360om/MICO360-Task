import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentsSection, type DrawerComment } from './comments';
import type { MentionPerson } from '../../lib/mentions';

const NOBODY: MentionPerson[] = [];
const at = (min: number) => new Date(Date.UTC(2026, 10, 10, 8, min)).toISOString();
const comment = (id: string, min: number, more: Partial<DrawerComment> = {}): DrawerComment => ({ id, body: `Comment ${id}`, authorName: 'Omar Ahmed', createdAt: at(min), ...more });
const rect = (top: number, bottom = top + 10) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

/** Where the reader is: at the top of the list, or scrolled down it (the list's top gone under the write box). */
function readerAt(where: 'top' | 'down') {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-comments-top')) return rect(where === 'top' ? 300 : -500);
    if (this.hasAttribute('data-comments-box')) return rect(100, 290);
    return rect(0, 0);
  });
}

const commentTexts = () =>
  within(screen.getByRole('list', { name: 'Comments, newest first' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-comment-body]')?.textContent);

afterEach(() => vi.restoreAllMocks());

describe('CommentsSection: newest first, box on top', () => {
  it('shows the newest comment first; replies stay under their comment, oldest first', () => {
    const list = [comment('a', 1), comment('a2', 4, { parentId: 'a' }), comment('b', 5), comment('a1', 2, { parentId: 'a' }), comment('c', 3)];
    render(<CommentsSection comments={list} people={NOBODY} onAdd={vi.fn()} />);
    const top = within(screen.getByRole('list', { name: 'Comments, newest first' })).getAllByRole('listitem').filter((li) => li.parentElement?.getAttribute('aria-label') === 'Comments, newest first');
    expect(top.map((li) => li.querySelector('[data-comment-body]')?.textContent)).toEqual(['Comment b', 'Comment c', 'Comment a']);
    const replies = within(screen.getByRole('list', { name: 'Replies to Omar Ahmed' })).getAllByRole('listitem');
    expect(replies.map((li) => li.querySelector('[data-comment-body]')?.textContent)).toEqual(['Comment a1', 'Comment a2']);
  });

  it('puts the write box and its button above the comments', () => {
    render(<CommentsSection comments={[comment('a', 1)]} people={NOBODY} onAdd={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Add a comment' });
    const send = screen.getByRole('button', { name: 'Comment' });
    const first = screen.getAllByRole('listitem')[0]!;
    expect(box.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(send.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the newest 30, then 30 more each time with Show older comments', async () => {
    const list = Array.from({ length: 65 }, (_, i) => comment(`k${i}`, i));
    render(<CommentsSection comments={list} people={NOBODY} onAdd={vi.fn()} />);
    expect(commentTexts()).toHaveLength(30);
    expect(commentTexts()[0]).toBe('Comment k64');
    await userEvent.click(screen.getByRole('button', { name: 'Show older comments' }));
    expect(commentTexts()).toHaveLength(60);
    await userEvent.click(screen.getByRole('button', { name: 'Show older comments' }));
    expect(commentTexts()).toHaveLength(65);
    expect(commentTexts().at(-1)).toBe('Comment k0');
    expect(screen.queryByRole('button', { name: 'Show older comments' })).toBeNull();
  });
});

describe('CommentsSection: sending', () => {
  it('shows my comment at the top at once, empties the box, and shows it once when it is saved', async () => {
    let answer: (id: string) => void = () => {};
    const onAdd = vi.fn(() => new Promise<string>((r) => (answer = r)));
    const { rerender } = render(<CommentsSection comments={[comment('a', 1)]} people={NOBODY} onAdd={onAdd} me={{ name: 'Ada Lovelace' }} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Looks good');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(onAdd).toHaveBeenCalledWith('Looks good');
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('');
    // Still on its way: stepping to another task or closing asks first (its words aren't saved yet).
    expect(screen.getByText('Sending…').closest('[data-unsaved]')).not.toBeNull();
    expect(commentTexts()).toEqual(['Looks good', 'Comment a']);
    expect(screen.getByText('Sending…')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    await act(async () => answer('c9'));
    rerender(<CommentsSection comments={[comment('a', 1), comment('c9', 9, { body: 'Looks good', mine: true, authorName: 'Ada Lovelace' })]} people={NOBODY} onAdd={onAdd} me={{ name: 'Ada Lovelace' }} />);
    expect(commentTexts()).toEqual(['Looks good', 'Comment a']);
    expect(screen.queryByText('Sending…')).toBeNull();
  });

  it('doesn’t show it twice when its live copy arrives before the server’s answer', async () => {
    const onAdd = vi.fn(() => new Promise<string>(() => {}));
    const { rerender } = render(<CommentsSection comments={[comment('a', 1)]} people={NOBODY} onAdd={onAdd} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'On my way');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    rerender(<CommentsSection comments={[comment('a', 1), comment('c9', 9, { body: 'On my way', mine: true })]} people={NOBODY} onAdd={onAdd} />);
    expect(commentTexts()).toEqual(['On my way', 'Comment a']);
  });

  it('a comment that didn’t go says so and keeps its words: Try again sends it again, Edit puts it back in the box', async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('Couldn’t post the comment. Check your connection and try again.')).mockReturnValueOnce(new Promise(() => {}));
    render(<CommentsSection comments={[]} people={NOBODY} onAdd={onAdd} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Please check');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not sent');
    expect(alert).toHaveTextContent('Check your connection');
    expect(commentTexts()).toEqual(['Please check']);
    // It counts as unsaved (stepping to another task asks first).
    expect(alert.closest('[data-unsaved]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Please check');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Sending…')).toBeInTheDocument();
  });

  it('Edit on a comment that didn’t go puts its words back in the write box', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('No connection.'));
    render(<CommentsSection comments={[]} people={NOBODY} onAdd={onAdd} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Please check');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Edit the comment that wasn’t sent' }));
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('Please check');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Comments, newest first' })).toBeNull();
  });

  it('Ctrl+Enter sends', async () => {
    const onAdd = vi.fn(() => new Promise<void>(() => {}));
    render(<CommentsSection comments={[]} people={NOBODY} onAdd={onAdd} />);
    const box = screen.getByRole('textbox', { name: 'Add a comment' });
    await userEvent.type(box, 'Quick note');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onAdd).toHaveBeenCalledWith('Quick note');
  });
});

describe('CommentsSection: live', () => {
  it('a comment from someone else shows at the top, highlighted, and is announced', () => {
    readerAt('top');
    const { rerender } = render(<CommentsSection comments={[comment('a', 1)]} people={NOBODY} onAdd={vi.fn()} />);
    rerender(<CommentsSection comments={[comment('a', 1), comment('b', 2, { authorName: 'Sara Ali' })]} people={NOBODY} onAdd={vi.fn()} />);
    expect(commentTexts()).toEqual(['Comment b', 'Comment a']);
    expect(screen.getByText('Comment b').closest('[data-fresh]')).not.toBeNull();
    expect(screen.getByText('New comment from Sara Ali')).toBeInTheDocument();
  });

  it('while I read further down, a button says how many wait above instead of moving the list; it brings them in smoothly', async () => {
    readerAt('down');
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    const { rerender } = render(<CommentsSection comments={[comment('a', 1)]} people={NOBODY} onAdd={vi.fn()} />);
    rerender(<CommentsSection comments={[comment('a', 1), comment('b', 2)]} people={NOBODY} onAdd={vi.fn()} />);
    expect(commentTexts()).toEqual(['Comment a']);
    const button = screen.getByRole('button', { name: /1 new comment/ });
    expect(screen.getByText('1 new comment above')).toBeInTheDocument();
    await userEvent.click(button);
    expect(commentTexts()).toEqual(['Comment b', 'Comment a']);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(screen.queryByRole('button', { name: /new comment/ })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('with reduced motion the button jumps at once', async () => {
    readerAt('down');
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    const { rerender } = render(<CommentsSection comments={[comment('a', 1)]} people={NOBODY} onAdd={vi.fn()} />);
    rerender(<CommentsSection comments={[comment('a', 1), comment('b', 2), comment('c', 3)]} people={NOBODY} onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /2 new comments/ }));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    vi.unstubAllGlobals();
  });

  it('an edit shows in place and a deleted comment goes', () => {
    const { rerender } = render(<CommentsSection comments={[comment('a', 1), comment('b', 2)]} people={NOBODY} onAdd={vi.fn()} />);
    rerender(<CommentsSection comments={[comment('a', 1, { body: 'Changed words', edited: true })]} people={NOBODY} onAdd={vi.fn()} />);
    expect(commentTexts()).toEqual(['Changed words']);
    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });

  it('a list still loading isn’t taken as “no comments”: its first comments aren’t new', () => {
    const { rerender } = render(<CommentsSection comments={[]} loaded={false} people={NOBODY} onAdd={vi.fn()} />);
    rerender(<CommentsSection comments={[comment('a', 1), comment('b', 2)]} loaded people={NOBODY} onAdd={vi.fn()} />);
    expect(document.querySelector('[data-fresh]')).toBeNull();
  });
});

describe('CommentsSection: replies on every comment (owner addition)', () => {
  const people: MentionPerson[] = [];

  it('offers Reply on every comment — the team’s too, not only a client’s', () => {
    render(<CommentsSection comments={[comment('a', 1), comment('b', 2, { fromClient: true, authorName: 'Fatma Said' })]} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Reply to Omar Ahmed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reply to Fatma Said' })).toBeInTheDocument();
  });

  it('a reply to a team comment has no “Visible to client” tick; one in a client’s thread does', async () => {
    render(<CommentsSection comments={[comment('a', 1), comment('b', 2, { fromClient: true, authorName: 'Fatma Said' })]} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reply to Omar Ahmed' }));
    expect(screen.queryByRole('checkbox', { name: 'Visible to client' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel reply' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reply to Fatma Said' }));
    expect(screen.getByRole('checkbox', { name: 'Visible to client' })).not.toBeChecked();
  });

  it('replying to a reply answers the same thread, starting with @their name', async () => {
    const onReply = vi.fn(async () => {});
    const list = [comment('a', 1), comment('r1', 2, { parentId: 'a', authorName: 'Sara Ali', authorUsername: 'sara' })];
    render(<CommentsSection comments={list} people={people} onAdd={vi.fn()} onReply={onReply} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reply to Sara Ali' }));
    const box = screen.getByRole('textbox', { name: 'Reply to Sara Ali' });
    expect(box).toHaveValue('@sara ');
    // Replies are one level deep: the reply box sits in the thread (under its replies), not under the reply.
    const thread = screen.getByRole('list', { name: 'Replies to Omar Ahmed' }).parentElement!;
    expect(thread.lastElementChild?.tagName).toBe('FORM');
    expect(within(thread.lastElementChild as HTMLElement).getByRole('textbox', { name: 'Reply to Sara Ali' })).toBe(box);
    await userEvent.type(box, 'thanks');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    // The reply names the comment answered; the server files it in the thread.
    expect(onReply).toHaveBeenCalledWith('r1', '@sara thanks', false);
  });

  it('in a client’s thread a reply to a colleague doesn’t start with their @username (the client could be shown it)', async () => {
    const list = [comment('k', 1, { fromClient: true, authorName: 'Fatma Said' }), comment('r1', 2, { parentId: 'k', authorName: 'Sara Ali', authorUsername: 'sara' })];
    render(<CommentsSection comments={list} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reply to Sara Ali' }));
    expect(screen.getByRole('textbox', { name: 'Reply to Sara Ali' })).toHaveValue('');
  });

  it('a reply to a comment still waiting behind the button waits with it (never a “Comment deleted” stand-in at the top)', () => {
    readerAt('down');
    const list = [comment('a', 1)];
    const { rerender } = render(<CommentsSection comments={list} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    rerender(<CommentsSection comments={[...list, comment('b', 5)]} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    rerender(<CommentsSection comments={[...list, comment('b', 5), comment('b1', 6, { parentId: 'b' })]} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    expect(screen.queryByText('Comment deleted')).toBeNull();
    expect(screen.queryByText('Comment b1')).toBeNull();
    expect(screen.getByRole('button', { name: /new comment/ })).toBeInTheDocument();
  });

  it('a reply that arrives live keeps its thread in place and marks it “New reply”', () => {
    readerAt('top');
    const list = [comment('a', 1), comment('b', 5)];
    const { rerender } = render(<CommentsSection comments={list} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    rerender(<CommentsSection comments={[...list, comment('a1', 9, { parentId: 'a', authorName: 'Sara Ali' })]} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    const top = screen.getByRole('list', { name: 'Comments, newest first' }).children;
    expect(top[0]!.querySelector('[data-comment-body]')?.textContent).toBe('Comment b');
    expect(within(top[1] as HTMLElement).getByText('New reply')).toBeInTheDocument();
    expect(screen.getByText('Comment a1').closest('[data-fresh]')).not.toBeNull();
  });

  it('a reply never waits behind the “new comments” button', () => {
    readerAt('down');
    const list = [comment('a', 1)];
    const { rerender } = render(<CommentsSection comments={list} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    rerender(<CommentsSection comments={[...list, comment('a1', 9, { parentId: 'a' })]} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /new comment/ })).toBeNull();
    expect(screen.getByText('Comment a1')).toBeInTheDocument();
  });

  it('a deleted comment that still has replies shows “Comment deleted” above them', () => {
    render(<CommentsSection comments={[comment('r1', 3, { parentId: 'gone' }), comment('r2', 4, { parentId: 'gone' }), comment('b', 2)]} people={people} onAdd={vi.fn()} onReply={vi.fn()} />);
    const top = screen.getByRole('list', { name: 'Comments, newest first' }).children;
    expect(top[0]).toHaveTextContent('Comment deleted');
    expect(within(top[0] as HTMLElement).getAllByText(/^Comment r/).map((n) => n.textContent)).toEqual(['Comment r1', 'Comment r2']);
    expect(within(top[0] as HTMLElement).getAllByRole('button', { name: /^Reply to/ })).toHaveLength(2);
  });
});
