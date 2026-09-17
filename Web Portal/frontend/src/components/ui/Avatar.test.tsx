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
});
