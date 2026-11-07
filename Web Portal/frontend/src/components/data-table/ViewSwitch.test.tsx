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
  it('has the quick “Rows” button beside it (1.23.0; three modes 1.23.8): every table and list with a view switch', () => {
    renderIt();
    expect(screen.getByRole('group', { name: 'Show tasks as' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rows: Comfortable' })).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('each choice is a 44 px target on a touch screen, wide as well as tall (the base 2rem button rule is outranked)', () => {
    renderIt(false);
    for (const name of ['List view', 'Table view']) {
      const cls = screen.getByRole('button', { name }).className;
      expect(cls).toContain('[@media(pointer:coarse)]:h-11');
      expect(cls).toContain('[@media(pointer:coarse)]:!min-w-11');
    }
  });

  it('can leave it out', () => {
    renderIt(false);
    expect(screen.queryByRole('button', { name: /^Rows/ })).toBeNull();
  });
});

describe('words on a phone too (1.23.8, the month view’s minor 7)', () => {
  it('a switch whose icons look alike (Day | Month) keeps its words on a phone', () => {
    render(
      <ViewSwitch
        label="Show the board for"
        value="day"
        onChange={() => {}}
        density={false}
        words="always"
        options={[
          { value: 'day', label: 'Day', icon: <path d="M3 3h1" /> },
          { value: 'month', label: 'Month', icon: <path d="M3 3h2" /> },
        ]}
      />,
    );
    for (const name of ['Day view', 'Month view']) {
      const word = screen.getByRole('button', { name }).querySelector('span');
      expect(word?.className ?? '').not.toContain('max-sm:hidden');
    }
  });

  it('the board’s Day | Month uses it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const board = readFileSync(resolve(__dirname, '../board/Board.tsx'), 'utf8');
    expect(board).toMatch(/options=\{PERIODS\}\s*density=\{false\}\s*words="always"/);
  });
});
