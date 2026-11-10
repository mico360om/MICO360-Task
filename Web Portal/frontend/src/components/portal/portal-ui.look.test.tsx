import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chip, StatusBadge } from './portal-ui';

describe('the Client portal in the one colour scheme (1.23.8)', () => {
  it('a task’s status reads like the team’s: Not started slate, In progress blue, In review purple, On hold (blocked) red, Done green', () => {
    const cases: Array<[string, string]> = [
      ['Not started', 'bg-status-todo-soft'],
      ['In progress', 'bg-status-progress-soft'],
      ['In review', 'bg-status-review-soft'],
      ['On hold', 'bg-status-blocked-soft'],
      ['Done', 'bg-status-done-soft'],
      ['Completed', 'bg-status-done-soft'],
    ];
    for (const [label, cls] of cases) {
      const { unmount } = render(<StatusBadge label={label} />);
      expect(screen.getByText(label), label).toHaveClass(cls);
      unmount();
    }
  });

  it('“Late” is the overdue red', () => {
    render(<Chip tone="overdue">Late</Chip>);
    expect(screen.getByText('Late')).toHaveClass('bg-overdue-soft', 'text-overdue');
  });
});
