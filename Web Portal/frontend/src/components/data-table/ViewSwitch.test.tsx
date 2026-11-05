import { describe, it, expect } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { VIEW_ICONS, ViewSwitch } from './ViewSwitch';

const VIEWS = [
  { value: 'list' as const, label: 'List', icon: VIEW_ICONS.list },
  { value: 'table' as const, label: 'Table', icon: VIEW_ICONS.table },
];
const renderIt = (density?: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ViewSwitch label="Show tasks as" value="list" onChange={() => {}} options={VIEWS} density={density} />
    </QueryClientProvider>,
  );

describe('ViewSwitch', () => {
  it('has the quick “Compact rows” button beside it (1.23.0): every table and list with a view switch', () => {
    renderIt();
    expect(screen.getByRole('group', { name: 'Show tasks as' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compact rows' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('can leave it out', () => {
    renderIt(false);
    expect(screen.queryByRole('button', { name: 'Compact rows' })).toBeNull();
  });
});
