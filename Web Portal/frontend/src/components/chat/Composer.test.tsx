import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('writable: the box as before', () => {
    render(<Composer {...props} readOnly={null} />);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
