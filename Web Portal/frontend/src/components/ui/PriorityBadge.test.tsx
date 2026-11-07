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

describe('PriorityBadge colours (1.23.8 one colour scheme)', () => {
  it('Urgent red · High orange · Normal blue-grey · Low grey, each a tint with its word', () => {
    const { rerender } = render(<PriorityBadge priority="URGENT" />);
    expect(screen.getByText('Urgent')).toHaveClass('bg-prio-urgent-soft', 'text-prio-urgent');
    rerender(<PriorityBadge priority="HIGH" />);
    expect(screen.getByText('High')).toHaveClass('bg-prio-high-soft', 'text-prio-high');
    rerender(<PriorityBadge priority="NORMAL" />);
    expect(screen.getByText('Normal')).toHaveClass('bg-prio-normal-soft', 'text-prio-normal');
    rerender(<PriorityBadge priority="LOW" />);
    expect(screen.getByText('Low')).toHaveClass('bg-prio-low-soft', 'text-prio-low');
  });
});
