import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityBadge } from './PriorityBadge';

describe('PriorityBadge', () => {
  it('renders the human label for a priority', () => {
    render(<PriorityBadge priority="URGENT" />);
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('carries the priority as a data attribute', () => {
    render(<PriorityBadge priority="HIGH" />);
    expect(screen.getByText('High')).toHaveAttribute('data-priority', 'HIGH');
  });
});
