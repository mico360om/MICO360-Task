import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(<EmptyState title="No tasks yet" description="Assigned tasks will show here." />);
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    expect(screen.getByText('Assigned tasks will show here.')).toBeInTheDocument();
  });

  it('renders an optional action', () => {
    render(<EmptyState title="Empty" action={<button>Create</button>} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('works without a description', () => {
    render(<EmptyState title="All caught up" />);
    expect(screen.getByText('All caught up')).toBeInTheDocument();
  });
});
