import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataColumn } from './DataTable';
import type { SortState } from '../../lib/data-table';

interface Row {
  id: string;
  title: string;
  n: number;
}

const COLUMNS: DataColumn<Row>[] = [
  { id: 'title', label: 'Title', cell: (r) => r.title, sortable: true, pin: true, rowHeader: true },
  { id: 'n', label: 'Number', cell: (r) => String(r.n), sortable: true },
  { id: 'extra', label: 'Extra', cell: (r) => `x${r.n}`, optional: true, defaultShown: false },
  { id: 'open', label: 'Open', hideLabel: true, cell: (r) => <button type="button">Open {r.title}</button> },
];

function Harness({ rows, sections, presorted = false }: { rows?: Row[]; sections?: { key: string; head: React.ReactNode; rows: Row[] }[]; presorted?: boolean }) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  return (
    <DataTable
      label="Tasks"
      columns={COLUMNS}
      rows={rows}
      sections={sections}
      rowKey={(r) => r.id}
      sort={sort}
      onSort={setSort}
      sortValue={presorted ? undefined : (r, c) => (c === 'title' ? r.title : r.n)}
      shown={shown}
      onShownChange={setShown}
      empty={<p>Nothing here.</p>}
    />
  );
}

const ROWS: Row[] = [
  { id: 'a', title: 'Beta', n: 2 },
  { id: 'b', title: 'Alpha', n: 3 },
  { id: 'c', title: 'Gamma', n: 1 },
];
const titles = () => screen.getAllByRole('rowheader').map((c) => c.textContent);

describe('DataTable', () => {
  it('is a named table in its own scrolling region, with column headers and a row header', () => {
    render(<Harness rows={ROWS} />);
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Tasks' });
    expect(within(table).getByRole('columnheader', { name: /Title/ })).toBeInTheDocument();
    // The Open column's header is for screen readers only.
    expect(within(table).getByRole('columnheader', { name: 'Open' })).toBeInTheDocument();
    expect(titles()).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('sorts by a header: ascending, descending, then the page’s order again', async () => {
    const user = userEvent.setup();
    render(<Harness rows={ROWS} />);
    const header = () => screen.getByRole('columnheader', { name: /Title/ });
    expect(header()).not.toHaveAttribute('aria-sort');
    await user.click(within(header()).getByRole('button'));
    expect(header()).toHaveAttribute('aria-sort', 'ascending');
    expect(titles()).toEqual(['Alpha', 'Beta', 'Gamma']);
    await user.click(within(header()).getByRole('button'));
    expect(header()).toHaveAttribute('aria-sort', 'descending');
    expect(titles()).toEqual(['Gamma', 'Beta', 'Alpha']);
    await user.click(within(header()).getByRole('button'));
    expect(header()).not.toHaveAttribute('aria-sort');
    expect(titles()).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('leaves the order to the page when it sorts the rows itself', async () => {
    const user = userEvent.setup();
    render(<Harness rows={ROWS} presorted />);
    await user.click(within(screen.getByRole('columnheader', { name: /Title/ })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /Title/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(titles()).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('shows and hides the optional columns from the Columns menu', async () => {
    const user = userEvent.setup();
    render(<Harness rows={ROWS} />);
    expect(screen.queryByRole('columnheader', { name: 'Extra' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('checkbox', { name: 'Extra' }));
    expect(screen.getByRole('columnheader', { name: 'Extra' })).toBeInTheDocument();
    expect(screen.getAllByText('x2').length).toBe(1);
    await user.click(screen.getByRole('checkbox', { name: 'Extra' }));
    expect(screen.queryByRole('columnheader', { name: 'Extra' })).toBeNull();
  });

  it('shows a hundred rows, then a hundred more', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 230 }, (_, i) => ({ id: `r${i}`, title: `Task ${i}`, n: i }));
    render(<Harness rows={many} />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(100);
    await user.click(screen.getByRole('button', { name: 'Show 100 more (130 left)' }));
    expect(screen.getAllByRole('rowheader')).toHaveLength(200);
    await user.click(screen.getByRole('button', { name: 'Show 30 more' }));
    expect(screen.getAllByRole('rowheader')).toHaveLength(230);
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
  });

  it('says so when there are no rows', () => {
    render(<Harness rows={[]} />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('draws groups, each with its heading row, and sorts inside each group', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        sections={[
          { key: 'g1', head: <th colSpan={4} scope="colgroup">1. Site progress</th>, rows: [ROWS[0]!, ROWS[1]!] },
          { key: 'g2', head: <th colSpan={4} scope="colgroup">Other</th>, rows: [ROWS[2]!] },
        ]}
      />,
    );
    const groups = screen.getAllByRole('rowgroup').slice(1); // the first is the header
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getByText('1. Site progress')).toBeInTheDocument();
    await user.click(within(screen.getByRole('columnheader', { name: /Number/ })).getByRole('button'));
    // Sorted by number inside "Site progress" (2, 3); Other keeps its one row.
    expect(within(groups[0]!).getAllByRole('rowheader').map((c) => c.textContent)).toEqual(['Beta', 'Alpha']);
    await user.click(within(screen.getByRole('columnheader', { name: /Number/ })).getByRole('button'));
    expect(within(groups[0]!).getAllByRole('rowheader').map((c) => c.textContent)).toEqual(['Alpha', 'Beta']);
  });
});
