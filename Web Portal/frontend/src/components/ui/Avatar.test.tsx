import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows up to two initials from a full name', () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('builds the initials from letters only, so a name with brackets doesn’t show a bracket', () => {
    render(<Avatar name="Mohammed (OXY)" />);
    expect(screen.getByLabelText('Mohammed (OXY)')).toHaveTextContent(/^MO$/);
  });

  it('exposes the full name as an accessible title', () => {
    render(<Avatar name="omar" />);
    expect(screen.getByTitle('omar')).toBeInTheDocument();
  });

  it('puts the initials on a solid backing: overlapped avatars never show each other’s letters through the tint', () => {
    render(<Avatar name="Aisha Khan" />);
    const face = screen.getByLabelText('Aisha Khan');
    // The card's colour underneath, the brand tint on top of it: the same look on a card, but opaque.
    expect(face).toHaveClass('bg-surface');
    expect(face.className).toMatch(/linear-gradient\(rgb\(var\(--c-brand\)\/0\.1\)/);
    expect(face.className).not.toMatch(/(^|\s)bg-brand\/10(\s|$)/);
  });

  it('a face in a row is 24px, and 20px in compact (1.23.0); elsewhere it never changes', () => {
    render(
      <>
        <Avatar name="Ada Lovelace" size="sm" dense />
        <Avatar name="Bo Diddley" size="sm" />
        <Avatar name="Cy Twombly" size="sm" dense src="/uploads/cy.png" />
      </>,
    );
    expect(screen.getByLabelText('Ada Lovelace')).toHaveClass('h-6', 'w-6', 'compact:h-5', 'compact:w-5');
    expect(screen.getByLabelText('Bo Diddley').className).not.toMatch(/compact:/);
    expect(screen.getByAltText('Cy Twombly')).toHaveClass('h-6', 'w-6', 'compact:h-5', 'compact:w-5');
  });
});
