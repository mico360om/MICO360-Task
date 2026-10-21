import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgendaField, type AgendaDraft } from './AgendaField';

const leads = [{ id: 'u1', name: 'Khalid Al Amri' }, { id: 'u2', name: 'Sara Al Balushi' }];
let latest: AgendaDraft[] = [];
function Harness({ initial = [], minutes = 60 }: { initial?: AgendaDraft[]; minutes?: number }) {
  const [value, setValue] = useState<AgendaDraft[]>(initial);
  latest = value;
  return <AgendaField value={value} onChange={(v) => { latest = v; setValue(v); }} leads={leads} minutes={minutes} />;
}
const item = (key: string, title: string, minutes: number | null = null, ownerId: string | null = null): AgendaDraft => ({ key, title, ownerId, minutes });

describe('New meeting: Agenda', () => {
  it('adds an item with Enter, without sending the form', async () => {
    const submitted: string[] = [];
    render(
      <form onSubmit={(e) => { e.preventDefault(); submitted.push('form'); }}>
        <Harness />
      </form>,
    );
    await userEvent.type(screen.getByLabelText('New agenda item'), 'Pump test results{Enter}');
    await userEvent.type(screen.getByLabelText('New agenda item'), 'Budget');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(latest.map((i) => i.title)).toEqual(['Pump test results', 'Budget']);
    expect(new Set(latest.map((i) => i.key)).size).toBe(2);
    expect(submitted).toEqual([]);
  });

  it('edits the title, lead and minutes of an item', async () => {
    render(<Harness initial={[item('a', 'Pump test')]} />);
    const title = screen.getByLabelText('Agenda item 1');
    await userEvent.clear(title);
    await userEvent.type(title, 'Pump test results');
    await userEvent.selectOptions(screen.getByLabelText('Lead for item 1'), 'u2');
    fireEvent.change(screen.getByLabelText('Minutes for item 1'), { target: { value: '20' } });
    expect(latest).toEqual([{ key: 'a', title: 'Pump test results', ownerId: 'u2', minutes: 20 }]);
  });

  it('reorders with Move up and Move down, and removes an item', async () => {
    render(<Harness initial={[item('a', 'Intro'), item('b', 'Budget'), item('c', 'Next steps')]} />);
    expect(screen.getByRole('button', { name: 'Move item 1 up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move item 3 up' }));
    expect(latest.map((i) => i.title)).toEqual(['Intro', 'Next steps', 'Budget']);
    await userEvent.click(screen.getByRole('button', { name: 'Move item 1 down' }));
    expect(latest.map((i) => i.title)).toEqual(['Next steps', 'Intro', 'Budget']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove item 2' }));
    expect(latest.map((i) => i.title)).toEqual(['Next steps', 'Budget']);
  });

  it('shows the total against the meeting’s length, in warning colour when over', () => {
    const { rerender } = render(<Harness initial={[item('a', 'Intro', 15), item('b', 'Budget', 30)]} />);
    expect(screen.getByText('Total 45 of 60 minutes')).not.toHaveClass('text-warning');
    rerender(<Harness key="over" initial={[item('a', 'Intro', 45), item('b', 'Budget', 30)]} />);
    expect(screen.getByText('Total 75 of 60 minutes')).toHaveClass('text-warning');
  });
});
