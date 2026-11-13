import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';

const props = { conversationId: 'd1', placeholder: 'Message Sara', people: [], replyTo: null, onCancelReply: vi.fn(), onSend: vi.fn(() => true), onFiles: vi.fn(() => true), restore: null };

describe('Composer', () => {
  it('read-only: a note with the server’s words instead of the box', () => {
    render(<Composer {...props} readOnly={{ message: 'You no longer share a company with Sara.' }} />);
    expect(screen.getByRole('note')).toHaveTextContent('You no longer share a company with Sara.');
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
  });

  // sb3 gate: the cursor went in a frame later, so selecting the text in that frame (a busy page, the
  // battery's chat check selecting all to type a draft) was undone and the next words landed after the emoji.
  it('an emoji picked goes in at the cursor, which is placed at once — a selection made right after stays', async () => {
    render(<Composer {...props} readOnly={null} />);
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await userEvent.type(box, 'hi ');
    await userEvent.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search emoji' }), 'rocket');
    await userEvent.click(screen.getByRole('button', { name: /🚀/ }));
    expect(box).toHaveValue('hi 🚀');
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual(['hi 🚀'.length, 'hi 🚀'.length]);
    box.setSelectionRange(0, box.value.length);
    await new Promise((r) => setTimeout(r, 60));
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
  });

  it('writable: the box as before', () => {
    render(<Composer {...props} readOnly={null} />);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
