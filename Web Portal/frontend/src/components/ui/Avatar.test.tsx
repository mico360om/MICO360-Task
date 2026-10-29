import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows up to two initials from a full name', () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
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
});
