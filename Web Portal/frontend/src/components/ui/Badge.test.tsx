import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders its label and exposes the tone via a data attribute', () => {
    render(<Badge tone="success">Active</Badge>);
    const el = screen.getByText('Active');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('data-tone', 'success');
  });

  it('defaults to the neutral tone', () => {
    render(<Badge>Planning</Badge>);
    expect(screen.getByText('Planning')).toHaveAttribute('data-tone', 'neutral');
  });

  it('applies the semantic colour class for the tone', () => {
    render(<Badge tone="danger">Deleted</Badge>);
    expect(screen.getByText('Deleted').className).toMatch(/danger/);
  });
});
